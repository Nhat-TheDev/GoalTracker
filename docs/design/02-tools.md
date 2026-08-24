# Tool Reference (14 tools)

> **Tool elimination rule**: A tool is removed if its output is already covered by another tool, or if its real-world call frequency is ~0 in a typical project.

---

## Group A — Goal (3 tools)

#### `goal_create`
| | |
|---|---|
| **Input** | `{ title: string, description: string }` |
| **Output** | `Goal` |
| **When** | Starting a new project. Called once. |
| **Note** | `description` is required and validated (empty string is rejected too, not just a missing field) — a 1-2 sentence summary of what this goal is about, so `goal_list` and a future session have something to scan instead of a bare title. See [05-decisions.md](05-decisions.md), "Accepted: required `description` on `goal_create`." |

#### `goal_list`
| | |
|---|---|
| **Input** | `{ status?: "active" \| "completed" \| "archived" }` |
| **Output** | `Array<Goal & { last_activity_at, days_since_last_activity, is_stale }>` — see `is_stale` note under `status_report` below |
| **When** | Agent needs to find a goal_id, or wants an overview of all projects. |

#### `goal_get_context` ⭐
| | |
|---|---|
| **Input** | `{ goal_id: string }` |
| **Output** | `{ goal (& is_stale), spec, milestones (with task_counts), milestones_out_of_range: string[], milestones_pending_approval: string[], progress, last_checkpoint }` |
| **When** | **Start of every session.** The single warm-up call. Replaces `spec_get + milestone_list + checkpoint_load`. |
| **Note** | `milestones_out_of_range` lists `milestone_id`s with < 2 or > 5 active tasks, excluding Milestones already `completed` — advisory only, the Agent decides whether to split/merge/add tasks. `milestones_pending_approval` lists `milestone_id`s with < 2 active tasks and no `approved_at` yet (same exclusion) — this one is not just advisory, see `milestone_approve` below. |

---

## Group B — Spec (1 tool)

#### `spec_set`
| | |
|---|---|
| **Input** | `{ goal_id, overview, acceptance_criteria[], constraints?, out_of_scope? }` — `acceptance_criteria` must have at least 1 item |
| **Output** | `Spec` |
| **When** | Creating or overwriting the Spec. Create-or-replace semantics. |
| **Note** | `spec_get` is unnecessary (returned by `goal_get_context`). `spec_update` is unnecessary (full overwrite is sufficient). An empty `acceptance_criteria` is rejected at the zod boundary — see [05-decisions.md](05-decisions.md). |

---

## Group C — Milestone (2 tools)

#### `milestone_create`
| | |
|---|---|
| **Input** | `{ goal_id, title, description?, order? }` |
| **Output** | `Milestone` |
| **When** | Breaking a Goal into phases during planning. |
| **Note** | `milestone_list` removed (in `goal_get_context`). `milestone_update` removed (rarely needed). Status is auto-computed. When `order` is omitted, it auto-assigns to `max(order within this goal) + 1` (starting at 0) instead of a constant default — avoids every Milestone colliding at `order = 0`. `description` stays optional and unvalidated by choice — see [05-decisions.md](05-decisions.md). Rejects if the parent Goal isn't `"active"` — see [05-decisions.md](05-decisions.md). |

#### `milestone_approve`
| | |
|---|---|
| **Input** | `{ milestone_id }` |
| **Output** | `Milestone` |
| **When** | A Milestone has fewer than 2 active tasks and the Agent has confirmed with the user this is intentional — not as a shortcut to unblock `task_update_status`. |
| **Note** | Sets `approved_at`, permanently lifting the restriction for that Milestone regardless of later task-count changes. Idempotent — calling it again just refreshes the timestamp. |

---

## Group D — Task (5 tools)

#### `task_create`
| | |
|---|---|
| **Input** | `{ milestone_id, title, description?, priority?: "low"\|"medium"\|"high" }` |
| **Output** | `Task & { milestone_active_task_count: number }` |
| **When** | Creating tasks during planning, or when new work emerges during execution. |
| **Note** | No hard cap. `milestone_active_task_count` (active = not `cancelled`, counted after this insert) lets the Agent judge against the 2–5 guideline (see [01-data-model.md](01-data-model.md)) and decide whether to start a new Milestone instead of continuing to add here. `description` stays optional and unvalidated by choice — see [05-decisions.md](05-decisions.md). Rejects if the parent Goal isn't `"active"` — see [05-decisions.md](05-decisions.md). |

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
| **Note** | Rejects a transition to `"in_progress"` if the task's Milestone has fewer than 2 active tasks and hasn't been approved yet (see `milestone_approve`). Other transitions (`blocked`, `cancelled`, `completed`) are never gated by that rule — but every transition, regardless of target status, is rejected if the task's Goal isn't `"active"` — see [05-decisions.md](05-decisions.md). |

#### `task_add_note`
| | |
|---|---|
| **Input** | `{ task_id, content, type: "progress"\|"blocker"\|"decision"\|"evidence"\|"uncertainty" }` |
| **Output** | `Note` |
| **When** | Recording evidence, blocker reasons, technical decisions, or potential risks found during work. |

---

## Group E — Status (1 tool)

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
  goal:     Goal & { last_activity_at: string, days_since_last_activity: number, is_stale: boolean },
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
`is_stale` (computed, not stored — same pattern as `Milestone.status`) is `true` only when the Goal's `status` is `"active"` and `last_activity_at` (the most recent of the Goal's own `updated_at` and every one of its Tasks' `updated_at`) is more than 14 days old. A `completed`/`archived` Goal is never `is_stale`, regardless of age. Also present on `goal`/each Goal returned by `goal_list` and `goal_get_context`.

---

## Group F — Lifecycle (2 tools)

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
| **Note** | Rejects if the Goal isn't `"active"`, and rejects `current_task_id` if it doesn't belong to `goal_id` — see [05-decisions.md](05-decisions.md). |
