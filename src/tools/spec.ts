import type Database from 'better-sqlite3';
import { specSetInput, rowToSpec, type ToolDefinition } from '../schemas/index.js';

export function specTools(db: Database.Database): ToolDefinition[] {
  return [
    {
      name: 'spec_set',
      description:
        'Create or overwrite the Spec for a Goal (overview, acceptance criteria, constraints, out of scope). Create-or-replace semantics — call again any time the spec changes.',
      schema: specSetInput,
      handler: (args) => {
        const input = specSetInput.parse(args);
        const goalExists = db.prepare('SELECT 1 FROM goals WHERE id = ?').get(input.goal_id);
        if (!goalExists) throw new Error(`Goal not found: ${input.goal_id}`);
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO specs (goal_id, overview, acceptance_criteria, constraints, out_of_scope, updated_at)
           VALUES (@goal_id, @overview, @acceptance_criteria, @constraints, @out_of_scope, @updated_at)
           ON CONFLICT(goal_id) DO UPDATE SET
             overview = excluded.overview,
             acceptance_criteria = excluded.acceptance_criteria,
             constraints = excluded.constraints,
             out_of_scope = excluded.out_of_scope,
             updated_at = excluded.updated_at`
        ).run({
          goal_id: input.goal_id,
          overview: input.overview,
          acceptance_criteria: JSON.stringify(input.acceptance_criteria),
          constraints: JSON.stringify(input.constraints ?? []),
          out_of_scope: JSON.stringify(input.out_of_scope ?? []),
          updated_at: now,
        });
        return rowToSpec(
          db.prepare('SELECT * FROM specs WHERE goal_id = ?').get(input.goal_id) as Record<string, unknown>
        );
      },
    },
  ];
}
