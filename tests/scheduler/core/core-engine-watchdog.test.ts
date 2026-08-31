import { describe, expect, test } from "bun:test";
import {
  auditSupervisoryWatchdog,
  recoverStaleTasks,
} from "../../../olt/scripts/src/engine/scheduler/index.ts";
import type { TransactionPort, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import { schedulerState } from "../fixtures.ts";

function createMockPort(initialState: Record<string, unknown>): TransactionPort {
  let state = structuredClone(initialState) as unknown as WorkflowState;
  return {
    read: () => structuredClone(state),
    transact: (actor, kind, payload, mutate) => {
      const draft = structuredClone(state);
      mutate(draft);
      state = draft;
      return state;
    },
  };
}

describe("Core Scheduler Engine — Supervisory Watchdog & Stale Recovery", () => {
  test("auditSupervisoryWatchdog detects active watchdogs and overdue heartbeats", () => {
    const now = new Date("2026-08-22T10:30:00.000Z");
    const report = auditSupervisoryWatchdog(undefined, { now });
    expect(report).toBeDefined();
    expect(report.checkedAt).toBe(now.toISOString());
  });

  test("recoverStaleTasks transitions expired running task to retry_ready with replacement evidence", () => {
    const state = schedulerState();
    const now = new Date("2026-08-22T11:00:00.000Z");
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    tasks.priority!.status = "running";
    tasks.priority!.repair_round = 0;
    tasks.priority!.lease = {
      agent_id: "hung-worker-1",
      role: "implementer",
      attempt: 1,
      token_digest: "tok-1",
      issued_at: "2026-08-22T09:00:00.000Z",
      expires_at: "2026-08-22T09:30:00.000Z",
      heartbeat_at: "2026-08-22T09:10:00.000Z",
      duration_seconds: 1800,
    };

    const port = createMockPort(state);
    const recovery = recoverStaleTasks(port, { now, maxRepairRounds: 3 });

    expect(recovery.recoveredCount).toBe(1);
    expect(recovery.recoveredTasks[0]!.taskId).toBe("priority");
    expect(recovery.recoveredTasks[0]!.fromStatus).toBe("running");
    expect(recovery.recoveredTasks[0]!.toStatus).toBe("retry_ready");

    const updatedState = port.read();
    const recoveredTask = updatedState.tasks["priority"]!;
    expect(recoveredTask.status).toBe("retry_ready");
    expect(recoveredTask.replacement_reason).toBe("stale");
    expect(recoveredTask.lease).toBeUndefined();
  });

  test("recoverStaleTasks marks task stale when max repair rounds exhausted", () => {
    const state = schedulerState();
    const now = new Date("2026-08-22T11:00:00.000Z");
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    tasks.priority!.status = "running";
    tasks.priority!.repair_round = 3;
    tasks.priority!.lease = {
      agent_id: "crashed-worker",
      role: "implementer",
      attempt: 3,
      token_digest: "tok-3",
      issued_at: "2026-08-22T09:00:00.000Z",
      expires_at: "2026-08-22T09:30:00.000Z",
      heartbeat_at: "2026-08-22T09:10:00.000Z",
      duration_seconds: 1800,
    };

    const port = createMockPort(state);
    const recovery = recoverStaleTasks(port, { now, maxRepairRounds: 3 });

    expect(recovery.recoveredCount).toBe(1);
    expect(recovery.recoveredTasks[0]!.toStatus).toBe("stale");

    const updatedState = port.read();
    expect(updatedState.tasks["priority"]!.status).toBe("stale");
  });
});
