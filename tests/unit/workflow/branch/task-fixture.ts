import type { JsonObject } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { ScopedLease, TaskRecord } from "../../../../olt/scripts/src/workflow/types.ts";

export function scopedLease(overrides: Partial<ScopedLease> = {}): ScopedLease {
  return {
    agent_id: "agent-1",
    role: "implementer",
    attempt: 1,
    token_digest: "digest",
    issued_at: "2026-08-19T00:00:00.000Z",
    expires_at: "2026-08-19T01:00:00.000Z",
    heartbeat_at: "2026-08-19T00:00:00.000Z",
    duration_seconds: 3600,
    write_scope: ["src/a"],
    resource_scope: [],
    ...overrides,
  };
}

export function taskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "T-1",
    status: "running",
    requirement_ids: ["R-1"],
    write_scope: ["src/a"],
    dependencies: [],
    attempts: [],
    history: [],
    repair_round: 0,
    ...overrides,
  };
}

export function draftWithTask(task: TaskRecord): JsonObject {
  return { tasks: { [task.id]: task as unknown as JsonObject } };
}
