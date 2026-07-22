import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  milestoneCreateInput,
  milestoneApproveInput,
  rowToMilestoneBase,
  type TaskStatus,
  type ToolDefinition,
} from '../schemas/index.js';
import { computeMilestoneStatus } from '../utils/computed.js';

export function milestoneTools(db: Database.Database): ToolDefinition[] {
  return [
    {
      name: 'milestone_create',
      description:
        'Break a Goal into a major phase. Status is auto-computed from its tasks. When order is omitted, it auto-assigns to max(order in this goal) + 1. description is not required by this tool, but use it to state which breakdown strategy this milestone follows and why — not just a restated title.',
      schema: milestoneCreateInput,
      handler: (args) => {
        const input = milestoneCreateInput.parse(args);
        const goalExists = db.prepare('SELECT 1 FROM goals WHERE id = ?').get(input.goal_id);
        if (!goalExists) throw new Error(`Goal not found: ${input.goal_id}`);

        let order = input.order;
        if (order === undefined) {
          const row = db
            .prepare('SELECT MAX("order") as maxOrder FROM milestones WHERE goal_id = ?')
            .get(input.goal_id) as { maxOrder: number | null };
          order = (row.maxOrder ?? -1) + 1;
        }

        const now = new Date().toISOString();
        const id = randomUUID();
        db.prepare(
          `INSERT INTO milestones (id, goal_id, title, description, "order", created_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(id, input.goal_id, input.title, input.description ?? null, order, now);

        const row = db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as Record<string, unknown>;
        return { ...rowToMilestoneBase(row), status: computeMilestoneStatus([], undefined) };
      },
    },
    {
      name: 'milestone_approve',
      description:
        'Explicitly approve a Milestone that has fewer than 2 active tasks, lifting the restriction that blocks task_update_status from starting work on its tasks. Only call this after actually confirming with the user that a small Milestone is intentional — not as a shortcut to unblock yourself.',
      schema: milestoneApproveInput,
      handler: (args) => {
        const { milestone_id } = milestoneApproveInput.parse(args);
        const existing = db.prepare('SELECT 1 FROM milestones WHERE id = ?').get(milestone_id);
        if (!existing) throw new Error(`Milestone not found: ${milestone_id}`);

        db.prepare('UPDATE milestones SET approved_at = ? WHERE id = ?').run(
          new Date().toISOString(),
          milestone_id
        );

        const row = db.prepare('SELECT * FROM milestones WHERE id = ?').get(milestone_id) as Record<
          string,
          unknown
        >;
        const statuses = (
          db.prepare('SELECT status FROM tasks WHERE milestone_id = ?').all(milestone_id) as {
            status: TaskStatus;
          }[]
        ).map((r) => r.status);

        const base = rowToMilestoneBase(row);
        return { ...base, status: computeMilestoneStatus(statuses, base.approved_at) };
      },
    },
  ];
}
