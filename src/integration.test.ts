import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb } from './db/client.js';
import { migration001Init } from './db/migrations/001_init.js';
import { goalTools } from './tools/goal.js';
import { specTools } from './tools/spec.js';
import { milestoneTools } from './tools/milestone.js';
import { taskTools } from './tools/task.js';
import { statusTools } from './tools/status.js';
import { checkpointTools } from './tools/checkpoint.js';
import type { ToolDefinition } from './schemas/index.js';

function wire(db: Database.Database) {
  const all: ToolDefinition[] = [
    ...goalTools(db),
    ...specTools(db),
    ...milestoneTools(db),
    ...taskTools(db),
    ...statusTools(db),
    ...checkpointTools(db),
  ];
  const byName = new Map(all.map((t) => [t.name, t]));
  return (name: string, args: unknown) => byName.get(name)!.handler(args) as any;
}

describe('milestone approval gate', () => {
  let dir: string;
  let db: Database.Database;
  let call: ReturnType<typeof wire>;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'goaltracker-test-'));
    db = openDb(path.join(dir, 'test.db'));
    call = wire(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects starting work on an unapproved undersized milestone, then allows it after approval', () => {
    const goal = call('goal_create', { title: 'Test goal' });
    const milestone = call('milestone_create', { goal_id: goal.id, title: 'Small milestone' });
    const task = call('task_create', { milestone_id: milestone.id, title: 'Only task' });
    expect(task.milestone_active_task_count).toBe(1);

    expect(() => call('task_update_status', { task_id: task.id, status: 'in_progress' })).toThrow(
      /milestone_approve/
    );

    const approved = call('milestone_approve', { milestone_id: milestone.id });
    expect(approved.approved_at).toBeTruthy();

    const started = call('task_update_status', { task_id: task.id, status: 'in_progress' });
    expect(started.status).toBe('in_progress');
  });

  it('never gates transitions other than "in_progress"', () => {
    const goal = call('goal_create', { title: 'Test goal' });
    const milestone = call('milestone_create', { goal_id: goal.id, title: 'Small milestone' });
    const task = call('task_create', { milestone_id: milestone.id, title: 'Only task' });

    expect(() =>
      call('task_update_status', { task_id: task.id, status: 'blocked', reason: 'testing' })
    ).not.toThrow();
    expect(() =>
      call('task_update_status', { task_id: task.id, status: 'cancelled', reason: 'testing' })
    ).not.toThrow();
  });

  it('does not gate a milestone that starts with 2+ active tasks', () => {
    const goal = call('goal_create', { title: 'Test goal' });
    const milestone = call('milestone_create', { goal_id: goal.id, title: 'Right-sized milestone' });
    const t1 = call('task_create', { milestone_id: milestone.id, title: 'A' });
    const t2 = call('task_create', { milestone_id: milestone.id, title: 'B' });
    expect(t2.milestone_active_task_count).toBe(2);

    expect(() => call('task_update_status', { task_id: t1.id, status: 'in_progress' })).not.toThrow();
  });

  it('stays approved permanently even if active task count drops back below 2', () => {
    const goal = call('goal_create', { title: 'Test goal' });
    const milestone = call('milestone_create', { goal_id: goal.id, title: 'Small milestone' });
    const t1 = call('task_create', { milestone_id: milestone.id, title: 'First' });
    call('milestone_approve', { milestone_id: milestone.id });
    call('task_update_status', { task_id: t1.id, status: 'in_progress' });
    call('task_update_status', { task_id: t1.id, status: 'cancelled', reason: 'testing' });

    const t2 = call('task_create', { milestone_id: milestone.id, title: 'Second, after count dropped to 0' });
    expect(() => call('task_update_status', { task_id: t2.id, status: 'in_progress' })).not.toThrow();
  });

  it('flags an unapproved undersized milestone in milestones_pending_approval, and drops it once approved', () => {
    const goal = call('goal_create', { title: 'Test goal' });
    const milestone = call('milestone_create', { goal_id: goal.id, title: 'Small milestone' });
    call('task_create', { milestone_id: milestone.id, title: 'Only task' });

    let ctx = call('goal_get_context', { goal_id: goal.id });
    expect(ctx.milestones_pending_approval).toContain(milestone.id);

    call('milestone_approve', { milestone_id: milestone.id });
    ctx = call('goal_get_context', { goal_id: goal.id });
    expect(ctx.milestones_pending_approval).not.toContain(milestone.id);
  });

  it('reads a milestone as completed once its only task is done, even though it was never approved', () => {
    const goal = call('goal_create', { title: 'Test goal' });
    const milestone = call('milestone_create', { goal_id: goal.id, title: 'Small milestone' });
    const task = call('task_create', { milestone_id: milestone.id, title: 'Only task' });
    call('milestone_approve', { milestone_id: milestone.id });
    call('task_update_status', { task_id: task.id, status: 'in_progress' });
    call('task_update_status', { task_id: task.id, status: 'completed' });

    const ctx = call('goal_get_context', { goal_id: goal.id });
    const found = ctx.milestones.find((m: any) => m.milestone.id === milestone.id);
    expect(found.milestone.status).toBe('completed');
    expect(ctx.milestones_out_of_range).not.toContain(milestone.id);
    expect(ctx.milestones_pending_approval).not.toContain(milestone.id);
  });
});

describe('migration upgrade path', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'goaltracker-test-'));
    dbPath = path.join(dir, 'upgrade.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('auto-applies a new migration against a DB that only has an older one applied', () => {
    // Simulate a DB created before migration 002 existed.
    const oldDb = new Database(dbPath);
    oldDb.exec(
      `CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);`
    );
    migration001Init.up(oldDb);
    oldDb
      .prepare('INSERT INTO _migrations (version, name, applied_at) VALUES (1, ?, ?)')
      .run('init', new Date().toISOString());
    const columnsBefore = oldDb.prepare('PRAGMA table_info(milestones)').all() as { name: string }[];
    expect(columnsBefore.some((c) => c.name === 'approved_at')).toBe(false);
    oldDb.close();

    // Now open it with the real, current openDb() — this is the actual upgrade path.
    const db = openDb(dbPath);
    const migrations = db.prepare('SELECT version FROM _migrations ORDER BY version').all() as {
      version: number;
    }[];
    expect(migrations.map((m) => m.version)).toEqual([1, 2]);

    const columnsAfter = db.prepare('PRAGMA table_info(milestones)').all() as { name: string }[];
    expect(columnsAfter.some((c) => c.name === 'approved_at')).toBe(true);
    db.close();
  });

  it('does not re-apply or duplicate a migration when reopened again', () => {
    const db1 = openDb(dbPath);
    db1.close();
    const db2 = openDb(dbPath);
    const migrations = db2.prepare('SELECT version FROM _migrations ORDER BY version').all() as {
      version: number;
    }[];
    expect(migrations.map((m) => m.version)).toEqual([1, 2]);
    db2.close();
  });
});
