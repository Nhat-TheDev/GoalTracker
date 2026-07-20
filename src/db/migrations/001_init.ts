import type Database from 'better-sqlite3';

export const migration001Init = {
  version: 1,
  name: 'init',
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE goals (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        description TEXT,
        status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
        status_note TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE specs (
        goal_id             TEXT PRIMARY KEY REFERENCES goals(id),
        overview            TEXT NOT NULL,
        acceptance_criteria TEXT NOT NULL DEFAULT '[]',
        constraints         TEXT NOT NULL DEFAULT '[]',
        out_of_scope        TEXT NOT NULL DEFAULT '[]',
        updated_at          TEXT NOT NULL
      );

      CREATE TABLE milestones (
        id          TEXT PRIMARY KEY,
        goal_id     TEXT NOT NULL REFERENCES goals(id),
        title       TEXT NOT NULL,
        description TEXT,
        "order"     INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE tasks (
        id            TEXT PRIMARY KEY,
        milestone_id  TEXT NOT NULL REFERENCES milestones(id),
        goal_id       TEXT NOT NULL REFERENCES goals(id),
        title         TEXT NOT NULL,
        description   TEXT,
        status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','blocked','cancelled')),
        priority      TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
        status_reason TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE notes (
        id         TEXT PRIMARY KEY,
        task_id    TEXT NOT NULL REFERENCES tasks(id),
        content    TEXT NOT NULL,
        type       TEXT NOT NULL DEFAULT 'progress' CHECK (type IN ('progress','blocker','decision','evidence','uncertainty')),
        created_at TEXT NOT NULL
      );

      CREATE TABLE checkpoints (
        id              TEXT PRIMARY KEY,
        goal_id         TEXT NOT NULL REFERENCES goals(id),
        current_task_id TEXT REFERENCES tasks(id),
        agent_summary   TEXT NOT NULL,
        next_actions    TEXT NOT NULL DEFAULT '[]',
        saved_at        TEXT NOT NULL
      );

      CREATE INDEX idx_tasks_goal       ON tasks(goal_id);
      CREATE INDEX idx_tasks_milestone  ON tasks(milestone_id);
      CREATE INDEX idx_tasks_status     ON tasks(status);
      CREATE INDEX idx_milestones_goal  ON milestones(goal_id);
      CREATE INDEX idx_notes_task       ON notes(task_id);
      CREATE INDEX idx_checkpoints_goal ON checkpoints(goal_id, saved_at DESC);
    `);
  },
};
