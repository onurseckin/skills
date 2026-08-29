import type { TaskPriority, TaskQueueStatus } from "./types.ts";

export interface TaskQueueStats {
  readonly total: number;
  readonly pending: number;
  readonly admitted: number;
  readonly in_progress: number;
  readonly running: number;
  readonly validating: number;
  readonly completed: number;
  readonly failed: number;
  readonly blocked: number;
  readonly escalated: number;
  readonly active_leases: number;
  readonly expired_leases: number;
}

export interface TaskQueueFilterOptions {
  readonly status?: TaskQueueStatus | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly customPath?: string | undefined;
  readonly limit?: number | undefined;
  readonly agentId?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly search?: string | undefined;
}
