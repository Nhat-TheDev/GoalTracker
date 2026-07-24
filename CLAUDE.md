# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

GoalTracker is an MCP (Model Context Protocol) server, published to npm, that gives AI coding agents persistent project memory: a `Goal → Spec → Milestone → Task → Note` hierarchy stored in a single SQLite file. It exposes 14 MCP tools over stdio transport. A companion "skill" (`.claude/skills/goaltracker/SKILL.md`) teaches an agent the correct call sequence for using those tools; it is bundled into the npm package and can be installed into any project via `npx goaltracker install-skill`.

## Commands

```bash
npm run dev         # run the server directly from src/ with tsx, no build step
npm run build        # generate embedded skill content, then tsc compile to dist/
npm run typecheck    # tsc --noEmit
npm test              # vitest run (all tests)
npx vitest run src/integration.test.ts   # run a single test file
npx vitest run -t "milestone approval gate"  # run tests matching a name
```

Every one of `build`, `dev`, `typecheck`, and `test` runs `generate:skill` first via an npm `pre*` hook — it regenerates `src/skillContent.ts` from `.claude/skills/goaltracker/SKILL.md`. That generated file is gitignored; never edit it directly, edit the SKILL.md source instead.

CI (`.github/workflows/verify-mcp-build.yml`) runs `npm ci`, `typecheck`, `test`, `build` on Node 22, on push to `master` and on every PR.

## Architecture

**Request flow:** `src/index.ts` opens the DB, collects tool arrays from each `src/tools/*.ts` module into one flat list, and registers two MCP handlers: `ListToolsRequestSchema` (advertises tools, JSON-schema generated from each tool's zod schema via `z.toJSONSchema`) and `CallToolRequestSchema` (dispatches by tool name, catches thrown errors and returns them as `isError: true` text content rather than protocol-level errors).

**Tool module pattern:** each file under `src/tools/` (`goal.ts`, `spec.ts`, `milestone.ts`, `task.ts`, `status.ts`, `checkpoint.ts`) exports a `xTools(db): ToolDefinition[]` factory closing over the `better-sqlite3` `Database` handle. Each `ToolDefinition` bundles a zod input schema, a description string written *for the agent* (not for a human reader — these are read by the LLM at call time and are load-bearing for correct usage), and a synchronous handler that parses input, runs raw SQL (no ORM), and returns a plain object serialized to JSON by `index.ts`.

**Schemas (`src/schemas/index.ts`):** single file holding every zod model, every tool's input schema, and `rowTo*` mapper functions that convert raw SQLite rows into typed model objects (handling `null → undefined` and JSON-encoded array columns like `acceptance_criteria`). When adding a tool or field, this is the one file that grows.

**Computed state (`src/utils/computed.ts`):** milestone `status` and `milestones_pending_approval`/`milestones_out_of_range` are never stored — they're derived on every read from the task rows belonging to that milestone. `computeMilestoneStatus` has a specific, deliberate branch order (empty → all-done → needs-approval → all-pending → in_progress); read the doc comments in that file before touching it, since reordering the branches silently breaks edge cases (e.g. a single completed task in an under-sized milestone).

**Migrations (`src/db/client.ts` + `src/db/migrations/*.ts`):** plain TypeScript modules (not `.sql` files, so they survive the `tsc` build), each exporting `{ version, name, up(db) }`. `client.ts` holds a hardcoded `migrations` array in order; `runMigrations` tracks applied versions in a `_migrations` table and applies pending ones inside a transaction on every `openDb()` call. Adding a schema change = write `00N_description.ts`, append it to the array — never edit an already-shipped migration.

**One real validation gate:** almost everything in this MCP is "data only, no reasoning" — it stores what it's given and never rejects a call on judgment grounds. The two deliberate exceptions (see `docs/design/05-decisions.md`): (1) a milestone with fewer than 2 active tasks blocks `task_update_status(..., status: "in_progress")` on its tasks until `milestone_approve` is explicitly called; (2) `goal_create` requires a non-empty `description`. Don't add further validation-as-judgment without checking that file first — several similar proposals were deliberately rejected there.

**Skill content pipeline:** `scripts/generate-skill-content.mjs` reads `.claude/skills/goaltracker/SKILL.md`, escapes it, and writes it as a template-literal export in `src/skillContent.ts`, which `src/installSkill.ts` writes out verbatim to `~/.claude/skills/goaltracker/SKILL.md` (or `./.claude/skills/` with `--project`) when a user runs `npx goaltracker install-skill`. The skill is the only place presentation templates (for spec/plan review) live — deliberately not returned by any tool, to avoid paying a token cost on every call (see `docs/design/05-decisions.md`, "Rejected: MCP-provided presentation templates").

**Design docs:** `docs/design/DESIGN.md` is the index into `01-data-model.md` (entity schemas + DDL), `02-tools.md` (full input/output per tool), `03-workflows.md` (expected agent call sequences), `04-stack-and-structure.md`, `05-decisions.md` (accepted/rejected proposals with rationale — read before adding entities, tools, or validation), and `06-changelog.md`. These are the source of truth for *why* the schema looks the way it does; consult them before proposing new tables, tools, or gates.

## Testing

- `src/integration.test.ts` — wires all tool modules directly against a temp-file SQLite DB (no MCP transport), exercising business logic like the milestone approval gate.
- `src/e2e.test.ts` — spawns the real server via `tsx` over stdio using the actual MCP `Client`/`StdioClientTransport`, verifying the wire protocol end-to-end.
- `src/installSkill.test.ts`, `src/utils/computed.test.ts` — unit-level.

Both integration and e2e tests create a fresh temp SQLite file per test (`mkdtempSync`) and clean it up in `afterEach` — follow that pattern for new DB-touching tests rather than sharing state across tests.
