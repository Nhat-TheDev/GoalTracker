# Design Decisions & Rejected Proposals

### Rejected: `Plan` entity
A "Plan" is conceptually identical to an ordered set of Milestones. Adding a Plan layer creates unnecessary abstraction with no query or workflow benefit.

### Rejected: `spec_items` table (separate acceptance criteria rows)
Converting `acceptance_criteria: string[]` into a full `spec_items` table would introduce a new entity, require changes to 2+ tools, and add complexity without meaningful benefit. Agents can already link evidence to criteria through task notes and the `agent_summary` checkpoint field.

### Rejected: `spec_item_index` on Task (traceability link)
Tasks serve Milestones, not individual Spec criteria. The real query pattern is "what tasks are pending/blocked?", not "which tasks serve criterion #3?". Additionally, the relationship is M:N in reality, making a single integer index incorrect.

### Accepted: `uncertainty` Note type
Adding one enum value costs zero schema complexity while enabling the meaningful distinction between `blocker` (currently blocking) and `uncertainty` (potential future risk). No new entity, no new tool, no new query path needed.

### Rejected: `*_update` tools for editing title/description
Once a Goal, Milestone, or Task is created, its title/description cannot be edited via a dedicated tool. Content corrections are rare in practice (matches the "no dead tools" principle in DESIGN.md) and can be captured via `task_add_note` (type=`decision`) when a correction matters enough to record. Adding `goal_update` / `milestone_update` / `task_update` (content) would add 3 more low-frequency tools without a clear query or workflow benefit.

### Deferred: checkpoint retention / pruning
`checkpoints` is append-only and grows unbounded over a long-running Goal. Each row is small (a few text fields), so this is not a concern at current scale. Revisit only if DB file size becomes an actual problem in practice — no pruning tool or migration is added now.

### Rejected: persisted `manually_checked` flag on acceptance criteria
`status_report` briefly exposed `manually_checked: boolean | null` per criterion, but no column in the schema backed it, and adding one would have resurrected the per-criterion tracking `spec_items` table already rejected above (or required a new tool just to flip one flag). Removed — the Agent cross-checks `acceptance_criteria: string[]` against task evidence and records verification progress via `checkpoint_save`'s `agent_summary` / `next_actions`, exactly the mechanism this section already prescribed.

### Rejected: hard cap on Milestone task count
`task_create` originally rejected a 6th active task on a Milestone. Made advisory instead (`milestone_active_task_count` in its output + `milestones_out_of_range` in session-level calls) — a hard cap would also block legitimate follow-up work discovered after a Milestone's original tasks are already `completed`, and the Agent is in a better position than the MCP to judge when to split.

### Accepted: approval gate for undersized Milestones (v3.4)
Unlike the upper-bound guideline above (still advisory — see "Rejected: hard cap on Milestone task count"), a Milestone below the 2-active-task minimum is now a real gate: `task_update_status` rejects starting work (`"in_progress"`) on any of its tasks until `milestone_approve` is called. This is a deliberate, user-directed exception to DESIGN.md's "data only, no reasoning, never reject a call" philosophy — a Milestone too small to be a meaningful phase is more often an accidental under-breakdown than a deliberate choice, and forcing one explicit confirmation (from the human user, via the Agent) catches that before work starts, at the cost of one extra tool call in the genuinely-intentional case. This does not reverse the upper-bound decision above — the two thresholds are independent and were evaluated separately.

### Accepted: required `description` on `goal_create` (v3.7)
`goalCreateInput.description` changed from optional to `z.string().min(1)` — a second deliberate exception to "never reject a call," alongside the Milestone approval gate above. A Goal with no description is more often an accidental omission than a deliberate choice, and `goal_list` becomes far less useful across multiple projects if half the rows are just a bare title. Unlike the Milestone gate, this one has no override — there was no equivalent to "confirm this is intentional and proceed anyway" that made sense here, since a description costs nothing to write and blocks nothing downstream. `task_create` and `milestone_create` were deliberately **not** given the same treatment — their tool descriptions gained a soft quality hint instead of validation, at the user's explicit choice, keeping that part of the "quality is model-dependent" trade-off intact for those two tools.

### Rejected: MCP-provided presentation templates for spec/plan review (v3.6)
When drafting a Spec or a Milestone/Task plan for the user to review, the Agent needs a consistent, readable format — but that format is deliberately not returned by any tool. A dedicated "get template" tool, or a formatted-markdown field added to `spec_set` / `milestone_create` / `task_create`'s output, would add a repeated token cost to every one of those calls (each called multiple times per project — see [03-workflows.md](03-workflows.md), "Real-world Call Frequency") just to carry formatting instructions the Agent could instead load once. The templates live in the companion skill instead, loaded once per session and reused for free across every presentation moment — consistent with DESIGN.md's "data only, no reasoning" principle: presentation is the Agent's job, not this MCP's.
