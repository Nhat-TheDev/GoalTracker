# Tech Stack & Project Structure

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Server name** | `GoalTracker` | — |
| **Language** | TypeScript | Type-safe complex schemas; good MCP ecosystem |
| **Runtime** | Node.js | Broad compatibility with MCP SDK |
| **Database** | SQLite (`better-sqlite3`) | No server needed; supports JOINs/aggregates; single file for easy backup |
| **MCP SDK** | `@modelcontextprotocol/sdk` | Official SDK |
| **Schema validation** | `zod` | Input/output validation + TypeScript type generation |
| **Transport** | `stdio` | Local Agent execution |

---

## Project Structure

```
GoalTracker/
├── src/
│   ├── index.ts              # Entry point — initializes MCP server "GoalTracker"
│   ├── db/
│   │   ├── migrations/
│   │   │   ├── 001_init.ts               # Initial schema (see 01-data-model.md)
│   │   │   └── 002_add_milestone_approval.ts  # Adds milestones.approved_at
│   │   └── client.ts         # DB connection — walks the migrations array against a _migrations table on every startup
│   ├── tools/
│   │   ├── goal.ts           # goal_create, goal_list, goal_get_context, goal_update_status
│   │   ├── spec.ts           # spec_set
│   │   ├── milestone.ts      # milestone_create, milestone_approve
│   │   ├── task.ts           # task_create, task_get, task_list, task_update_status, task_add_note
│   │   ├── status.ts         # status_report
│   │   └── checkpoint.ts     # checkpoint_save
│   ├── schemas/
│   │   └── index.ts          # Zod schemas for all models + input validation + DB row mappers
│   └── utils/
│       └── computed.ts       # Milestone status auto-compute, completion_pct, milestones_out_of_range, milestones_pending_approval, milestone_active_task_count
├── docs/
│   └── design/
│       ├── DESIGN.md                  # Index — philosophy + navigation table
│       ├── 01-data-model.md           # Entity schemas + SQLite DDL
│       ├── 02-tools.md                # Tool reference (14 tools)
│       ├── 03-workflows.md            # Agent workflows + call frequency
│       ├── 04-stack-and-structure.md  # This document
│       ├── 05-decisions.md            # Design decisions & rejected proposals
│       └── 06-changelog.md            # Version changelog
├── .claude/
│   └── skills/
│       └── goaltracker/
│           └── SKILL.md      # Installable Claude Code skill teaching an Agent to use these tools
├── package.json
├── tsconfig.json
└── README.md
```

Migrations are plain `.ts` modules (not raw `.sql` files) so `tsc` compiles them into `dist/` like any other source file — a `schema.sql` asset would silently go missing from a production build. Adding a schema change later is: write `00N_description.ts`, add it to the array in `client.ts`. That's the entire upgrade path; it applies automatically to every existing user's DB the next time the server starts.
