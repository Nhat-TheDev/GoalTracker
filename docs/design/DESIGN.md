# GoalTracker — Design Document

> **Version**: 3.10
> **Date**: 2026-08-24
> **Purpose**: MCP server that helps AI Agents track progress, manage Goals and Tasks in a hierarchical model, and maintain context across sessions.

This document is split into layered files under `docs/design/` — each one covers a different reason you'd come back to edit it. Touch only the file that matches what you're actually changing; you don't need to read the others.

## Where to look

| You're about to... | Edit |
|---|---|
| Add/change an entity field, enum, or run a migration | [01-data-model.md](01-data-model.md) |
| Add/change a tool's input, output, or behavior | [02-tools.md](02-tools.md) |
| Change the sequence an Agent follows, or usage-frequency assumptions | [03-workflows.md](03-workflows.md) |
| Add a dependency, or move/add a source file | [04-stack-and-structure.md](04-stack-and-structure.md) |
| Record why a proposal was accepted or rejected | [05-decisions.md](05-decisions.md) |
| Cut a new version | [06-changelog.md](06-changelog.md) |

---

## Design Philosophy

Every rule below exists for one person: whoever is directing an Agent to use this tool across many sessions, weeks, or a team handoff. Here's what each one actually buys you.

**Data only, no reasoning.**
The MCP never decides anything for you — it stores exactly what the Agent wrote and hands it back unchanged. That means when you read a Goal's state, you're reading the Agent's actual committed judgment, not a tool's guess dressed up as fact. All the real thinking — how to break down the work, whether a spec is good enough, whether a small milestone is intentional — happens where you can see it: in the conversation with your Agent, not hidden inside a tool call you never get to review.

**Single source of truth.**
Everything about a project lives in one SQLite file, addressed by one `goal_id`. You never have to reconstruct what happened by scrolling through old chat history or piecing together scattered notes — any session, on any machine, with any Agent that has this MCP connected, can pull the exact same ground truth back with one call.

**Fast warm-up.**
Context resets are normal — a session ends, a new one starts, maybe with a different Agent entirely. You shouldn't pay a "re-explain everything" tax every time that happens. `goal_get_context` hands the next Agent your goal, spec, every milestone, and the last checkpoint in one call — it picks up where you left off instead of asking you to catch it up.

**No dead tools.**
Every tool here earns its place by being called for real, regularly. That's not a purity rule for its own sake — it's what keeps the tool surface small enough that an Agent (and you, reading a transcript) can predict what each call does without guessing. A bloated tool list is where unpredictable Agent behavior hides.

**Audit trail.**
Every status change is timestamped, and anything that stalls (`blocked`, `cancelled`) requires a stated reason. Six months from now, "why did this get cancelled?" has an answer sitting right there — not a mystery you have to reconstruct or take on faith.

**Convention over schema.**
This schema stays deliberately thin — no dependency graph, no per-criterion checklist, no dedicated "verify method" field. Every time one was proposed (see [05-decisions.md](05-decisions.md)), it got rejected in favor of writing that context into `description` or a `task_add_note` instead. For you, this means the tool never boxes you into someone else's idea of how a plan should be structured — but it also means the tool trusts the Agent to actually write something meaningful into those free-text fields. It won't catch a lazy one-line task for you.

**Quality is model-dependent, by design.**
Outside of the quality-related gates below, this MCP never rejects a call for being low-effort — it will happily store a vague acceptance criterion or a bare-title task exactly as readily as a good one. That's a deliberate trade-off for staying schema-thin and agent-flexible, not an oversight. In practice, this means *you* stay the real quality check: review the spec draft and the final plan before work starts, because nothing downstream will flag a weak one for you.

**A few deliberate exceptions, not a precedent.**
A handful of calls are gated because skipping them is usually an accident, not a choice: `task_update_status` refuses to start work on a Milestone with fewer than 2 active tasks until you confirm it's intentional; `goal_create` refuses to save without a real description; and `spec_set` refuses an empty `acceptance_criteria` list. Don't read this as "the MCP validates quality now" — everywhere else, it still never rejects a call. Full list and rationale: [05-decisions.md](05-decisions.md).

**Closed Goals are read-only.**
Once a Goal is `archived` or `completed`, `milestone_create`, `task_create`, every `task_update_status` transition, and `checkpoint_save` all refuse to touch it — reactivate it first with `goal_update_status(goal_id, "active")`. Unlike the quality gates above, this one catches a wrong `goal_id`: mutating a Goal you (or the Agent) already closed is almost always accidental, and cheap to recover from, since reactivation was already a first-class transition before this guard existed.
