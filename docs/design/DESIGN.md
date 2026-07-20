# GoalTracker — Design Document

> **Version**: 3.6 — Final
> **Date**: 2026-07-20
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
  description?: string,
  status:      "active" | "completed" | "archived",
  status_note?: string,      // Set by goal_update_status; overwritten each call, not a history log
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
  description?: string,
  order:       number,
  status:      "pending" | "in_progress" | "completed",  // Computed at read time from tasks — NOT a stored column (see Section 8)
  approved_at?: ISO8601,  // Set by milestone_approve. Only meaningful for Milestones under the 2-active-task minimum (see below)
  created_at:  ISO8601
}
```

**Milestone task-count policy:** a Milestone should hold **2–5 active tasks** (`active` = not `cancelled`) — small enough to stay focused, large enough to be a meaningful phase. This is a guideline, not a hard constraint on the **upper** bound — no tool call is ever rejected for having more than 5 active tasks (see Section 9, "Rejected: hard cap on Milestone task count"). Two advisory signals help the Agent apply it regardless: `task_create` returns `milestone_active_task_count` in its output (immediate feedback right after adding a task), and `goal_get_context` / `status_report` surface a `milestones_out_of_range` flag (session-level check, excluding Milestones already `completed`) for Milestones sitting outside 2–5 active tasks.

**The lower bound is enforced, unlike the upper bound.** A Milestone with fewer than 2 active tasks needs explicit human sign-off before its tasks can actually be worked on: `task_update_status` rejects any transition to `"in_progress"` for a task whose Milestone has < 2 active tasks and no `approved_at` set. Calling `milestone_approve(milestone_id)` — after the Agent has actually confirmed with the user that a small Milestone is intentional, not just to unblock itself — lifts the restriction permanently for that Milestone, even if its active task count drops back below 2 later. `goal_get_context` / `status_report` surface this as `milestones_pending_approval: string[]` (same exclude-if-`completed` rule as `milestones_out_of_range`). See Section 9, "Accepted: approval gate for undersized Milestones."

**Auto-compute rules for Milestone status** (evaluated in order — first match wins):
- `pending` → no tasks yet
- `completed` → all tasks are `completed` or `cancelled` — checked before the two rules below, so a Milestone whose only task(s) are done always reads `completed`, even if that leaves it under the 2-active-task minimum
- `pending` → fewer than 2 active tasks and not yet approved (this is "pending **approval**" — see `approved_at` above)
- `pending` → all remaining tasks are `pending` (this is "pending **start**" — a different situation from the row above)
- `in_progress` → otherwise

> Note: `pending` covers two different situations that this field alone doesn't distinguish — a Milestone below the 2-active-task minimum and not yet approved ("pending approval") versus a Milestone at/above that minimum, or already approved, where no task has started yet ("pending start"). Check `approved_at` and the active task count (or `milestones_pending_approval`) to tell which one applies.

#### `Task`
```typescript
{
  id:              string,
  milestone_id:    string,
  goal_id:         string,       // Denormalized for fast queries
  title:           string,
  description?:    string,
  status:          "pending" | "in_progress" | "completed" | "blocked" | "cancelled",
  priority:        "low" | "medium" | "high",
  status_reason?:  string,       // Required when status = "blocked" or "cancelled"
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

## 3. Tool Reference (14 tools)

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
| **Output** | `{ goal, spec, milestones (with task_counts), milestones_out_of_range: string[], milestones_pending_approval: string[], progress, last_checkpoint }` |
| **When** | **Start of every session.** The single warm-up call. Replaces `spec_get + milestone_list + checkpoint_load`. |
| **Note** | `milestones_out_of_range` lists `milestone_id`s with < 2 or > 5 active tasks, excluding Milestones already `completed` — advisory only, the Agent decides whether to split/merge/add tasks. `milestones_pending_approval` lists `milestone_id`s with < 2 active tasks and no `approved_at` yet (same exclusion) — this one is not just advisory, see `milestone_approve` below. |

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

### Group C — Milestone (2 tools)

#### `milestone_create`
| | |
|---|---|
| **Input** | `{ goal_id, title, description?, order? }` |
| **Output** | `Milestone` |
| **When** | Breaking a Goal into phases during planning. |
| **Note** | `milestone_list` removed (in `goal_get_context`). `milestone_update` removed (rarely needed). Status is auto-computed. When `order` is omitted, it auto-assigns to `max(order within this goal) + 1` (starting at 0) instead of a constant default — avoids every Milestone colliding at `order = 0`. |

#### `milestone_approve`
| | |
|---|---|
| **Input** | `{ milestone_id }` |
| **Output** | `Milestone` |
| **When** | A Milestone has fewer than 2 active tasks and the Agent has confirmed with the user this is intentional — not as a shortcut to unblock `task_update_status`. |
| **Note** | Sets `approved_at`, permanently lifting the restriction for that Milestone regardless of later task-count changes. Idempotent — calling it again just refreshes the timestamp. |

---

### Group D — Task (5 tools)

#### `task_create`
| | |
|---|---|
| **Input** | `{ milestone_id, title, description?, priority?: "low"\|"medium"\|"high" }` |
| **Output** | `Task & { milestone_active_task_count: number }` |
| **When** | Creating tasks during planning, or when new work emerges during execution. |
| **Note** | No hard cap. `milestone_active_task_count` (active = not `cancelled`, counted after this insert) lets the Agent judge against the 2–5 guideline (Section 2) and decide whether to start a new Milestone instead of continuing to add here. |

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
| **Input** | `{ task_id, status: "pending"\|"in_progress"\|"completed"\|"blocked"\|"cancelled", reason? }` — `reason` required for `blocked` and `cancelled` |
| **Output** | `Task` |
| **When** | Every status transition. Also handles cancellation (status = `"cancelled"`). |
| **Note** | Rejects a transition to `"in_progress"` if the task's Milestone has fewer than 2 active tasks and hasn't been approved yet (see `milestone_approve`). Other transitions (`blocked`, `cancelled`, `completed`) are never gated by this. |

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
    completion_pct: number | null   // (completed / (total - cancelled)) * 100; null when (total - cancelled) === 0 (no tasks, or all cancelled)
  },
  milestones: Array<{
    milestone:   Milestone,
    task_counts: Record<TaskStatus, number>
  }>,
  milestones_out_of_range: string[],   // milestone_id[] with < 2 or > 5 active tasks, excluding milestones already `completed` — advisory only
  milestones_pending_approval: string[],   // milestone_id[] with < 2 active tasks and no approved_at, excluding milestones already `completed` — task_update_status rejects starting work on these until milestone_approve is called
  blocked_tasks: Array<{
    task:           Task,
    blocked_reason: string,
    latest_note?:   Note
  }>,
  acceptance_criteria: string[]   // same list as Spec.acceptance_criteria — Agent cross-checks manually against task evidence; verification progress is tracked via checkpoint_save's agent_summary/next_actions, not a persisted per-criterion flag
}
```

---

### Group F — Lifecycle (2 tools)

#### `goal_update_status`
| | |
|---|---|
| **Input** | `{ goal_id, status: "active"\|"completed"\|"archived", note? }` |
| **Output** | `Goal` |
| **When** | Closing a finished Goal, archiving an inactive one, or reactivating an archived Goal. Merges `goal_complete + goal_archive + goal_reactivate`. |
| **Note** | `note` persists to `goals.status_note` (overwritten each call — same fidelity as `tasks.status_reason`, not a history log). |

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
goal_create
  └─> [Agent drafts a structured spec, presents it to the user, revises based on feedback] → spec_set
       └─> milestone_create × N
            ├─> [If a Milestone ends up < 2 active tasks: Agent confirms with user] → milestone_approve
            └─> task_create × M
                 └─> [Agent presents the final milestone/task plan; user picks a check-in cadence:
                      per-task / per-milestone / run-through] → checkpoint_save
```
The bracketed steps are conversational, not tool calls — the MCP has no opinion on spec/plan formatting or check-in cadence (see Section 9, "Rejected: MCP-provided presentation templates"). The companion skill teaches the Agent a consistent presentation format for both.

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
            ├─> [if blocked] task_add_note(type="blocker") → task_update_status(id, "blocked", reason=...)
            └─> task_update_status(id, "completed")
                 └─> [Agent reports outcome to the user, pausing here if the chosen
                      check-in cadence (Workflow 1) says so] → checkpoint_save
```

### Workflow 4: Periodic review
```
status_report(goal_id)
  ├─> [blocked_tasks non-empty] → task_get → task_add_note(type="decision")
  └─> [on track] → continue next task
```

### Workflow 5: Project closure
```
status_report(goal_id)   // verify completion_pct = 100% (or null if every task was cancelled)
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
│   │   ├── migrations/
│   │   │   ├── 001_init.ts               # Initial schema (Section 8)
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
│       └── DESIGN.md         # This document
├── .claude/
│   └── skills/
│       └── goaltracker/
│           └── SKILL.md      # Installable Claude Code skill teaching an Agent to use these tools
├── package.json
├── tsconfig.json
└── README.md
```

Migrations are plain `.ts` modules (not raw `.sql` files) so `tsc` compiles them into `dist/` like any other source file — a `schema.sql` asset would silently go missing from a production build. Adding a schema change later is: write `00N_description.ts`, add it to the array in `client.ts`. That's the entire upgrade path; it applies automatically to every existing user's DB the next time the server starts.

---

## 8. SQLite Schema

```sql
CREATE TABLE goals (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  status_note TEXT,                              -- Set by goal_update_status; overwritten each call, not a history log
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE specs (
  goal_id              TEXT PRIMARY KEY REFERENCES goals(id),
  overview             TEXT NOT NULL,
  acceptance_criteria  TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  constraints          TEXT NOT NULL DEFAULT '[]',
  out_of_scope         TEXT NOT NULL DEFAULT '[]',
  updated_at           TEXT NOT NULL
);

CREATE TABLE milestones (
  id           TEXT PRIMARY KEY,
  goal_id      TEXT NOT NULL REFERENCES goals(id),
  title        TEXT NOT NULL,
  description  TEXT,
  "order"      INTEGER NOT NULL DEFAULT 0,
  approved_at  TEXT,                              -- Set by milestone_approve; NULL until an undersized Milestone is explicitly approved
  created_at   TEXT NOT NULL
  -- status is NOT stored here; computed at query time from tasks (see Section 2)
);

CREATE TABLE tasks (
  id             TEXT PRIMARY KEY,
  milestone_id   TEXT NOT NULL REFERENCES milestones(id),
  goal_id        TEXT NOT NULL REFERENCES goals(id),
  title          TEXT NOT NULL,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','blocked','cancelled')),
  priority       TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  status_reason  TEXT,                              -- Required when status = 'blocked' or 'cancelled'
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
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

### Rejected: `*_update` tools for editing title/description
Once a Goal, Milestone, or Task is created, its title/description cannot be edited via a dedicated tool. Content corrections are rare in practice (matches the "no dead tools" rule in Section 1) and can be captured via `task_add_note` (type=`decision`) when a correction matters enough to record. Adding `goal_update` / `milestone_update` / `task_update` (content) would add 3 more low-frequency tools without a clear query or workflow benefit.

### Deferred: checkpoint retention / pruning
`checkpoints` is append-only and grows unbounded over a long-running Goal. Each row is small (a few text fields), so this is not a concern at current scale. Revisit only if DB file size becomes an actual problem in practice — no pruning tool or migration is added now.

### Rejected: persisted `manually_checked` flag on acceptance criteria
`status_report` briefly exposed `manually_checked: boolean | null` per criterion, but no column in the schema backed it, and adding one would have resurrected the per-criterion tracking `spec_items` table already rejected above (or required a new tool just to flip one flag). Removed — the Agent cross-checks `acceptance_criteria: string[]` against task evidence and records verification progress via `checkpoint_save`'s `agent_summary` / `next_actions`, exactly the mechanism this section already prescribed.

### Rejected: hard cap on Milestone task count
`task_create` originally rejected a 6th active task on a Milestone. Made advisory instead (`milestone_active_task_count` in its output + `milestones_out_of_range` in session-level calls) — a hard cap would also block legitimate follow-up work discovered after a Milestone's original tasks are already `completed`, and the Agent is in a better position than the MCP to judge when to split.

### Accepted: approval gate for undersized Milestones (v3.4)
Unlike the upper-bound guideline above (still advisory — see "Rejected: hard cap on Milestone task count"), a Milestone below the 2-active-task minimum is now a real gate: `task_update_status` rejects starting work (`"in_progress"`) on any of its tasks until `milestone_approve` is called. This is a deliberate, user-directed exception to this document's general "data only, no reasoning, never reject a call" philosophy (Section 1) — a Milestone too small to be a meaningful phase is more often an accidental under-breakdown than a deliberate choice, and forcing one explicit confirmation (from the human user, via the Agent) catches that before work starts, at the cost of one extra tool call in the genuinely-intentional case. This does not reverse the upper-bound decision above — the two thresholds are independent and were evaluated separately.

### Rejected: MCP-provided presentation templates for spec/plan review (v3.6)
When drafting a Spec or a Milestone/Task plan for the user to review, the Agent needs a consistent, readable format — but that format is deliberately not returned by any tool. A dedicated "get template" tool, or a formatted-markdown field added to `spec_set` / `milestone_create` / `task_create`'s output, would add a repeated token cost to every one of those calls (each called multiple times per project — see Section 5) just to carry formatting instructions the Agent could instead load once. The templates live in the companion skill instead, loaded once per session and reused for free across every presentation moment — consistent with Section 1's "data only, no reasoning" split: presentation is the Agent's job, not this MCP's.

---

## 10. Changelog

| Version | Changes |
|---|---|
| **v1.0** | Initial design: ~12 tools, Plan entity, vague checkpoint |
| **v2.0** | Removed Plan, added Milestone, structured Spec, 22 tools |
| **v3.0** | Pragmatic optimization: trimmed 9 low-use tools → **13 tools**, renamed to **GoalTracker**, embedded checkpoint in `goal_get_context` |
| **v3.1** | Added `uncertainty` to Note.type enum — risk tracking without a new entity |
| **v3.2** | Milestone task-count policy (2–5 active tasks) + `pending` status rule for undersized milestones; `completion_pct` is null-safe; SQL `CHECK` constraints on enum columns; `description` typing fixed to optional; `goal_update_status` supports reactivation (`"active"`); documented rejected `*_update` tools and deferred checkpoint retention |
| **v3.3** | Lifted the 5-task hard cap on `task_create` — now advisory via `milestone_active_task_count` in its output, and `milestones_out_of_range` now excludes completed Milestones; removed unbacked `manually_checked` from `status_report` (tracking moves to `checkpoint_save`); renamed `tasks.blocked_reason` → `status_reason` (now covers `cancelled` too) and added `goals.status_note` (persists `goal_update_status`'s `note`); `specs.overview` is now `NOT NULL`; `milestone_create` auto-assigns `order` when omitted; misc doc-consistency fixes |
| **v3.4** | Added `milestone_approve` (14 tools total) and `milestones.approved_at`. Milestones under the 2-active-task minimum now require explicit approval before `task_update_status` allows starting work on their tasks — a deliberate exception to the "never reject a call" philosophy, distinct from and not reversing the still-advisory 5-task upper bound. `goal_get_context` / `status_report` gained `milestones_pending_approval` |
| **v3.5** | Fixed the Milestone auto-compute rule order: "all tasks completed/cancelled" is now checked before the 2-active-task approval rule, so a Milestone whose only task(s) are done reads `completed` instead of getting stuck on `pending` forever (and correctly drops out of both `milestones_out_of_range` and `milestones_pending_approval`) |
| **v3.6** | Documented the full plan-confirmation flow: Workflow 1 now shows the Agent presenting a structured spec draft, confirming milestone approval where needed, then presenting the final milestone/task plan and letting the user pick a check-in cadence (per-task / per-milestone / run-through) before any work starts; Workflow 3 shows the Agent reporting and pausing per that cadence. No schema or tool changes — added Section 9 rationale for keeping presentation templates in the companion skill rather than the MCP |
