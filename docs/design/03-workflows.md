# Agent Workflows

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
The bracketed steps are conversational, not tool calls — the MCP has no opinion on spec/plan formatting or check-in cadence (see [05-decisions.md](05-decisions.md), "Rejected: MCP-provided presentation templates"). The companion skill teaches the Agent a consistent presentation format for both.

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

## Real-world Call Frequency

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
