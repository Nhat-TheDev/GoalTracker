# Data Model

## Hierarchy

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

## Entity Schemas

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
> `description` is optional on the stored/output model — Goals created before v3.7 still read back fine with no description. But `goal_create`'s **input** now requires it (non-empty), see [02-tools.md](02-tools.md). The output type stays optional so existing rows aren't misrepresented as violating a rule that didn't apply when they were created.

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
  status:      "pending" | "in_progress" | "completed",  // Computed at read time from tasks — NOT a stored column, see SQLite Schema below
  approved_at?: ISO8601,  // Set by milestone_approve. Only meaningful for Milestones under the 2-active-task minimum (see below)
  created_at:  ISO8601
}
```

**Milestone task-count policy:** a Milestone should hold **2–5 active tasks** (`active` = not `cancelled`) — small enough to stay focused, large enough to be a meaningful phase. This is a guideline, not a hard constraint on the **upper** bound — no tool call is ever rejected for having more than 5 active tasks (see [05-decisions.md](05-decisions.md), "Rejected: hard cap on Milestone task count"). Two advisory signals help the Agent apply it regardless: `task_create` returns `milestone_active_task_count` in its output (immediate feedback right after adding a task), and `goal_get_context` / `status_report` surface a `milestones_out_of_range` flag (session-level check, excluding Milestones already `completed`) for Milestones sitting outside 2–5 active tasks.

**The lower bound is enforced, unlike the upper bound.** A Milestone with fewer than 2 active tasks needs explicit human sign-off before its tasks can actually be worked on: `task_update_status` rejects any transition to `"in_progress"` for a task whose Milestone has < 2 active tasks and no `approved_at` set. Calling `milestone_approve(milestone_id)` — after the Agent has actually confirmed with the user that a small Milestone is intentional, not just to unblock itself — lifts the restriction permanently for that Milestone, even if its active task count drops back below 2 later. `goal_get_context` / `status_report` surface this as `milestones_pending_approval: string[]` (same exclude-if-`completed` rule as `milestones_out_of_range`). See [05-decisions.md](05-decisions.md), "Accepted: approval gate for undersized Milestones."

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

## SQLite Schema

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
  -- status is NOT stored here; computed at query time from tasks (see Entity Schemas above)
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
