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

describe("GraphJson & Step Machine Telemetry", () => {
  test("createStepMachineTelemetry and updateStepMachineTelemetry track step transitions", () => {
    const created = "2026-08-22T09:30:00.000Z";
    const started = "2026-08-22T09:30:01.000Z";
    const completed = "2026-08-22T09:30:04.500Z";

    let stepTelemetry = createStepMachineTelemetry({
      step_id: "step-001",
      step_name: "compile_artifacts",
      state: "pending",
      actor: "orchestrator",
      created_at: created,
      timezone: "UTC",
    });

    expect(stepTelemetry.step_id).toBe("step-001");
    expect(stepTelemetry.state).toBe("pending");
    expect(stepTelemetry.created_dual.utc).toBe(created);
    expect(stepTelemetry.duration_ms).toBeUndefined();
    expect(isStepMachineTelemetry(stepTelemetry)).toBe(true);

    stepTelemetry = updateStepMachineTelemetry(stepTelemetry, {
      state: "running",
      started_at: started,
      timezone: "UTC",
    });
    expect(stepTelemetry.state).toBe("running");
    expect(stepTelemetry.started_at?.utc).toBe(started);

    stepTelemetry = updateStepMachineTelemetry(stepTelemetry, {
      state: "completed",
      completed_at: completed,
      timezone: "UTC",
    });
    expect(stepTelemetry.state).toBe("completed");
    expect(stepTelemetry.completed_at?.utc).toBe(completed);
    expect(stepTelemetry.duration_ms).toBe(3500);
    expect(stepTelemetry.duration_formatted).toBe("3.50s");
  });

  test("createStepMachineTelemetry computes duration when started_at and completed_at are provided upfront", () => {
    const stepTelemetry = createStepMachineTelemetry({
      step_id: "step-direct",
      step_name: "direct_step",
      state: "completed",
      actor: "orchestrator",
      started_at: "2026-08-22T09:30:00.000Z",
      completed_at: "2026-08-22T09:30:02.500Z",
      timezone: "UTC",
    });

    expect(stepTelemetry.duration_ms).toBe(2500);
    expect(stepTelemetry.duration_formatted).toBe("2.50s");
  });
});
