---
name: goaltracker
description: Use when the GoalTracker MCP tools (goal_create, spec_set, milestone_create, task_create, status_report, etc.) are connected and the user wants to track progress on a project, write a spec or acceptance criteria, break work into milestones and tasks, decide what order to tackle work in, resume after a context reset, or check on progress. Also reach for this the moment a requested feature or task is large enough that you need several clarifying questions before you can even start (multiple components, missing architecture/tech context, unclear scope) — that need is itself the signal to set up tracking, even if the user never mentions GoalTracker, planning, or tracking by name. Teaches the correct call sequence, how to write a spec that's actually checkable, how to choose a milestone breakdown strategy, and the schema's conventions so the agent doesn't reinvent bookkeeping the MCP already handles.
---

# Using GoalTracker

GoalTracker is a data-only MCP: it stores and returns structured state (Goal → Spec → Milestone → Task → Note), but never reasons or suggests — all judgment stays with you, the agent. Follow these conventions so the state you build stays useful across sessions, and so the plans you create are actually good plans, not just a todo dump with extra steps.

## The clarifying-questions moment is the trigger, not just planning requests

A request like "handle this feature for me" reads as an instruction to execute, not to plan — so don't wait for the user to explicitly ask for a plan or say "track this." Watch for the moment instead: if a feature or task is big enough that you need to ask the user several things before you can even start — which repo/path, what stack, what already exists, which pieces are actually in scope — that need for clarification is itself the signal, not just a reason to fire off questions and wait for replies.

When you notice that moment, create the Goal and a first-pass Spec from whatever you already know before (or alongside) asking your questions: put the confirmed scope in `overview`, and put the open questions themselves in `constraints` or `out_of_scope` until they're answered. That way the answers you get back fill in a spec instead of vanishing into a one-off Q&A, and the next session — yours or someone else's — can see the shape of the ask even before every detail is settled.

## Every session starts with one call

Before doing anything else on an existing project, call `goal_get_context(goal_id)`. It returns the goal, spec, every milestone with its task counts, a `milestones_out_of_range` list, aggregate progress, and the last checkpoint — everything you need to resume, in one call. Don't call `task_list` or dig through individual tasks just to "get oriented"; that's what this call replaces.

If the returned `last_checkpoint` has a `current_task_id`, call `task_get(current_task_id)` next to see that task's full detail and notes before you resume it — the checkpoint tells you *what* you were doing, `task_get` tells you the specifics you'd otherwise have to reconstruct from memory that no longer exists.

If you don't know the `goal_id`, call `goal_list` first.

## Setting up a new project

```
goal_create → [draft spec ⇄ confirm with the user] → spec_set
  → milestone_create (× N) → task_create (× M)
  → [present final plan, pick a check-in cadence] → start work
```

The step between `goal_create` and the point where you actually start breaking milestones is a conversation, not a formality. Treat it like a kickoff discussion you'd have before committing to a plan, not an admin step to clear so you can get to the breakdown.

- **Draft before you commit.** Work out a first-pass `overview`, `acceptance_criteria`, `constraints`, and `out_of_scope` from what you already know, then present it to the user in the **spec draft** format below — *before* treating `spec_set` as final. Don't silently assume what "done" means and move straight to milestones — state it, in a consistent structure, and let them correct it.
- Write `acceptance_criteria` as a real Definition of Done, not a restatement of the goal: each item should be something you could point at task evidence and tick off as true or false. Cover exception paths and edge cases too, not just the happy path — a criteria list that's all happy-path is a plan waiting to be surprised. If you don't have enough information yet to write a reliable criterion, say so and ask, rather than guessing at one and hoping it holds up.
  Before presenting the draft, re-read each criterion and ask yourself: could I mark this true or false today with zero ambiguity? If not, it's not done yet — sharpen it or flag it as an open question instead of shipping it vague.
  - Not checkable (just restates the goal): "Icon system uses Lucide icons"
  - Checkable (real DoD): "All 40 icon keys in `util.js` map to a lucide-static SVG; zero call sites fall back to an empty string"
- **Ask about what would actually change the breakdown**, not everything: what's explicitly out of scope (the thing people under-specify the most), any constraint that isn't obvious from the request itself (a deadline, a system you can't touch, a stack decision already made elsewhere), and whether the acceptance criteria you drafted match what they'd really accept as "done."
- **`spec_set` is create-or-replace, so use it like a checkpoint while the spec is still taking shape**, not a one-shot commit — call it with your draft, revise based on what the user says, call it again. There's no separate "update" tool and no penalty for calling it more than once.
- **Don't call `milestone_create` until the user has actually confirmed the spec** — a real "yes, that's it" or a correction you've since folded back in, not just silence after you stated it once. This is a behavioral habit, not something the MCP enforces — `milestone_create` will not stop you from skipping this, which is exactly why it's worth being deliberate about instead of treating the spec step as a rubber stamp on the way to the real work.
- Once the spec is actually confirmed: choose a milestone breakdown strategy (below) before calling `milestone_create` repeatedly — don't just default to whatever order occurred to you first.
- Each milestone should end up holding roughly 2–5 active (non-cancelled) tasks — enough to be a meaningful phase, small enough to stay focused. The upper end is still just a nudge, not enforced. The **lower** end now has teeth: `task_update_status` will refuse to start (`"in_progress"`) any task in a milestone with fewer than 2 active tasks until you call `milestone_approve` — see "When a milestone is too small to start on" below.
- Leave `order` unset unless you need a specific sequence — it auto-assigns.
- **Before presenting the final plan, re-read every task description you just wrote as a self-audit pass.** Does each one say what actually changes and how you'd verify it's done, or is it a bare title restated as a sentence (e.g. "Fix the bug")? This is your one real chance to catch that — the final plan template below only surfaces a short verify clause per task, not the full description, so a thin description is otherwise invisible to the user at review time. Tighten anything that fails this check before moving on.
- **Once every milestone and task exists (and any undersized milestone has already been approved — see below), present the whole plan back to the user** in the **final plan** format below, as one last look at the full shape of the work before any of it starts. Don't call `task_update_status(..., "in_progress")` on anything until they've seen it.
- **With the plan confirmed, ask how they want you to check in while you work**: after every task, after every milestone, or straight through with a report only at the end (or when something blocks you). Whatever they pick applies for the rest of the session — see "Doing the work" below for what each option means in practice.

## Templates for presenting to the user

Use these formats consistently. This costs nothing extra from the MCP — no tool returns formatted text, formatting is entirely your job using data these tools already gave you — and a structured draft is something a user can actually skim and react to, instead of a paragraph they have to parse.

**Spec draft** — after drafting, before calling `spec_set` for real:

```
## Spec draft — <goal title>

**Overview:** <what "done" means, in 1-2 sentences>

**Acceptance criteria:**
- <criterion 1>
- <criterion 2>

**Constraints:**
- <constraint, or "none identified yet">

**Out of scope:**
- <item, or "none identified yet">

Anything to add, cut, or correct before I lock this in?
```

**Final plan** — after milestones and tasks exist and any small-milestone approval is settled, before execution starts:

```
## Plan — <goal title>

**M1 — <title>** (<breakdown strategy>: <one-line why this order>)
- <task 1 title> — verify: <short clause pulled from that task's description>
- <task 2 title> — verify: <short clause pulled from that task's description>

**M2 — <title>**
- <task 1 title> — verify: <short clause>
...

Ready to start? Want me to check in after every task, after every milestone, or run straight through and report at the end?
```

**Completion report** — whenever your check-in cadence says to stop, or when a Goal is closed:

```
## <Task, Milestone, or Goal> complete — <title>

**Done:**
- <task>: <one-line outcome or evidence>

**Status:** <e.g. "3 of 5 tasks done in this milestone, 1 blocked">
<mention any blocked task and why, if there is one>

Next: <what you'll do next, or the question you need answered before continuing>
```

## Before you create milestones: choose a breakdown strategy

Pick one primary strategy and let it drive the order you create milestones (and, within a milestone, tasks) in:

- **dependency-first** — order milestones so nothing blocks on work that comes later.
- **risk-first** — tackle the riskiest unknown first; if it invalidates the plan, better to find out now than after three milestones of unrelated work.
- **verify-first** — front-load whichever milestone produces real evidence/proof early, when getting confirmation that the approach works is the actual bottleneck.
- **unblock-first** — if one thing is already blocking multiple other directions, resolve that before anything else.
- **handoff-first** — if someone else (a teammate, or a future session with no memory of this conversation) needs to pick this up, structure milestones so the plan reads clearly without you there to explain it.

There's no schema field for "strategy" — say which one you picked and why in the milestone's `description` (one line is enough). This isn't busywork: it's the difference between a milestone list that's just a todo dump and one that actually reflects a plan, and it costs nothing since `description` already exists.

## When a milestone is too small to start on

If `task_update_status(..., "in_progress")` comes back with an error about the milestone having fewer than 2 active tasks, that's not a bug to route around — it means this milestone is small enough that it might be an accidental under-breakdown rather than a deliberate one-off. Before calling `milestone_approve(milestone_id)`, actually check with the user: is a single-task milestone here intentional, or would this task make more sense folded into a neighboring milestone instead? Only call `milestone_approve` once you've gotten a real answer — it exists to catch genuine oversights, not to be rubber-stamped past on your own so you can keep moving. Once approved, the restriction is lifted for that milestone permanently, even if its active task count drops back below 2 later (e.g. a task gets cancelled).

## Doing the work

```
task_list(status="pending") → task_update_status(id, "in_progress") → do the work
  → task_add_note(type="progress" | "evidence" | "uncertainty") as you go
  → [if something stops you] task_add_note(type="blocker") → task_update_status(id, "blocked", reason=...)
  → task_update_status(id, "completed")
```

- If `task_update_status(id, "in_progress")` is rejected for being in an unapproved, too-small milestone, see "When a milestone is too small to start on" above — don't just retry or work around it.
- **Follow the check-in cadence the user picked when you presented the final plan:**
  - *After every task* — once a task is `completed` (or `blocked`), stop and report before starting the next one.
  - *After every milestone* — keep working through a milestone's tasks uninterrupted, then stop and report once every task in it is `completed` or `cancelled` (or one is `blocked`).
  - *Straight through* — keep going until the whole Goal is done, or until something is `blocked` and needs a decision only the user can make.
  Whichever cadence applies, use the **completion report** format below when you stop — don't just finish a tool call silently and wait for the next instruction.
- `reason` is required by the schema when you set status to `blocked` or `cancelled` — always explain why.
- The schema has no dedicated fields for a task's dependencies or how to verify it done — that's intentional (see the closing note), not a gap to work around with extra tools. Put that context straight into the task's `description` when you create it (e.g. "depends on: <other task title>" / "verify by: run X, check Y") so it's there when you or a future session reads the task back.
  Before calling `task_create`, ask yourself: if a future session with zero memory of this conversation read only this description, would they know what to change and how to confirm it's done — without asking you? A description shorter than a sentence almost never clears that bar.
  - Not enough: "Fix the bug"
  - Enough: "Fix the pagination cursor resetting to page 1 after a filter change — depends on: task 'add filter state to URL params' / verify by: apply a filter, click next page, filter should stay applied"
- `task_create`'s response includes `milestone_active_task_count`. Watch it: if a milestone is trending past 5 active tasks, consider starting a new milestone for the next chunk of work instead of continuing to pile on. If `goal_get_context` / `status_report` flag a milestone in `milestones_out_of_range`, it's advisory — decide whether to split, merge, or just add more tasks; you won't be blocked either way.
- Titles and descriptions are immutable once created (by design — corrections are rare enough that they don't need a dedicated tool). If a title or description turns out wrong, record the correction with `task_add_note(type="decision")` rather than looking for an edit tool.

## Ending a session

Always call `checkpoint_save(goal_id, current_task_id?, agent_summary, next_actions)` before your context resets — even if you didn't finish anything. `agent_summary` and `next_actions` are what the *next* session's `goal_get_context` call will hand back as `last_checkpoint`; write them for a future instance of yourself with zero memory of this conversation.

If you changed the plan mid-session — added a milestone that wasn't in the original breakdown, cancelled tasks because an assumption turned out wrong, reprioritized which milestone matters most — say so in `agent_summary`. There's no separate "pivot log" in this schema, and no tool reads back checkpoint *history* either — `goal_get_context` only ever returns the single latest one. Writing down what changed and why still matters, but think of it as a note for whoever picks this up next, not as building a queryable log: if you need to know what happened three sessions ago, there's no tool call that gets you there.

## Checking status / verifying completion

Call `status_report(goal_id)` for a periodic review or before closing a goal. It returns the same progress/milestone aggregates as `goal_get_context`, plus `blocked_tasks` (each with its latest note) and the goal's `acceptance_criteria` as a plain list.

For any `blocked_tasks` entry worth acting on, call `task_get(task_id)` to read its full note history before deciding anything — the single `latest_note` in `status_report` is enough to notice a block, not always enough to understand it. Record what you decide with `task_add_note(type="decision")` on that task.

There is no per-criterion "checked" flag anywhere in this schema — that was tried and deliberately removed. Verification is your job: cross-check `acceptance_criteria` against the actual task evidence yourself, then record what you verified in `checkpoint_save`'s `agent_summary` / `next_actions` (or a `task_add_note(type="evidence")` on the relevant task). Don't invent your own tracking field for this.

`completion_pct` is `null` when there are no tasks yet, or every task has been cancelled — treat `null` as "not measurable yet," not zero. When you report a progress number to a human, say what it's counting (e.g. "42% — 5 of 12 non-cancelled tasks" rather than a bare "42%"), so a stale or misleading number is easy to catch instead of taken on faith.

## Closing out

```
status_report(goal_id)   // completion_pct should be 100 (or null if everything was cancelled)
  → [verify acceptance_criteria yourself against task evidence]
  → goal_update_status(goal_id, "completed", note?)
```

`goal_update_status` also handles archiving (`"archived"`) and reactivating an archived goal (`"active"`) — there's no separate archive/reactivate tool.

## Why this schema stays this thin

GoalTracker deliberately has no fields for task dependencies, verify-methods, breakdown strategy, or a change/pivot log — richer planning practice (a breakdown strategy, dependency ordering, a real Definition of Done, logging why a plan changed) belongs in *how you use* `description`, `task_add_note`, and `checkpoint_save`, not in new columns. Before treating something as a missing feature, try encoding it in an existing free-text field first — the schema has already had several structured fields proposed and deliberately rejected for exactly this reason (see `docs/design/05-decisions.md`). If something genuinely can't be expressed this way — not just "would be marginally more convenient as a dedicated field" — that's worth raising as a real schema change instead of a workaround.
