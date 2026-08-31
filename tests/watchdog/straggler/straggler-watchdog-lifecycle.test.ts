import { describe, expect, it } from "bun:test";
import {
  assessTaskStraggler,
  assessTaskStragglerStatus,
  parseTimestampMs,
  PROGRESS_SILENCE_THRESHOLD_SECONDS,
  STRAGGLER_SLA_SECONDS,
  TASK_STRAGGLER_OVERBURDEN_DEFECT,
  type MonitoredTask,
} from "../../../olt/scripts/src/watchdog/straggler-watchdog.ts";

describe("StragglerWatchdog Task Assessment & Heartbeat Grace", () => {
  it("exports standard straggler constants", () => {
    expect(STRAGGLER_SLA_SECONDS).toBe(300);
    expect(PROGRESS_SILENCE_THRESHOLD_SECONDS).toBe(120);
    expect(TASK_STRAGGLER_OVERBURDEN_DEFECT).toBe("TASK_STRAGGLER_OVERBURDEN_DEFECT");
  });

  it("parseTimestampMs parses numbers, ISO dates and falls back to now for invalid strings", () => {
    expect(parseTimestampMs(1700000000000)).toBe(1700000000000);
    expect(parseTimestampMs("2026-08-20T12:00:00.000Z")).toBe(
      Date.parse("2026-08-20T12:00:00.000Z"),
    );
    expect(parseTimestampMs("invalid-timestamp")).toBeGreaterThan(0);
  });

  it("returns is_straggler = false for non-active tasks (COMPLETED, FAILED, PENDING)", () => {
    const now = 1700000600000;
    const taskCompleted: MonitoredTask = {
      id: "task-comp",
      status: "COMPLETED",
      claimed_at: now - 400_000,
    };
    const taskFailed: MonitoredTask = {
      id: "task-fail",
      status: "FAILED",
      claimed_at: now - 400_000,
    };
    const taskPending: MonitoredTask = {
      id: "task-pend",
      status: "PENDING",
      claimed_at: now - 400_000,
    };

    expect(assessTaskStraggler(taskCompleted, now).is_straggler).toBe(false);
    expect(assessTaskStraggler(taskFailed, now).is_straggler).toBe(false);
    expect(assessTaskStraggler(taskPending, now).is_straggler).toBe(false);
  });

  it("evaluates tasks within 300s SLA as healthy", () => {
    const now = 1700000200000;
    const task: MonitoredTask = {
      id: "task-healthy",
      agent_id: "agent-1",
      status: "RUNNING",
      claimed_at: now - 150_000, // 150s elapsed
    };

    const assessment = assessTaskStragglerStatus(task, now);
    expect(assessment.is_straggler).toBe(false);
    expect(assessment.elapsed_seconds).toBe(150);
    expect(assessment.recommended_action).toBe("CONTINUE");
  });

  it("considers active tasks exceeding 300s SLA healthy if progress was reported within 120s grace period", () => {
    const now = 1700000400000; // 400s elapsed since claim
    const task: MonitoredTask = {
      id: "task-grace",
      agent_id: "agent-active",
      status: "IN_PROGRESS",
      claimed_at: now - 400_000,
      last_progress: now - 60_000, // 60s silence <= 120s grace
    };

    const assessment = assessTaskStraggler(task, now);
    expect(assessment.is_straggler).toBe(false);
    expect(assessment.elapsed_seconds).toBe(400);
    expect(assessment.recommended_action).toBe("CONTINUE");
  });
});
