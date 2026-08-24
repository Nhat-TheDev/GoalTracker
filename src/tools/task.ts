import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  taskCreateInput,
  taskGetInput,
  taskListInput,
  taskUpdateStatusInput,
  taskAddNoteInput,
  rowToTask,
  rowToNote,
  type TaskStatus,
  type ToolDefinition,
} from '../schemas/index.js';
import { activeTaskCount, needsApproval } from '../utils/computed.js';

export function taskTools(db: Database.Database): ToolDefinition[] {
  return [
    {
      name: 'task_create',
      description:
        'Create a task within a milestone. No hard cap — the response includes milestone_active_task_count so the Agent can judge against the 2-5 active-task guideline. description is not required by this tool, but write one substantial enough that a future session with zero memory of this conversation could act on it — a bare restated title is not enough.',
      schema: taskCreateInput,
      handler: (args) => {
        const input = taskCreateInput.parse(args);
        const milestoneRow = db
          .prepare(
            `SELECT m.goal_id as goal_id, g.status as goal_status
             FROM milestones m JOIN goals g ON g.id = m.goal_id
             WHERE m.id = ?`
          )
          .get(input.milestone_id) as { goal_id: string; goal_status: string } | undefined;
        if (!milestoneRow) throw new Error(`Milestone not found: ${input.milestone_id}`);
        if (milestoneRow.goal_status !== 'active') {
          throw new Error(
            `Goal is ${milestoneRow.goal_status} — call goal_update_status(goal_id, "active") first before creating tasks.`
          );
        }

        const now = new Date().toISOString();
        const id = randomUUID();
        db.prepare(
          `INSERT INTO tasks (id, milestone_id, goal_id, title, description, priority, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          input.milestone_id,
          milestoneRow.goal_id,
          input.title,
          input.description ?? null,
          input.priority ?? 'medium',
          now,
          now
        );

        const statuses = (
          db.prepare('SELECT status FROM tasks WHERE milestone_id = ?').all(input.milestone_id) as {
            status: TaskStatus;
          }[]
        ).map((r) => r.status);

        const task = rowToTask(
          db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown>
        );
        return { ...task, milestone_active_task_count: activeTaskCount(statuses) };
      },
    },
    {
      name: 'task_get',
      description: "Inspect a task's full detail, including all its notes.",
      schema: taskGetInput,
      handler: (args) => {
        const { task_id } = taskGetInput.parse(args);
        const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task_id);
        if (!row) throw new Error(`Task not found: ${task_id}`);
        const notes = db
          .prepare('SELECT * FROM notes WHERE task_id = ? ORDER BY created_at ASC')
          .all(task_id)
          .map((r) => rowToNote(r as Record<string, unknown>));
        return { ...rowToTask(row as Record<string, unknown>), notes };
      },
    },
    {
      name: 'task_list',
      description: 'Find tasks to work on or review, filtered by goal, milestone, status, and/or priority.',
      schema: taskListInput,
      handler: (args) => {
        const input = taskListInput.parse(args);
        const clauses: string[] = [];
        const params: unknown[] = [];
        if (input.goal_id) {
          clauses.push('goal_id = ?');
          params.push(input.goal_id);
        }
        if (input.milestone_id) {
          clauses.push('milestone_id = ?');
          params.push(input.milestone_id);
        }
        if (input.status) {
          clauses.push('status = ?');
          params.push(input.status);
        }
        if (input.priority) {
          clauses.push('priority = ?');
          params.push(input.priority);
        }
        const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
        const rows = db.prepare(`SELECT * FROM tasks ${where} ORDER BY created_at ASC`).all(...params);
        return rows.map((r) => rowToTask(r as Record<string, unknown>));
      },
    },
    {
      name: 'task_update_status',
      description:
        "Update a task's status (pending, in_progress, completed, blocked, cancelled). reason is required for blocked and cancelled.",
      schema: taskUpdateStatusInput,
      handler: (args) => {
        const input = taskUpdateStatusInput.parse(args);
        const existing = db.prepare('SELECT milestone_id, goal_id FROM tasks WHERE id = ?').get(input.task_id) as
          | { milestone_id: string; goal_id: string }
          | undefined;
        if (!existing) throw new Error(`Task not found: ${input.task_id}`);

        const goalRow = db.prepare('SELECT status FROM goals WHERE id = ?').get(existing.goal_id) as {
          status: string;
        };
        if (goalRow.status !== 'active') {
          throw new Error(
            `Goal is ${goalRow.status} — call goal_update_status(goal_id, "active") first before updating tasks.`
          );
        }

        if (input.status === 'in_progress') {
          const milestoneRow = db
            .prepare('SELECT title, approved_at FROM milestones WHERE id = ?')
            .get(existing.milestone_id) as { title: string; approved_at: string | null };
          const statuses = (
            db.prepare('SELECT status FROM tasks WHERE milestone_id = ?').all(existing.milestone_id) as {
              status: TaskStatus;
            }[]
          ).map((r) => r.status);
          if (needsApproval(statuses, milestoneRow.approved_at ?? undefined)) {
            throw new Error(
              `Milestone "${milestoneRow.title}" has fewer than 2 active tasks and has not been approved yet. ` +
                `Confirm with the user that this small milestone is intentional, then call milestone_approve(milestone_id) before starting work on its tasks.`
            );
          }
        }

        const now = new Date().toISOString();
        db.prepare(`UPDATE tasks SET status = ?, status_reason = ?, updated_at = ? WHERE id = ?`).run(
          input.status,
          input.reason ?? null,
          now,
          input.task_id
        );
        return rowToTask(
          db.prepare('SELECT * FROM tasks WHERE id = ?').get(input.task_id) as Record<string, unknown>
        );
      },
    },
    {
      name: 'task_add_note',
      description: 'Record a progress update, blocker, technical decision, evidence, or uncertainty on a task.',
      schema: taskAddNoteInput,
      handler: (args) => {
        const input = taskAddNoteInput.parse(args);
        const taskExists = db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(input.task_id);
        if (!taskExists) throw new Error(`Task not found: ${input.task_id}`);
        const now = new Date().toISOString();
        const id = randomUUID();
        db.prepare(`INSERT INTO notes (id, task_id, content, type, created_at) VALUES (?, ?, ?, ?, ?)`).run(
          id,
          input.task_id,
          input.content,
          input.type,
          now
        );
        return rowToNote(db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Record<string, unknown>);
      },
    },
  ];
}
