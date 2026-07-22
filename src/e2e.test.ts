import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const TSX_BIN = path.join(import.meta.dirname, '..', 'node_modules', '.bin', 'tsx');
const SERVER_ENTRY = path.join(import.meta.dirname, 'index.ts');

function parseResult(result: { content: { type: string; text?: string }[] }): any {
  return JSON.parse(result.content[0]!.text!);
}

describe('MCP server e2e (real stdio transport)', () => {
  let dir: string;
  let client: Client;
  let transport: StdioClientTransport;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'goaltracker-e2e-'));
    transport = new StdioClientTransport({
      command: TSX_BIN,
      args: [SERVER_ENTRY],
      env: { ...getDefaultEnvironment(), GOALTRACKER_DB_PATH: path.join(dir, 'e2e.db') },
    });
    client = new Client({ name: 'e2e-test-client', version: '1.0.0' });
    await client.connect(transport);
  }, 15000);

  afterEach(async () => {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists all registered tools over the real JSON-RPC transport', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'goal_create',
        'spec_set',
        'milestone_create',
        'task_create',
        'task_update_status',
        'status_report',
        'checkpoint_save',
      ])
    );
  });

  it('surfaces tool validation errors as isError responses', async () => {
    const result = await client.callTool({ name: 'goal_create', arguments: { title: 'No description' } });
    expect(result.isError).toBe(true);
  });

  it('runs a full goal -> milestone -> task -> status flow through real callTool round-trips', async () => {
    const goal = parseResult(
      await client.callTool({
        name: 'goal_create',
        arguments: { title: 'E2E goal', description: 'A goal created through the real MCP transport.' },
      })
    );

    const milestone = parseResult(
      await client.callTool({
        name: 'milestone_create',
        arguments: { goal_id: goal.id, title: 'E2E milestone' },
      })
    );

    const t1 = parseResult(
      await client.callTool({ name: 'task_create', arguments: { milestone_id: milestone.id, title: 'A' } })
    );
    const t2 = parseResult(
      await client.callTool({ name: 'task_create', arguments: { milestone_id: milestone.id, title: 'B' } })
    );
    expect(t2.milestone_active_task_count).toBe(2);

    const started = parseResult(
      await client.callTool({ name: 'task_update_status', arguments: { task_id: t1.id, status: 'in_progress' } })
    );
    expect(started.status).toBe('in_progress');
  });
});
