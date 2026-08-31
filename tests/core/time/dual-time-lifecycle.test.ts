import { describe, expect, test } from "bun:test";
import {
  calculateDrift,
  calculateDuration,
  createActionTelemetry,
  createSchedulerWatchdogTelemetry,
  createStepMachineTelemetry,
  createSubagentLifecycleTelemetry,
  createToolExecutionTelemetry,
  createUnitTestTelemetry,
  formatDualTimeDisplay,
  formatDuration,
  getDualTime,
  isActionTelemetry,
  isDualTimeRecord,
  isSchedulerWatchdogTelemetry,
  isStepMachineTelemetry,
  isSubagentLifecycleTelemetry,
  isToolExecutionTelemetry,
  isUnitTestTelemetry,
  updateStepMachineTelemetry,
  updateSubagentLifecycle,
  type DualTimeRecord,
} from "../../../olt/scripts/src/core/dual-time/index.ts";
import { extractTimestampMs } from "../../../olt/scripts/src/core/dual-time/clock.ts";

describe("Action Telemetry Registration Helper", () => {
  test("createActionTelemetry constructs action telemetry with unique UUID, dual-time, and details", () => {
    const details = { target: "task-101", priority: "high" };
    const action = createActionTelemetry(
      "task.disposition",
      "coordinator_lead",
      details,
      "2026-08-22T09:30:00.000Z",
      "UTC",
    );

    expect(typeof action.action_id).toBe("string");
    expect(action.action_id.length).toBeGreaterThan(10);
    expect(action.action_type).toBe("task.disposition");
    expect(action.actor).toBe("coordinator_lead");
    expect(action.timestamp.utc).toBe("2026-08-22T09:30:00.000Z");
    expect(action.display_time).toContain("2026-08-22 09:30:00 UTC (UTC+00:00)");
    expect(action.details).toEqual(details);
    expect(isActionTelemetry(action)).toBe(true);
  });

  test("createActionTelemetry handles empty details and defaults to current time", () => {
    const action = createActionTelemetry("heartbeat", "task_implementer");
    expect(action.action_type).toBe("heartbeat");
    expect(action.actor).toBe("task_implementer");
    expect(action.details).toEqual({});
    expect(isDualTimeRecord(action.timestamp)).toBe(true);
    expect(isActionTelemetry(action)).toBe(true);
  });
});

describe("Subagent Lifecycle Telemetry", () => {
  test("createSubagentLifecycleTelemetry and updateSubagentLifecycle track full lifecycle", () => {
    const spawnTime = "2026-08-22T09:00:00.000Z";
    const claimTime = "2026-08-22T09:01:00.000Z";
    const heartbeatTime = "2026-08-22T09:05:00.000Z";
    const submitTime = "2026-08-22T09:10:00.000Z";
    const reviewTime = "2026-08-22T09:12:00.000Z";

    let lifecycle = createSubagentLifecycleTelemetry({
      subagent_id: "agent-007",
      actor: "task_implementer",
      role: "task_implementer",
      spawned_at: spawnTime,
      metadata: { initial: true },
      timezone: "UTC",
    });

    expect(lifecycle.status).toBe("spawned");
    expect(lifecycle.spawned_at?.utc).toBe(spawnTime);
    expect(lifecycle.duration_ms).toBeUndefined();
    expect(isSubagentLifecycleTelemetry(lifecycle)).toBe(true);

    lifecycle = updateSubagentLifecycle(lifecycle, {
      claimed_at: claimTime,
      status: "claimed",
      timezone: "UTC",
    });
    expect(lifecycle.status).toBe("claimed");
    expect(lifecycle.claimed_at?.utc).toBe(claimTime);

    lifecycle = updateSubagentLifecycle(lifecycle, {
      heartbeat_at: heartbeatTime,
      status: "running",
      timezone: "UTC",
    });
    expect(lifecycle.heartbeat_at?.utc).toBe(heartbeatTime);

    lifecycle = updateSubagentLifecycle(lifecycle, {
      submitted_at: submitTime,
      status: "submitted",
      metadata: { workDone: true },
      timezone: "UTC",
    });
    expect(lifecycle.status).toBe("submitted");
    expect(lifecycle.submitted_at?.utc).toBe(submitTime);
    expect(lifecycle.duration_ms).toBe(540000); // 9 minutes from claimed (09:01 to 09:10)
    expect(lifecycle.duration_formatted).toBe("9m 0s");
    expect(lifecycle.metadata).toEqual({ initial: true, workDone: true });

    lifecycle = updateSubagentLifecycle(lifecycle, {
      reviewed_at: reviewTime,
      status: "reviewed",
      timezone: "UTC",
    });
    expect(lifecycle.status).toBe("reviewed");
    expect(lifecycle.reviewed_at?.utc).toBe(reviewTime);
    expect(lifecycle.duration_ms).toBe(660000); // 11 minutes from claimed (09:01 to 09:12)
    expect(lifecycle.duration_formatted).toBe("11m 0s");
  });

  test("createSubagentLifecycleTelemetry computes duration when spawned_at and submitted_at are provided directly", () => {
    const lifecycle = createSubagentLifecycleTelemetry({
      subagent_id: "agent-instant",
      actor: "task_implementer",
      spawned_at: "2026-08-22T09:00:00.000Z",
      submitted_at: "2026-08-22T09:05:00.000Z",
      timezone: "UTC",
    });

    expect(lifecycle.status).toBe("spawned");
    expect(lifecycle.duration_ms).toBe(300000);
    expect(lifecycle.duration_formatted).toBe("5m 0s");
  });

  test("createSubagentLifecycleTelemetry defaults status to running when not spawned", () => {
    const lifecycle = createSubagentLifecycleTelemetry({
      subagent_id: "agent-running",
      actor: "task_implementer",
    });
    expect(lifecycle.status).toBe("running");
  });

  test("updateSubagentLifecycle falls back to spawned_at if claimed_at is missing", () => {
    const initial = createSubagentLifecycleTelemetry({
      subagent_id: "agent-spawn-only",
      actor: "task_implementer",
      spawned_at: "2026-08-22T09:00:00.000Z",
      timezone: "UTC",
    });

    const updated = updateSubagentLifecycle(initial, {
      submitted_at: "2026-08-22T09:03:00.000Z",
      timezone: "UTC",
    });

    expect(updated.duration_ms).toBe(180000);
    expect(updated.duration_formatted).toBe("3m 0s");
  });
});
