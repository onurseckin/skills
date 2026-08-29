/**
 * Shared Leaf Contracts for Task Queue & Execution Management
 */

export type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled"
  | "declined";

export type TaskPriority = "critical" | "high" | "medium" | "low";

export interface SmartTaskStep {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly targetFiles: readonly string[];
  readonly writeScope: readonly string[];
  readonly gate: string;
  readonly role?: string | undefined;
  readonly dependsOn?: readonly string[] | undefined;
}

export interface SmartTaskPlan {
  readonly planId: string;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly SmartTaskStep[];
  readonly category?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface QueueItem {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly plan?: SmartTaskPlan | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly assignedTo?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface CompletedTaskRecord {
  readonly id: string;
  readonly title: string;
  readonly status: "completed" | "failed";
  readonly completedAt: string;
  readonly summary?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface TaskCandidate {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly category: string;
  readonly writeScope: readonly string[];
  readonly targetFiles: readonly string[];
  readonly gate: string;
  readonly role?: string | undefined;
}

export interface TaskExecutionResult {
  readonly success: boolean;
  readonly taskId: string;
  readonly error?: string | undefined;
  readonly durationMs?: number | undefined;
}
