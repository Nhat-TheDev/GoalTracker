#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { openDb } from './db/client.js';
import { goalTools } from './tools/goal.js';
import { specTools } from './tools/spec.js';
import { milestoneTools } from './tools/milestone.js';
import { taskTools } from './tools/task.js';
import { statusTools } from './tools/status.js';
import { checkpointTools } from './tools/checkpoint.js';
import type { ToolDefinition } from './schemas/index.js';
import { installSkill } from './installSkill.js';

async function runServer(): Promise<void> {
  const db = openDb();

  const tools: ToolDefinition[] = [
    ...goalTools(db),
    ...specTools(db),
    ...milestoneTools(db),
    ...taskTools(db),
    ...statusTools(db),
    ...checkpointTools(db),
  ];

  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

  const server = new Server({ name: 'GoalTracker', version: '1.0.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.schema) as Tool['inputSchema'],
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolsByName.get(request.params.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Error: unknown tool "${request.params.name}"` }],
        isError: true,
      };
    }
    try {
      const result = tool.handler(request.params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main(): Promise<void> {
  const [, , subcommand, ...rest] = process.argv;
  if (subcommand === 'install-skill') {
    const target = installSkill(rest);
    console.log(`Installed GoalTracker skill to ${target}`);
    return;
  }
  await runServer();
}

main().catch((error) => {
  console.error('Fatal error starting GoalTracker MCP server:', error);
  process.exit(1);
});
