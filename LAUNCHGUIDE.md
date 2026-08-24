# GoalTracker

## Tagline
Persistent, structured project memory for AI coding agents — Goal → Spec → Milestone → Task.

## Description
GoalTracker is an MCP (Model Context Protocol) server that gives an AI coding agent (Claude Code, Claude Desktop, or any MCP-compatible client) a real, durable plan to work from instead of an ad-hoc todo list in chat. It stores a `Goal → Spec → Milestone → Task → Note` hierarchy in a single local SQLite file, exposing 14 MCP tools for creating goals, confirming specs, breaking work into milestones and tasks, tracking status with an audit trail, and checkpointing progress.

The core problem it solves is context loss: long-running coding work rarely fits in one session, and a plain chat-based todo list doesn't survive a context reset or a handoff to a different agent. With GoalTracker, a fresh agent session — or an entirely different agent picking up the same work hours or days later — recovers full context (goal, confirmed spec, milestone/task state, and the last checkpoint's summary and next actions) with a single `goal_get_context` call, rather than re-deriving the plan from conversation history.

It is data-only and judgment-free by design: the MCP stores and returns structured data but never makes planning decisions itself. A handful of built-in gates catch accidental skips rather than enforcing quality broadly: a milestone with fewer than 2 active tasks blocks task work until explicitly approved via `milestone_approve`; `goal_create` requires a non-empty description; `spec_set` requires at least one acceptance criterion; and once a Goal is archived or completed, milestone/task/checkpoint tools stay locked until it's reactivated. Everywhere else, planning judgment stays with the agent and the user.

It's for developers and teams who use AI coding agents on multi-session or multi-agent projects and want the agent to remember what it's doing, why a task is blocked, and what's left — without re-explaining the plan every time context resets.

## Setup Requirements
No required environment variables. GoalTracker works out of the box with zero configuration.

- `GOALTRACKER_DB_PATH` (optional): Path to the SQLite database file. Defaults to `~/.goaltracker/goaltracker.db`, created automatically on first run. Schema migrations apply themselves on startup — no manual migration step is ever needed.

## Category
Developer Tools

## Use Cases
Project Management, Task Tracking, Context Persistence, Agent Handoff, Progress Reporting, Session Recovery

## Features
- Stores a full `Goal → Spec → Milestone → Task → Note` hierarchy in a single local SQLite file — no external database or account needed
- One-call session warm-up via `goal_get_context`: returns the goal, confirmed spec, every milestone with task counts, and the last checkpoint in a single response
- Full context recovery for a different agent or a different session, including *why* a task is blocked, not just that it is
- Audit trail on every status change, with a required reason for `blocked` or `cancelled` transitions
- Validation stays narrow and targeted: milestones with fewer than 2 active tasks require explicit `milestone_approve`, and an archived or completed Goal locks its milestones/tasks/checkpoints until reactivated
- `spec_set` enforces confirming an overview and at least one acceptance criterion with the user before work is broken into milestones
- An `active` Goal untouched for over 14 days gets flagged `is_stale` on every read, prompting a check-in
- `checkpoint_save` captures an agent summary and next actions at every stopping point, enabling clean handoffs between agents or sessions
- `status_report` gives a progress snapshot (completion percentage, blocked tasks, acceptance criteria) for closing out a goal
- Companion agent skill (installable via `npx goaltracker install-skill`) teaches the correct tool call sequence — spec confirmation, milestone breakdown strategy, checkpoint habits
- Optional integration with Anthropic's Superpowers skill collection: when installed, the companion skill calls `superpowers:brainstorming` to weigh approaches before drafting a Spec for large or ambiguous goals
- Zero external dependencies at runtime beyond a local SQLite file; self-contained and works fully offline

## Getting Started
- "Start tracking a new goal: add dark mode support to the settings page"
- "What's the current status of the goal I was working on?"
- "Resume work — pick up where the last session left off"
- "Give me a status report on this goal before I close it out"
- Tool: `goal_create` — Create a new goal with a required description; the starting point for any tracked piece of work
- Tool: `spec_set` — Record and confirm the spec (overview + acceptance criteria) for a goal before it's broken into milestones
- Tool: `milestone_create` — Break a confirmed spec into milestones
- Tool: `task_create` — Add tasks under a milestone
- Tool: `task_update_status` — Move a task through pending → in_progress → completed/blocked/cancelled, with a required reason for blocked/cancelled
- Tool: `goal_get_context` — One-call recovery of goal, spec, milestones, progress, and last checkpoint; use at the start of any session touching an existing goal
- Tool: `status_report` — Progress snapshot and acceptance-criteria check before closing a goal
- Tool: `checkpoint_save` — Save an agent summary and next actions at any stopping point, for clean handoff to a future session or agent

## Tags
mcp, project-management, task-management, agent-memory, sqlite, context-persistence, ai-agents, llm-tools, goal-tracking, milestones, agent-skills, session-recovery

## Documentation URL
https://github.com/Nhat-TheDev/GoalTracker#readme

## Health Check URL
N/A — GoalTracker runs locally over stdio transport; it is not a hosted/remote server.
