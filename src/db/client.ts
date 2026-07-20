import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { migration001Init } from './migrations/001_init.js';
import { migration002AddMilestoneApproval } from './migrations/002_add_milestone_approval.js';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

// Future schema changes: add a new 00N_description.ts migration module and
// list it here. It auto-applies (in order, inside a transaction) against
// every existing user's DB the next time the server starts.
const migrations: Migration[] = [migration001Init, migration002AddMilestoneApproval];

const DEFAULT_DB_PATH = path.join(os.homedir(), '.goaltracker', 'goaltracker.db');

export function openDb(
  dbPath: string = process.env.GOALTRACKER_DB_PATH ?? DEFAULT_DB_PATH
): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT version FROM _migrations').all() as { version: number }[]).map(
      (row) => row.version
    )
  );

  const insertMigration = db.prepare(
    'INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)'
  );

  const pending = migrations.filter((m) => !applied.has(m.version)).sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    const apply = db.transaction(() => {
      migration.up(db);
      insertMigration.run(migration.version, migration.name, new Date().toISOString());
    });
    apply();
  }
}
