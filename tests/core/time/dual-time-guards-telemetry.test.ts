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

describe("Type Guards Validation (Extended Telemetry)", () => {
  test("type guards return false for invalid telemetry structures", () => {
    expect(isUnitTestTelemetry([])).toBe(false);
    expect(isUnitTestTelemetry({ test_suite: 123 })).toBe(false);
    expect(isUnitTestTelemetry({ test_suite: "s", actor: 123 })).toBe(false);
    expect(isUnitTestTelemetry({ test_suite: "s", actor: "a", started_at: "invalid" })).toBe(false);
    expect(
      isUnitTestTelemetry({
        test_suite: "s",
        actor: "a",
        started_at: getDualTime(),
        completed_at: "invalid",
      }),
    ).toBe(false);
    expect(
      isUnitTestTelemetry({
        test_suite: "s",
        actor: "a",
        started_at: getDualTime(),
        completed_at: getDualTime(),
        test_duration_ms: "0",
      }),
    ).toBe(false);
    expect(
      isUnitTestTelemetry({
        test_suite: "s",
        actor: "a",
        started_at: getDualTime(),
        completed_at: getDualTime(),
        test_duration_ms: 0,
        test_duration_formatted: 123,
      }),
    ).toBe(false);
    expect(
      isUnitTestTelemetry({
        test_suite: "s",
        actor: "a",
        started_at: getDualTime(),
        completed_at: getDualTime(),
        test_duration_ms: 0,
        test_duration_formatted: "0ms",
        passed: "true",
      }),
    ).toBe(false);
    expect(
      isUnitTestTelemetry({
        test_suite: "s",
        actor: "a",
        started_at: getDualTime(),
        completed_at: getDualTime(),
        test_duration_ms: 0,
        test_duration_formatted: "0ms",
        passed: true,
        passed_count: "0",
      }),
    ).toBe(false);
    expect(
      isUnitTestTelemetry({
        test_suite: "s",
        actor: "a",
        started_at: getDualTime(),
        completed_at: getDualTime(),
        test_duration_ms: 0,
        test_duration_formatted: "0ms",
        passed: true,
        passed_count: 0,
        failed_count: "0",
      }),
    ).toBe(false);
    expect(
      isUnitTestTelemetry({
        test_suite: "s",
        actor: "a",
        started_at: getDualTime(),
        completed_at: getDualTime(),
        test_duration_ms: 0,
        test_duration_formatted: "0ms",
        passed: true,
        passed_count: 0,
        failed_count: 0,
        skipped_count: "0",
      }),
    ).toBe(false);
    expect(
      isUnitTestTelemetry({
        test_suite: "s",
        actor: "a",
        started_at: getDualTime(),
        completed_at: getDualTime(),
        test_duration_ms: 0,
        test_duration_formatted: "0ms",
        passed: true,
        passed_count: 0,
        failed_count: 0,
        skipped_count: 0,
        individual_tests: "invalid",
      }),
    ).toBe(false);

    expect(isSchedulerWatchdogTelemetry(null)).toBe(false);
    expect(isSchedulerWatchdogTelemetry([])).toBe(false);
    expect(isSchedulerWatchdogTelemetry({ tick_utc: 123 })).toBe(false);
    expect(isSchedulerWatchdogTelemetry({ tick_utc: "u", tick_local: 123 })).toBe(false);
    expect(
      isSchedulerWatchdogTelemetry({ tick_utc: "u", tick_local: "l", tick_dual: "invalid" }),
    ).toBe(false);
    expect(
      isSchedulerWatchdogTelemetry({
        tick_utc: "u",
        tick_local: "l",
        tick_dual: getDualTime(),
        interval_ms: "0",
      }),
    ).toBe(false);
    expect(
      isSchedulerWatchdogTelemetry({
        tick_utc: "u",
        tick_local: "l",
        tick_dual: getDualTime(),
        interval_ms: 0,
        drift_ms: "0",
      }),
    ).toBe(false);
    expect(
      isSchedulerWatchdogTelemetry({
        tick_utc: "u",
        tick_local: "l",
        tick_dual: getDualTime(),
        interval_ms: 0,
        drift_ms: 0,
        elapsed_ms: "0",
      }),
    ).toBe(false);
    expect(
      isSchedulerWatchdogTelemetry({
        tick_utc: "u",
        tick_local: "l",
        tick_dual: getDualTime(),
        interval_ms: 0,
        drift_ms: 0,
        elapsed_ms: 0,
        actor: 123,
      }),
    ).toBe(false);
    expect(
      isSchedulerWatchdogTelemetry({
        tick_utc: "u",
        tick_local: "l",
        tick_dual: getDualTime(),
        interval_ms: 0,
        drift_ms: 0,
        elapsed_ms: 0,
        actor: "a",
        component: 123,
      }),
    ).toBe(false);
    expect(
      isSchedulerWatchdogTelemetry({
        tick_utc: "u",
        tick_local: "l",
        tick_dual: getDualTime(),
        interval_ms: 0,
        drift_ms: 0,
        elapsed_ms: 0,
        actor: "a",
        component: "c",
        iteration: "invalid",
      }),
    ).toBe(false);

    expect(isStepMachineTelemetry(null)).toBe(false);
    expect(isStepMachineTelemetry([])).toBe(false);
    expect(isStepMachineTelemetry({ step_id: 123 })).toBe(false);
    expect(isStepMachineTelemetry({ step_id: "s", step_name: 123 })).toBe(false);
    expect(isStepMachineTelemetry({ step_id: "s", step_name: "n", state: 123 })).toBe(false);
    expect(isStepMachineTelemetry({ step_id: "s", step_name: "n", state: "st", actor: 123 })).toBe(
      false,
    );
    expect(
      isStepMachineTelemetry({
        step_id: "s",
        step_name: "n",
        state: "st",
        actor: "a",
        created_dual: "invalid",
      }),
    ).toBe(false);
    expect(
      isStepMachineTelemetry({
        step_id: "s",
        step_name: "n",
        state: "st",
        actor: "a",
        created_dual: getDualTime(),
        updated_dual: "invalid",
      }),
    ).toBe(false);
    expect(
      isStepMachineTelemetry({
        step_id: "s",
        step_name: "n",
        state: "st",
        actor: "a",
        created_dual: getDualTime(),
        updated_dual: getDualTime(),
        started_at: "invalid",
      }),
    ).toBe(false);
    expect(
      isStepMachineTelemetry({
        step_id: "s",
        step_name: "n",
        state: "st",
        actor: "a",
        created_dual: getDualTime(),
        updated_dual: getDualTime(),
        completed_at: "invalid",
      }),
    ).toBe(false);
    expect(
      isStepMachineTelemetry({
        step_id: "s",
        step_name: "n",
        state: "st",
        actor: "a",
        created_dual: getDualTime(),
        updated_dual: getDualTime(),
        duration_ms: "invalid",
      }),
    ).toBe(false);
    expect(
      isStepMachineTelemetry({
        step_id: "s",
        step_name: "n",
        state: "st",
        actor: "a",
        created_dual: getDualTime(),
        updated_dual: getDualTime(),
        duration_formatted: 123,
      }),
    ).toBe(false);
  });
});
