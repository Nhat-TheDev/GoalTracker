import { describe, it, expect } from 'vitest';
import {
  computeMilestoneStatus,
  completionPct,
  isMilestoneOutOfRange,
  needsApproval,
  emptyTaskStatusCounts,
  buildGoalActivity,
  STALE_THRESHOLD_DAYS,
} from './computed.js';

describe('computeMilestoneStatus', () => {
  it('is pending when there are no tasks yet', () => {
    expect(computeMilestoneStatus([], undefined)).toBe('pending');
  });

  it('is completed once every task is completed or cancelled, even below the 2-active minimum and even unapproved', () => {
    expect(computeMilestoneStatus(['completed'], undefined)).toBe('completed');
    expect(computeMilestoneStatus(['completed', 'completed'], undefined)).toBe('completed');
    expect(computeMilestoneStatus(['completed', 'cancelled', 'completed'], undefined)).toBe('completed');
  });

  it('is pending (awaiting approval) when below 2 active tasks, not all done, and not approved', () => {
    expect(computeMilestoneStatus(['pending'], undefined)).toBe('pending');
  });

  it('is pending start (not gated) once approved_at is set, even below 2 active tasks', () => {
    expect(computeMilestoneStatus(['pending'], '2026-07-19T00:00:00.000Z')).toBe('pending');
  });

  it('is pending when 2+ active tasks exist but none have started', () => {
    expect(computeMilestoneStatus(['pending', 'pending'], undefined)).toBe('pending');
  });

  it('is in_progress when work has started but is not all done', () => {
    expect(computeMilestoneStatus(['in_progress', 'pending'], undefined)).toBe('in_progress');
    expect(computeMilestoneStatus(['completed', 'pending'], undefined)).toBe('in_progress');
    expect(computeMilestoneStatus(['completed', 'blocked'], undefined)).toBe('in_progress');
  });

  it('is completed for an all-cancelled milestone too, not just all-completed', () => {
    expect(computeMilestoneStatus(['cancelled'], undefined)).toBe('completed');
    expect(computeMilestoneStatus(['cancelled', 'cancelled'], undefined)).toBe('completed');
  });

  it('rule order: the cancelled-exclusion from needsApproval still applies through the full function, not just in isolation', () => {
    expect(computeMilestoneStatus(['cancelled', 'pending'], undefined)).toBe('pending');
  });

  it('reads an all-blocked milestone as in_progress once it clears the 2-active-task gate — Milestone has no dedicated blocked status', () => {
    expect(computeMilestoneStatus(['blocked', 'blocked'], undefined)).toBe('in_progress');
  });

  it('reads a single blocked task as pending (awaiting approval), same gate as a single pending task', () => {
    expect(computeMilestoneStatus(['blocked'], undefined)).toBe('pending');
  });
});

describe('completionPct', () => {
  it('is null when there are no measurable tasks', () => {
    expect(completionPct(emptyTaskStatusCounts())).toBeNull();
    expect(completionPct({ ...emptyTaskStatusCounts(), cancelled: 3 })).toBeNull();
  });

  it('excludes cancelled tasks from the denominator', () => {
    const counts = { pending: 0, in_progress: 0, completed: 2, blocked: 0, cancelled: 2 };
    expect(completionPct(counts)).toBe(100);
  });

  it('computes a partial percentage', () => {
    const counts = { pending: 1, in_progress: 1, completed: 1, blocked: 1, cancelled: 0 };
    expect(completionPct(counts)).toBe(25);
  });
});

describe('isMilestoneOutOfRange', () => {
  it('flags fewer than 2 or more than 5 active tasks', () => {
    expect(isMilestoneOutOfRange(['pending'])).toBe(true);
    expect(isMilestoneOutOfRange(Array(6).fill('pending'))).toBe(true);
    expect(isMilestoneOutOfRange(Array(3).fill('pending'))).toBe(false);
  });

  it('does not count cancelled tasks as active', () => {
    expect(isMilestoneOutOfRange(['cancelled', 'cancelled', 'pending'])).toBe(true);
  });
});

describe('needsApproval', () => {
  it('requires approval when below 2 active tasks and not yet approved', () => {
    expect(needsApproval(['pending'], undefined)).toBe(true);
    expect(needsApproval([], undefined)).toBe(true);
  });

  it('does not require approval once approved_at is set, regardless of active count', () => {
    expect(needsApproval(['pending'], '2026-07-19T00:00:00.000Z')).toBe(false);
    expect(needsApproval([], '2026-07-19T00:00:00.000Z')).toBe(false);
  });

  it('does not require approval once there are 2+ active tasks, even if never approved', () => {
    expect(needsApproval(['pending', 'pending'], undefined)).toBe(false);
  });

  it('ignores cancelled tasks when counting toward the 2-task minimum', () => {
    expect(needsApproval(['pending', 'cancelled'], undefined)).toBe(true);
  });
});

describe('buildGoalActivity', () => {
  const now = new Date('2026-08-24T00:00:00.000Z');

  it('falls back to the goal updated_at when there are no tasks', () => {
    const result = buildGoalActivity(
      { status: 'active', updated_at: '2026-08-20T00:00:00.000Z' },
      [],
      now
    );
    expect(result.last_activity_at).toBe('2026-08-20T00:00:00.000Z');
    expect(result.days_since_last_activity).toBe(4);
  });

  it('picks whichever of goal.updated_at or a task updated_at is most recent', () => {
    const result = buildGoalActivity(
      { status: 'active', updated_at: '2026-08-01T00:00:00.000Z' },
      ['2026-08-10T00:00:00.000Z', '2026-08-22T00:00:00.000Z'],
      now
    );
    expect(result.last_activity_at).toBe('2026-08-22T00:00:00.000Z');
    expect(result.days_since_last_activity).toBe(2);
  });

  it(`is stale when active and last activity is over ${STALE_THRESHOLD_DAYS} days ago`, () => {
    const result = buildGoalActivity(
      { status: 'active', updated_at: '2026-07-01T00:00:00.000Z' },
      [],
      now
    );
    expect(result.is_stale).toBe(true);
  });

  it('is not stale when active and within the threshold', () => {
    const result = buildGoalActivity(
      { status: 'active', updated_at: '2026-08-20T00:00:00.000Z' },
      [],
      now
    );
    expect(result.is_stale).toBe(false);
  });

  it('is never stale for completed or archived goals, regardless of age', () => {
    const stale_input = { status: 'completed' as const, updated_at: '2026-01-01T00:00:00.000Z' };
    expect(buildGoalActivity(stale_input, [], now).is_stale).toBe(false);
    expect(
      buildGoalActivity({ status: 'archived' as const, updated_at: '2026-01-01T00:00:00.000Z' }, [], now)
        .is_stale
    ).toBe(false);
  });
});
