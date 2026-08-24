import type { TaskStatus, Milestone, GoalStatus } from '../schemas/index.js';

export type TaskStatusCounts = Record<TaskStatus, number>;

export function emptyTaskStatusCounts(): TaskStatusCounts {
  return { pending: 0, in_progress: 0, completed: 0, blocked: 0, cancelled: 0 };
}

export function activeTaskCount(taskStatuses: TaskStatus[]): number {
  return taskStatuses.filter((s) => s !== 'cancelled').length;
}

export function isMilestoneOutOfRange(taskStatuses: TaskStatus[]): boolean {
  const count = activeTaskCount(taskStatuses);
  return count < 2 || count > 5;
}

/**
 * The 5-active-task upper bound stays advisory only (see docs/design/05-decisions.md,
 * "Rejected: hard cap on Milestone task count"). The 2-active-task lower
 * bound is enforced instead: a Milestone below it needs an explicit
 * milestone_approve before task_update_status will allow starting work on
 * its tasks. This checks that lower-bound gate.
 */
export function needsApproval(taskStatuses: TaskStatus[], approvedAt: string | undefined): boolean {
  return approvedAt === undefined && activeTaskCount(taskStatuses) < 2;
}

/**
 * "All tasks completed/cancelled" is checked before the approval-gate rule,
 * so a Milestone whose only task(s) are already done always reads
 * "completed" — even if that leaves it under the 2-active-task minimum.
 * Without this order, a 1-task Milestone whose sole task is completed would
 * be stuck reading "pending" forever, since the <2-active-tasks check would
 * always match first. (This is also why an empty Milestone needs its own
 * check first: `[].every(...)` is vacuously true and would otherwise read
 * as "completed" before it has any tasks at all.)
 *
 * Note "pending" still covers two different situations that this field
 * alone doesn't distinguish: a Milestone below the 2-active-task minimum
 * and not yet approved (in effect "pending approval" — see needsApproval)
 * versus one at/above that minimum, or already approved, where no task has
 * started yet ("pending start"). Callers that need to tell them apart
 * should check approved_at / needsApproval too.
 */
export function computeMilestoneStatus(
  taskStatuses: TaskStatus[],
  approvedAt: string | undefined
): Milestone['status'] {
  if (taskStatuses.length === 0) return 'pending';
  if (taskStatuses.every((s) => s === 'completed' || s === 'cancelled')) return 'completed';
  if (needsApproval(taskStatuses, approvedAt)) return 'pending';
  if (taskStatuses.every((s) => s === 'pending')) return 'pending';
  return 'in_progress';
}

export function completionPct(counts: TaskStatusCounts): number | null {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const denom = total - counts.cancelled;
  if (denom === 0) return null;
  return (counts.completed / denom) * 100;
}

export interface MilestoneWithCounts {
  milestone: Milestone;
  task_counts: TaskStatusCounts;
}

export function buildMilestonesSummary(
  milestones: Array<Omit<Milestone, 'status'>>,
  tasksByMilestone: Map<string, TaskStatus[]>
): { milestones: MilestoneWithCounts[]; outOfRange: string[]; pendingApproval: string[] } {
  const result: MilestoneWithCounts[] = [];
  const outOfRange: string[] = [];
  const pendingApproval: string[] = [];

  for (const m of milestones) {
    const statuses = tasksByMilestone.get(m.id) ?? [];
    const status = computeMilestoneStatus(statuses, m.approved_at);
    const counts = emptyTaskStatusCounts();
    for (const s of statuses) counts[s]++;
    result.push({ milestone: { ...m, status }, task_counts: counts });
    if (status !== 'completed' && isMilestoneOutOfRange(statuses)) {
      outOfRange.push(m.id);
    }
    if (status !== 'completed' && needsApproval(statuses, m.approved_at)) {
      pendingApproval.push(m.id);
    }
  }

  return { milestones: result, outOfRange, pendingApproval };
}

export function buildProgress(taskStatuses: TaskStatus[]) {
  const counts = emptyTaskStatusCounts();
  for (const s of taskStatuses) counts[s]++;
  return {
    total_tasks: taskStatuses.length,
    ...counts,
    completion_pct: completionPct(counts),
  };
}

/** A Goal not touched in this many days reads as stale (only while still "active"). */
export const STALE_THRESHOLD_DAYS = 14;

export interface GoalActivity {
  last_activity_at: string;
  days_since_last_activity: number;
  is_stale: boolean;
}

/**
 * last_activity_at is the max of the Goal's own updated_at and every one of
 * its tasks' updated_at (falls back to just the Goal's updated_at when it
 * has no tasks yet). is_stale only applies to "active" Goals — a
 * completed/archived Goal isn't stale, it's resolved, no matter how old.
 */
export function buildGoalActivity(
  goal: { status: GoalStatus; updated_at: string },
  taskUpdatedAts: string[],
  now: Date = new Date()
): GoalActivity {
  const lastActivityAt = [goal.updated_at, ...taskUpdatedAts].reduce((latest, ts) =>
    new Date(ts).getTime() > new Date(latest).getTime() ? ts : latest
  );
  const daysSinceLastActivity = Math.floor(
    (now.getTime() - new Date(lastActivityAt).getTime()) / 86_400_000
  );
  return {
    last_activity_at: lastActivityAt,
    days_since_last_activity: daysSinceLastActivity,
    is_stale: goal.status === 'active' && daysSinceLastActivity > STALE_THRESHOLD_DAYS,
  };
}
