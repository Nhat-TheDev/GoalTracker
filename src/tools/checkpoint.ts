import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { checkpointSaveInput, rowToCheckpoint, type ToolDefinition } from '../schemas/index.js';

export function checkpointTools(db: Database.Database): ToolDefinition[] {
  return [
    {
      name: 'checkpoint_save',
      description:
        "Save the Agent's current context summary before the session ends. Loaded back via goal_get_context as last_checkpoint.",
      schema: checkpointSaveInput,
      handler: (args) => {
        const input = checkpointSaveInput.parse(args);
        const goalExists = db.prepare('SELECT 1 FROM goals WHERE id = ?').get(input.goal_id);
        if (!goalExists) throw new Error(`Goal not found: ${input.goal_id}`);
        if (input.current_task_id) {
          const taskExists = db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(input.current_task_id);
          if (!taskExists) throw new Error(`Task not found: ${input.current_task_id}`);
        }
        const now = new Date().toISOString();
        const id = randomUUID();
        db.prepare(
          `INSERT INTO checkpoints (id, goal_id, current_task_id, agent_summary, next_actions, saved_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          input.goal_id,
          input.current_task_id ?? null,
          input.agent_summary,
          JSON.stringify(input.next_actions),
          now
        );
        return rowToCheckpoint(
          db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(id) as Record<string, unknown>
        );
      },
    },
  ];
}
