import { z } from 'zod';

// ---------- Enums ----------

export const GoalStatus = z.enum(['active', 'completed', 'archived']);
export type GoalStatus = z.infer<typeof GoalStatus>;

export const MilestoneStatus = z.enum(['pending', 'in_progress', 'completed']);
export type MilestoneStatus = z.infer<typeof MilestoneStatus>;

export const TaskStatus = z.enum(['pending', 'in_progress', 'completed', 'blocked', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskPriority = z.enum(['low', 'medium', 'high']);
export type TaskPriority = z.infer<typeof TaskPriority>;

export const NoteType = z.enum(['progress', 'blocker', 'decision', 'evidence', 'uncertainty']);
export type NoteType = z.infer<typeof NoteType>;

// ---------- Models ----------

export const Goal = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: GoalStatus,
  status_note: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Goal = z.infer<typeof Goal>;

export const Spec = z.object({
  goal_id: z.string(),
  overview: z.string(),
  acceptance_criteria: z.array(z.string()),
  constraints: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  updated_at: z.string(),
});
export type Spec = z.infer<typeof Spec>;

export const Milestone = z.object({
  id: z.string(),
  goal_id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  order: z.number(),
  status: MilestoneStatus,
  approved_at: z.string().optional(),
  created_at: z.string(),
});
export type Milestone = z.infer<typeof Milestone>;

export const Task = z.object({
  id: z.string(),
  milestone_id: z.string(),
  goal_id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: TaskStatus,
  priority: TaskPriority,
  status_reason: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Task = z.infer<typeof Task>;

export const Note = z.object({
  id: z.string(),
  task_id: z.string(),
  content: z.string(),
  type: NoteType,
  created_at: z.string(),
});
export type Note = z.infer<typeof Note>;

export const Checkpoint = z.object({
  goal_id: z.string(),
  current_task_id: z.string().optional(),
  agent_summary: z.string(),
  next_actions: z.array(z.string()),
  saved_at: z.string(),
});
export type Checkpoint = z.infer<typeof Checkpoint>;

// ---------- Tool input schemas ----------

export const goalCreateInput = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
});

export const goalListInput = z.object({
  status: GoalStatus.optional(),
});

export const goalGetContextInput = z.object({
  goal_id: z.string().min(1),
});

export const goalUpdateStatusInput = z.object({
  goal_id: z.string().min(1),
  status: GoalStatus,
  note: z.string().optional(),
});

export const specSetInput = z.object({
  goal_id: z.string().min(1),
  overview: z.string().min(1),
  acceptance_criteria: z.array(z.string()),
  constraints: z.array(z.string()).optional(),
  out_of_scope: z.array(z.string()).optional(),
});

export const milestoneCreateInput = z.object({
  goal_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  order: z.number().int().optional(),
});

export const milestoneApproveInput = z.object({
  milestone_id: z.string().min(1),
});

export const taskCreateInput = z.object({
  milestone_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  priority: TaskPriority.optional(),
});

export const taskGetInput = z.object({
  task_id: z.string().min(1),
});

export const taskListInput = z.object({
  goal_id: z.string().optional(),
  milestone_id: z.string().optional(),
  status: TaskStatus.optional(),
  priority: TaskPriority.optional(),
});

export const taskUpdateStatusInput = z
  .object({
    task_id: z.string().min(1),
    status: TaskStatus,
    reason: z.string().optional(),
  })
  .refine((data) => !(['blocked', 'cancelled'].includes(data.status) && !data.reason), {
    message: 'reason is required when status is "blocked" or "cancelled"',
    path: ['reason'],
  });

export const taskAddNoteInput = z.object({
  task_id: z.string().min(1),
  content: z.string().min(1),
  type: NoteType,
});

export const statusReportInput = z.object({
  goal_id: z.string().min(1),
});

export const checkpointSaveInput = z.object({
  goal_id: z.string().min(1),
  current_task_id: z.string().optional(),
  agent_summary: z.string().min(1),
  next_actions: z.array(z.string()),
});

// ---------- Tool wiring ----------

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (args: unknown) => unknown;
}

// ---------- DB row -> model mapping ----------

type SqlRow = Record<string, unknown>;

export function rowToGoal(row: SqlRow): Goal {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? undefined,
    status: row.status as GoalStatus,
    status_note: (row.status_note as string | null) ?? undefined,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function rowToSpec(row: SqlRow): Spec {
  return {
    goal_id: row.goal_id as string,
    overview: row.overview as string,
    acceptance_criteria: JSON.parse(row.acceptance_criteria as string),
    constraints: JSON.parse(row.constraints as string),
    out_of_scope: JSON.parse(row.out_of_scope as string),
    updated_at: row.updated_at as string,
  };
}

export function rowToMilestoneBase(row: SqlRow): Omit<Milestone, 'status'> {
  return {
    id: row.id as string,
    goal_id: row.goal_id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? undefined,
    order: row.order as number,
    approved_at: (row.approved_at as string | null) ?? undefined,
    created_at: row.created_at as string,
  };
}

export function rowToTask(row: SqlRow): Task {
  return {
    id: row.id as string,
    milestone_id: row.milestone_id as string,
    goal_id: row.goal_id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? undefined,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    status_reason: (row.status_reason as string | null) ?? undefined,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function rowToNote(row: SqlRow): Note {
  return {
    id: row.id as string,
    task_id: row.task_id as string,
    content: row.content as string,
    type: row.type as NoteType,
    created_at: row.created_at as string,
  };
}

export function rowToCheckpoint(row: SqlRow): Checkpoint {
  return {
    goal_id: row.goal_id as string,
    current_task_id: (row.current_task_id as string | null) ?? undefined,
    agent_summary: row.agent_summary as string,
    next_actions: JSON.parse(row.next_actions as string),
    saved_at: row.saved_at as string,
  };
}
