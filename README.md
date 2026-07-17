# GoalTracker MCP

An MCP server designed to help AI Agents track progress, manage Goals and Tasks in a hierarchical model, and maintain context across sessions.

## Overview

GoalTracker acts as a "Goal-Oriented State Machine" for AI Agents. Instead of a simple flat to-do list, it stores a hierarchical state: `Goal` → `Spec` → `Milestone` → `Task` → `Note`.

### Key Features
- **Data only, no reasoning**: The MCP only stores and returns structured data. All reasoning and suggestions are the Agent's responsibility.
- **Single source of truth**: The entire project state lives in one SQLite DB. The Agent only needs to remember the `goal_id`.
- **Fast warm-up**: A context-reset Agent only needs 1 tool call (`goal_get_context`) to fully recover its working context.
- **Audit trail**: Every status change has a timestamp and reason — no information is lost.

## Architecture

- **Language**: TypeScript
- **Database**: SQLite (via `better-sqlite3`)
- **Transport**: `stdio` (for local Agent execution)
- **Validation**: `zod`

For full design details, see [docs/design/DESIGN.md](docs/design/DESIGN.md).

## Available Tools (13 Total)

### Group A: Goal Management
- `goal_create`: Start a new project.
- `goal_list`: View all projects.
- `goal_get_context`: **(Crucial)** Start of session warm-up. Retrieves goal, spec, milestones, progress, and last checkpoint in one call.

### Group B: Spec Management
- `spec_set`: Define what "done" looks like (acceptance criteria, constraints, out of scope). Create-or-replace semantics.

### Group C: Milestone Management
- `milestone_create`: Break a Goal into major phases. Status is auto-computed from tasks.

### Group D: Task Management
- `task_create`: Create a task within a milestone.
- `task_get`: Inspect a task's full details (including all notes).
- `task_list`: Find tasks to work on or review.
- `task_update_status`: Update progress (pending, in_progress, completed, blocked, cancelled). Requires reason for blocked/cancelled.
- `task_add_note`: Record evidence, decisions, blockers, or uncertainties.

### Group E: Status & Audit
- `status_report`: Periodic review tool. Returns aggregated data, completion percentage, and blocked tasks.

### Group F: Lifecycle
- `goal_update_status`: Close a finished goal or archive an inactive one.
- `checkpoint_save`: Save Agent's current context summary before session ends.

## Getting Started

*(Instructions for building and running the MCP server will be added here once implementation begins)*
