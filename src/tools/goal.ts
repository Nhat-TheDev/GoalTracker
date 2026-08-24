import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  goalCreateInput,
  goalListInput,
  goalGetContextInput,
  goalUpdateStatusInput,
  rowToGoal,
  rowToSpec,
  rowToMilestoneBase,
  rowToCheckpoint,
  type Goal,
  type TaskStatus,
  type ToolDefinition,
} from '../schemas/index.js';
import { buildMilestonesSummary, buildProgress, buildGoalActivity } from '../utils/computed.js';

export function goalTools(db: Database.Database): ToolDefinition[] {
  return [
    {
      name: 'goal_create',
      description:
        'Create a new Goal. Called once when starting a new project. description is required — a 1-2 sentence summary of what this goal is about, for anyone (or any future session) scanning goal_list later.',
      schema: goalCreateInput,
      handler: (args) => {
        const input = goalCreateInput.parse(args);
        const now = new Date().toISOString();
        const goal: Goal = {
          id: randomUUID(),
          title: input.title,
          description: input.description,
          status: 'active',
          created_at: now,
          updated_at: now,
        };
        db.prepare(
          `INSERT INTO goals (id, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(goal.id, goal.title, goal.description ?? null, goal.status, goal.created_at, goal.updated_at);
        return goal;
      },
    },
    {
      name: 'goal_list',
      description:
        'List Goals, optionally filtered by status. Use to find a goal_id or get an overview of all projects. Each Goal includes is_stale (true when an "active" Goal has had no Goal/Task activity for over 14 days).',
      schema: goalListInput,
      handler: (args) => {
        const input = goalListInput.parse(args);
        const rows = input.status
          ? db.prepare('SELECT * FROM goals WHERE status = ? ORDER BY created_at DESC').all(input.status)
          : db.prepare('SELECT * FROM goals ORDER BY created_at DESC').all();
        const lastTaskUpdateRows = db
          .prepare('SELECT goal_id, MAX(updated_at) as last_update FROM tasks GROUP BY goal_id')
          .all() as { goal_id: string; last_update: string }[];
        const lastTaskUpdateByGoal = new Map(lastTaskUpdateRows.map((r) => [r.goal_id, r.last_update]));
        return rows.map((r) => {
          const goal = rowToGoal(r as Record<string, unknown>);
          const lastTaskUpdate = lastTaskUpdateByGoal.get(goal.id);
          return { ...goal, ...buildGoalActivity(goal, lastTaskUpdate ? [lastTaskUpdate] : []) };
        });
      },
    },
    {
      name: 'goal_get_context',
      description:
        'The single warm-up call for a context-reset Agent: returns the goal (including is_stale), spec, milestones with task counts, out-of-range milestones, aggregate progress, and the last checkpoint. Call this at the start of every session.',
      schema: goalGetContextInput,
      handler: (args) => {
        const { goal_id } = goalGetContextInput.parse(args);

        const goalRow = db.prepare('SELECT * FROM goals WHERE id = ?').get(goal_id);
        if (!goalRow) throw new Error(`Goal not found: ${goal_id}`);
        const goal = rowToGoal(goalRow as Record<string, unknown>);

        const specRow = db.prepare('SELECT * FROM specs WHERE goal_id = ?').get(goal_id);
        const spec = specRow ? rowToSpec(specRow as Record<string, unknown>) : null;

        const milestoneRows = db
          .prepare('SELECT * FROM milestones WHERE goal_id = ? ORDER BY "order" ASC')
          .all(goal_id);
        const taskStatusRows = db
          .prepare('SELECT milestone_id, status, updated_at FROM tasks WHERE goal_id = ?')
          .all(goal_id) as { milestone_id: string; status: TaskStatus; updated_at: string }[];

        const tasksByMilestone = new Map<string, TaskStatus[]>();
        const allStatuses: TaskStatus[] = [];
        const allTaskUpdatedAts: string[] = [];
        for (const row of taskStatusRows) {
          allStatuses.push(row.status);
          allTaskUpdatedAts.push(row.updated_at);
          const list = tasksByMilestone.get(row.milestone_id) ?? [];
          list.push(row.status);
          tasksByMilestone.set(row.milestone_id, list);
        }

        const { milestones, outOfRange, pendingApproval } = buildMilestonesSummary(
          milestoneRows.map((r) => rowToMilestoneBase(r as Record<string, unknown>)),
          tasksByMilestone
        );
        const progress = buildProgress(allStatuses);

        const checkpointRow = db
          .prepare('SELECT * FROM checkpoints WHERE goal_id = ? ORDER BY saved_at DESC LIMIT 1')
          .get(goal_id);
        const last_checkpoint = checkpointRow ? rowToCheckpoint(checkpointRow as Record<string, unknown>) : null;

        return {
          goal: { ...goal, ...buildGoalActivity(goal, allTaskUpdatedAts) },
          spec,
          milestones,
          milestones_out_of_range: outOfRange,
          milestones_pending_approval: pendingApproval,
          progress,
          last_checkpoint,
        };
      },
    },
    {
      name: 'goal_update_status',
      description:
        'Close a finished Goal, archive an inactive one, or reactivate an archived Goal. Merges goal_complete + goal_archive + goal_reactivate.',
      schema: goalUpdateStatusInput,
      handler: (args) => {
        const input = goalUpdateStatusInput.parse(args);
        const existing = db.prepare('SELECT 1 FROM goals WHERE id = ?').get(input.goal_id);
        if (!existing) throw new Error(`Goal not found: ${input.goal_id}`);
        const now = new Date().toISOString();
        db.prepare(
          `UPDATE goals SET status = ?, status_note = COALESCE(?, status_note), updated_at = ? WHERE id = ?`
        ).run(input.status, input.note ?? null, now, input.goal_id);
        return rowToGoal(
          db.prepare('SELECT * FROM goals WHERE id = ?').get(input.goal_id) as Record<string, unknown>
        );
      },
    },
  ];
}
