# GoalTracker — Design Document

> **Version**: 3.1 — Final
> **Date**: 2026-07-17
> **Purpose**: MCP server that helps AI Agents track progress, manage Goals and Tasks in a hierarchical model, and maintain context across sessions.

---

## 1. Design Philosophy

| Principle | Description |
|---|---|
| **Data only, no reasoning** | The MCP only stores and returns structured data. All reasoning and suggestions are the Agent's responsibility. |
| **Single source of truth** | The entire project state lives in one DB. The Agent only needs to remember the `goal_id`. |
| **Fast warm-up** | A context-reset Agent only needs 1 tool call to fully recover its working context. |
| **No dead tools** | Every tool must have at least 1 real call per session or be essential setup. Rarely-used tools are merged or removed. |
| **Audit trail** | Every status change has a timestamp and reason — no information is lost. |

---

## 2. Data Model

### Hierarchy

```
Goal
 ├─ Spec              (1-1)  — "What does done look like"
 └─ Milestone[]       (1-N)  — Major phases
      └─ Task[]        (1-N)  — Smallest unit of work
           └─ Note[]   (1-N)  — Notes, evidence, blockers, uncertainties
```

> **No `Plan` entity**: "Plan" is conceptually redundant with a set of Milestones. Eliminated to avoid unnecessary abstraction layers.
> **No standalone `Checkpoint` entity**: Checkpoint is embedded in `goal_get_context` — no extra tool call needed.

---

### Entity Schemas

#### `Goal`
```typescript
{
  id:          string,       // uuid
  title:       string,
  description: string,
  status:      "active" | "completed" | "archived",
  created_at:  ISO8601,
  updated_at:  ISO8601
}
```

#### `Spec`
```typescript
{
  goal_id:              string,
  overview:             string,
  acceptance_criteria:  string[],   // Checkable list — "what done means"
  constraints:          string[],   // Boundaries and limitations
  out_of_scope:         string[],   // Explicitly excluded items
  updated_at:           ISO8601
}
```

#### `Milestone`
```typescript
{
  id:          string,
  goal_id:     string,
  title:       string,
  description: string,
  order:       number,
  status:      "pending" | "in_progress" | "completed",  // Auto-computed from tasks
  created_at:  ISO8601
}
```

**Auto-compute rules for Milestone status:**
- `pending` → all tasks are `pending`
- `in_progress` → at least 1 task is `in_progress` or `completed`
- `completed` → all tasks are `completed` or `cancelled`

#### `Task`
```typescript
{
  id:              string,
  milestone_id:    string,
  goal_id:         string,       // Denormalized for fast queries
  title:           string,
  description:     string,
  status:          "pending" | "in_progress" | "completed" | "blocked" | "cancelled",
  priority:        "low" | "medium" | "high",
  blocked_reason?: string,       // Required when status = "blocked"
  created_at:      ISO8601,
  updated_at:      ISO8601
}
```

#### `Note`
```typescript
{
  id:         string,
  task_id:    string,
  content:    string,
  type:       "progress"    // Regular progress update
            | "blocker"     // Something actively blocking this task right now
            | "decision"    // Technical or design decision made
            | "evidence"    // Proof of completion or test result
            | "uncertainty" // Potential risk/unknown discovered, not yet a blocker
  created_at: ISO8601
}
```

#### `Checkpoint` *(embedded — not a standalone entity)*
```typescript
{
  // Stored in checkpoints table; always returned with goal_get_context
  goal_id:          string,
  current_task_id?: string,    // Task the Agent was focused on
  agent_summary:    string,    // Agent's own summary of current state
  next_actions:     string[],  // What to do next
  saved_at:         ISO8601
}
```

---

## 3. Tool Reference (13 tools)

> **Tool elimination rule**: A tool is removed if its output is already covered by another tool, or if its real-world call frequency is ~0 in a typical project.

---

### Group A — Goal (3 tools)

#### `goal_create`
| | |
|---|---|
| **Input** | `{ title: string, description?: string }` |
| **Output** | `Goal` |
| **When** | Starting a new project. Called once. |

#### `goal_list`
| | |
|---|---|
| **Input** | `{ status?: "active" \| "completed" \| "archived" }` |
| **Output** | `Goal[]` |
| **When** | Agent needs to find a goal_id, or wants an overview of all projects. |

#### `goal_get_context` ⭐
| | |
|---|---|
| **Input** | `{ goal_id: string }` |
| **Output** | `{ goal, spec, milestones (with task_counts), progress, last_checkpoint }` |
| **When** | **Start of every session.** The single warm-up call. Replaces `spec_get + milestone_list + checkpoint_load`. |

---

### Group B — Spec (1 tool)

#### `spec_set`
| | |
|---|---|
| **Input** | `{ goal_id, overview, acceptance_criteria[], constraints?, out_of_scope? }` |
| **Output** | `Spec` |
| **When** | Creating or overwriting the Spec. Create-or-replace semantics. |
| **Note** | `spec_get` is unnecessary (returned by `goal_get_context`). `spec_update` is unnecessary (full overwrite is sufficient). |

---

### Group C — Milestone (1 tool)

#### `milestone_create`
| | |
|---|---|
| **Input** | `{ goal_id, title, description?, order? }` |
| **Output** | `Milestone` |
| **When** | Breaking a Goal into phases during planning. |
| **Note** | `milestone_list` removed (in `goal_get_context`). `milestone_update` removed (rarely needed). Status is auto-computed. |

---

### Group D — Task (5 tools)

#### `task_create`
| | |
|---|---|
| **Input** | `{ milestone_id, title, description?, priority?: "low"\|"medium"\|"high" }` |
| **Output** | `Task` |
| **When** | Creating tasks during planning, or when new work emerges during execution. |

#### `task_get`
| | |
|---|---|
| **Input** | `{ task_id: string }` |
| **Output** | `Task & { notes: Note[] }` |
| **When** | Inspecting a blocked task's full detail, or before starting a task. |

#### `task_list`
| | |
|---|---|
| **Input** | `{ goal_id?, milestone_id?, status?, priority? }` |
| **Output** | `Task[]` (no notes, to keep response compact) |
| **When** | Finding next tasks to work on, viewing blocked tasks, reviewing backlog. |

#### `task_update_status`
| | |
|---|---|
| **Input** | `{ task_id, status, reason? }` — `reason` required for `blocked` and `cancelled` |
| **Output** | `Task` |
| **When** | Every status transition. Also handles cancellation (status = `"cancelled"`). |

#### `task_add_note`
| | |
|---|---|
| **Input** | `{ task_id, content, type: "progress"\|"blocker"\|"decision"\|"evidence"\|"uncertainty" }` |
| **Output** | `Note` |
| **When** | Recording evidence, blocker reasons, technical decisions, or potential risks found during work. |

---

### Group E — Status (1 tool)

#### `status_report` ⭐
| | |
|---|---|
| **Input** | `{ goal_id: string }` |
| **Output** | See schema below |
| **When** | Periodic reviews, before marking a Goal complete. |
| **Note** | Returns data only — no suggestions. The Agent reasons on its own. |

```typescript
// status_report output
{
  goal:     Goal,
  progress: {
    total_tasks:    number,
    completed:      number,
    in_progress:    number,
    blocked:        number,
    pending:        number,
    cancelled:      number,
    completion_pct: number   // (completed / (total - cancelled)) * 100
  },
  milestones: Array<{
    milestone:   Milestone,
    task_counts: Record<TaskStatus, number>
  }>,
  blocked_tasks: Array<{
    task:           Task,
    blocked_reason: string,
    latest_note?:   Note
  }>,
  acceptance_criteria: Array<{
    criterion:        string,
    manually_checked: boolean | null   // Agent evaluates, MCP does not auto-assess
  }>
}
```

---

### Group F — Lifecycle (2 tools)

#### `goal_update_status`
| | |
|---|---|
| **Input** | `{ goal_id, status: "completed"\|"archived", note? }` |
| **Output** | `Goal` |
| **When** | Closing a finished Goal or archiving an inactive one. Merges `goal_complete + goal_archive`. |

#### `checkpoint_save`
| | |
|---|---|
| **Input** | `{ goal_id, current_task_id?, agent_summary, next_actions[] }` |
| **Output** | `Checkpoint` |
| **When** | End of every session, before the Agent's context is reset. Loaded via `goal_get_context`. |

---

## 4. Agent Workflows

### Workflow 1: New project setup
```
goal_create → spec_set → milestone_create × N → task_create × M → checkpoint_save
```

### Workflow 2: Session resume (context-reset Agent)
```
goal_get_context(goal_id)   ← 1 call: recovers goal + spec + milestones + last checkpoint
  └─> task_get(current_task_id)   ← optional: inspect current task detail
```

### Workflow 3: Task execution
```
task_list(status="pending")
  └─> task_update_status(id, "in_progress")
       └─> [do actual work]
            ├─> task_add_note(type="progress" | "uncertainty")
            ├─> [if blocked] task_update_status(id, "blocked", reason=...)
            └─> task_update_status(id, "completed")
                 └─> checkpoint_save
```

### Workflow 4: Periodic review
```
status_report(goal_id)
  ├─> [blocked_tasks non-empty] → task_get → task_add_note(type="decision")
  └─> [on track] → continue next task
```

### Workflow 5: Project closure
```
status_report(goal_id)   // verify completion_pct = 100%
  └─> [Agent manually verifies acceptance_criteria]
       └─> goal_update_status(id, "completed")
```

---

## 5. Real-world Call Frequency

| Tool | Frequency | Phase |
|---|---|---|
| `goal_get_context` | **Every session** | Full project |
| `task_update_status` | **Every task** | Execute |
| `task_list` | **Multiple times** | Execute + Review |
| `task_create` | N times | Planning |
| `checkpoint_save` | **End of every session** | Full project |
| `status_report` | ~Weekly | Review |
| `task_add_note` | ~3–5× | Execute |
| `task_get` | ~3–5× | Execute |
| `milestone_create` | N times | Planning |
| `spec_set` | 1–2× | Setup |
| `goal_create` | 1× | Setup |
| `goal_list` | 2–3× | Multi-project |
| `goal_update_status` | 1× | Closure |

*No tool has a ~0 call frequency.*

---

## 6. Tech Stack

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

## 7. Project Structure

```
GoalTracker/
├── src/
│   ├── index.ts              # Entry point — initializes MCP server "GoalTracker"
│   ├── db/
│   │   ├── schema.sql        # SQLite schema + indexes
│   │   └── client.ts         # DB connection & auto-migration
│   ├── tools/
│   │   ├── goal.ts           # goal_create, goal_list, goal_get_context, goal_update_status
│   │   ├── spec.ts           # spec_set
│   │   ├── milestone.ts      # milestone_create
│   │   ├── task.ts           # task_create, task_get, task_list, task_update_status, task_add_note
│   │   ├── status.ts         # status_report
│   │   └── checkpoint.ts     # checkpoint_save
│   ├── schemas/
│   │   └── index.ts          # Zod schemas for all models + input validation
│   └── utils/
│       └── computed.ts       # Milestone status auto-compute, completion_pct
├── docs/
│   └── design/
│       └── DESIGN.md         # This document
├── package.json
├── tsconfig.json
└── README.md
```

---

## 8. SQLite Schema

```sql
CREATE TABLE goals (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active',  -- active | completed | archived
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE specs (
  goal_id              TEXT PRIMARY KEY REFERENCES goals(id),
  overview             TEXT,
  acceptance_criteria  TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  constraints          TEXT NOT NULL DEFAULT '[]',
  out_of_scope         TEXT NOT NULL DEFAULT '[]',
  updated_at           TEXT NOT NULL
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
  id             TEXT PRIMARY KEY,
  milestone_id   TEXT NOT NULL REFERENCES milestones(id),
  goal_id        TEXT NOT NULL REFERENCES goals(id),
  title          TEXT NOT NULL,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',   -- pending | in_progress | completed | blocked | cancelled
  priority       TEXT NOT NULL DEFAULT 'medium',    -- low | medium | high
  blocked_reason TEXT,                              -- Required when status = 'blocked'
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE notes (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id),
  content    TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'progress',  -- progress | blocker | decision | evidence | uncertainty
  created_at TEXT NOT NULL
);

CREATE TABLE checkpoints (
  id              TEXT PRIMARY KEY,
  goal_id         TEXT NOT NULL REFERENCES goals(id),
  current_task_id TEXT REFERENCES tasks(id),
  agent_summary   TEXT NOT NULL,
  next_actions    TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  saved_at        TEXT NOT NULL
);

-- Indexes for common queries
CREATE INDEX idx_tasks_goal       ON tasks(goal_id);
CREATE INDEX idx_tasks_milestone  ON tasks(milestone_id);
CREATE INDEX idx_tasks_status     ON tasks(status);
CREATE INDEX idx_milestones_goal  ON milestones(goal_id);
CREATE INDEX idx_notes_task       ON notes(task_id);
CREATE INDEX idx_checkpoints_goal ON checkpoints(goal_id, saved_at DESC);
```

---

## 9. Design Decisions & Rejected Proposals

### Rejected: `Plan` entity
A "Plan" is conceptually identical to an ordered set of Milestones. Adding a Plan layer creates unnecessary abstraction with no query or workflow benefit.

### Rejected: `spec_items` table (separate acceptance criteria rows)
Converting `acceptance_criteria: string[]` into a full `spec_items` table would introduce a new entity, require changes to 2+ tools, and add complexity without meaningful benefit. Agents can already link evidence to criteria through task notes and the `agent_summary` checkpoint field.

### Rejected: `spec_item_index` on Task (traceability link)
Tasks serve Milestones, not individual Spec criteria. The real query pattern is "what tasks are pending/blocked?", not "which tasks serve criterion #3?". Additionally, the relationship is M:N in reality, making a single integer index incorrect.

### Accepted: `uncertainty` Note type
Adding one enum value costs zero schema complexity while enabling the meaningful distinction between `blocker` (currently blocking) and `uncertainty` (potential future risk). No new entity, no new tool, no new query path needed.

---

## 10. Changelog

| Version | Changes |
|---|---|
| **v1.0** | Initial design: ~12 tools, Plan entity, vague checkpoint |
| **v2.0** | Removed Plan, added Milestone, structured Spec, 22 tools |
| **v3.0** | Pragmatic optimization: trimmed 9 low-use tools → **13 tools**, renamed to **GoalTracker**, embedded checkpoint in `goal_get_context` |
| **v3.1** | Added `uncertainty` to Note.type enum — risk tracking without a new entity |
