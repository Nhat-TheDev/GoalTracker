import type Database from 'better-sqlite3';
import {
  statusReportInput,
  rowToGoal,
  rowToMilestoneBase,
  rowToTask,
  rowToNote,
  type TaskStatus,
  type ToolDefinition,
} from '../schemas/index.js';
import { buildMilestonesSummary, buildProgress } from '../utils/computed.js';

export function statusTools(db: Database.Database): ToolDefinition[] {
  return [
    {
      name: 'status_report',
      description:
        'Periodic review / pre-closure check. Returns aggregate progress, milestones with task counts, blocked tasks, and the acceptance criteria list. Data only — no suggestions.',
      schema: statusReportInput,
      handler: (args) => {
        const { goal_id } = statusReportInput.parse(args);

        const goalRow = db.prepare('SELECT * FROM goals WHERE id = ?').get(goal_id);
        if (!goalRow) throw new Error(`Goal not found: ${goal_id}`);
        const goal = rowToGoal(goalRow as Record<string, unknown>);

        const milestoneRows = db
          .prepare('SELECT * FROM milestones WHERE goal_id = ? ORDER BY "order" ASC')
          .all(goal_id);
        const taskRows = db
          .prepare('SELECT * FROM tasks WHERE goal_id = ?')
          .all(goal_id)
          .map((r) => rowToTask(r as Record<string, unknown>));

        const tasksByMilestone = new Map<string, TaskStatus[]>();
        for (const t of taskRows) {
          const list = tasksByMilestone.get(t.milestone_id) ?? [];
          list.push(t.status);
          tasksByMilestone.set(t.milestone_id, list);
        }
        const { milestones, outOfRange, pendingApproval } = buildMilestonesSummary(
          milestoneRows.map((r) => rowToMilestoneBase(r as Record<string, unknown>)),
          tasksByMilestone
        );
        const progress = buildProgress(taskRows.map((t) => t.status));

        const blocked_tasks = taskRows
          .filter((t) => t.status === 'blocked')
          .map((t) => {
            const latestNoteRow = db
              .prepare('SELECT * FROM notes WHERE task_id = ? ORDER BY created_at DESC LIMIT 1')
              .get(t.id);
            return {
              task: t,
              blocked_reason: t.status_reason ?? '',
              latest_note: latestNoteRow ? rowToNote(latestNoteRow as Record<string, unknown>) : undefined,
            };
          });

        const specRow = db.prepare('SELECT acceptance_criteria FROM specs WHERE goal_id = ?').get(goal_id) as
          | { acceptance_criteria: string }
          | undefined;
        const acceptance_criteria: string[] = specRow ? JSON.parse(specRow.acceptance_criteria) : [];

        return {
          goal,
          progress,
          milestones,
          milestones_out_of_range: outOfRange,
          milestones_pending_approval: pendingApproval,
          blocked_tasks,
          acceptance_criteria,
        };
      },
    },
  ];
}
