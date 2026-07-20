import type Database from 'better-sqlite3';

export const migration002AddMilestoneApproval = {
  version: 2,
  name: 'add_milestone_approval',
  up(db: Database.Database): void {
    db.exec(`ALTER TABLE milestones ADD COLUMN approved_at TEXT;`);
  },
};
