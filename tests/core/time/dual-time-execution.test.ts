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

describe("Tool Execution Telemetry", () => {
  test("createToolExecutionTelemetry calculates duration and captures execution details", () => {
    const started = "2026-08-22T09:30:00.000Z";
    const finished = "2026-08-22T09:30:02.350Z";

    const toolTelemetry = createToolExecutionTelemetry({
      tool_name: "run_command",
      actor: "task_implementer",
      started_at: started,
      finished_at: finished,
      parameters: { command: "bun test" },
      status: "success",
      timezone: "UTC",
    });

    expect(toolTelemetry.tool_name).toBe("run_command");
    expect(toolTelemetry.actor).toBe("task_implementer");
    expect(toolTelemetry.duration_ms).toBe(2350);
    expect(toolTelemetry.duration_formatted).toBe("2.35s");
    expect(toolTelemetry.status).toBe("success");
    expect(isToolExecutionTelemetry(toolTelemetry)).toBe(true);
  });

  test("createToolExecutionTelemetry defaults status to error when error is present", () => {
    const toolTelemetry = createToolExecutionTelemetry({
      tool_name: "read_file",
      actor: "task_implementer",
      started_at: "2026-08-22T09:30:00.000Z",
      finished_at: "2026-08-22T09:30:00.050Z",
      error: "ENOENT: file not found",
    });

    expect(toolTelemetry.status).toBe("error");
    expect(toolTelemetry.error).toBe("ENOENT: file not found");
    expect(toolTelemetry.duration_ms).toBe(50);
    expect(isToolExecutionTelemetry(toolTelemetry)).toBe(true);
  });

  test("createToolExecutionTelemetry defaults finished_at to now and status to success when no error", () => {
    const toolTelemetry = createToolExecutionTelemetry({
      tool_name: "write_file",
      actor: "task_implementer",
      started_at: Date.now() - 100,
    });
    expect(toolTelemetry.status).toBe("success");
    expect(toolTelemetry.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

describe("Unit Test & Gate Telemetry", () => {
  test("createUnitTestTelemetry aggregates individual test timings and passes status", () => {
    const started = "2026-08-22T09:30:00.000Z";
    const completed = "2026-08-22T09:30:05.120Z";

    const unitTelemetry = createUnitTestTelemetry({
      test_suite: "tests/core/dual-time.test.ts",
      actor: "task_implementer",
      started_at: started,
      completed_at: completed,
      individual_tests: [
        { name: "test 1", duration_ms: 120, status: "pass" },
        { name: "test 2", duration_ms: 300, status: "pass" },
        { name: "test 3", duration_ms: 50, status: "skip" },
      ],
      timezone: "UTC",
    });

    expect(unitTelemetry.test_suite).toBe("tests/core/dual-time.test.ts");
    expect(unitTelemetry.test_duration_ms).toBe(5120);
    expect(unitTelemetry.test_duration_formatted).toBe("5.12s");
    expect(unitTelemetry.passed).toBe(true);
    expect(unitTelemetry.passed_count).toBe(2);
    expect(unitTelemetry.failed_count).toBe(0);
    expect(unitTelemetry.skipped_count).toBe(1);
    expect(isUnitTestTelemetry(unitTelemetry)).toBe(true);
  });

  test("createUnitTestTelemetry computes individual test durations from started_at and completed_at when duration_ms is undefined", () => {
    const unitTelemetry = createUnitTestTelemetry({
      test_suite: "tests/core/timing.test.ts",
      actor: "task_implementer",
      started_at: "2026-08-22T09:30:00.000Z",
      individual_tests: [
        {
          name: "dynamic timing test",
          status: "pass",
          started_at: "2026-08-22T09:30:00.000Z",
          completed_at: "2026-08-22T09:30:00.250Z",
        },
        {
          name: "zero timing test",
          status: "pass",
        },
      ],
    });

    expect(unitTelemetry.individual_tests[0].duration_ms).toBe(250);
    expect(unitTelemetry.individual_tests[0].duration_formatted).toBe("250ms");
    expect(unitTelemetry.individual_tests[1].duration_ms).toBe(0);
  });

  test("createUnitTestTelemetry marks passed=false when individual tests fail", () => {
    const unitTelemetry = createUnitTestTelemetry({
      test_suite: "tests/core/failing.test.ts",
      actor: "task_implementer",
      started_at: "2026-08-22T09:30:00.000Z",
      completed_at: "2026-08-22T09:30:01.000Z",
      individual_tests: [
        { name: "test pass", duration_ms: 100, status: "pass" },
        { name: "test fail", duration_ms: 200, status: "fail", error: "Assertion failed" },
      ],
    });

    expect(unitTelemetry.passed).toBe(false);
    expect(unitTelemetry.passed_count).toBe(1);
    expect(unitTelemetry.failed_count).toBe(1);
    expect(isUnitTestTelemetry(unitTelemetry)).toBe(true);
  });
});

describe("Scheduler & Watchdog Telemetry", () => {
  test("calculateDrift correctly calculates signed difference in milliseconds", () => {
    expect(calculateDrift(1000, 1050)).toBe(50); // 50ms late
    expect(calculateDrift(1000, 980)).toBe(-20); // 20ms early
    expect(calculateDrift(1000, 1000)).toBe(0);
  });

  test("createSchedulerWatchdogTelemetry captures tick, drift, and elapsed time with defaults", () => {
    const startTime = 1787391000000;
    const expectedTick = 1787391010000; // 10s after start
    const actualTick = 1787391010045; // 45ms late

    const watchdog = createSchedulerWatchdogTelemetry({
      actor: "watchdog_daemon",
      component: "watchdog",
      interval_ms: 10000,
      start_time: startTime,
      expected_tick_ms: expectedTick,
      actual_tick: actualTick,
      iteration: 1,
      timezone: "UTC",
    });

    expect(watchdog.component).toBe("watchdog");
    expect(watchdog.interval_ms).toBe(10000);
    expect(watchdog.drift_ms).toBe(45);
    expect(watchdog.elapsed_ms).toBe(10045);
    expect(watchdog.tick_utc).toBe("2026-08-22T09:30:10.045Z");
    expect(watchdog.iteration).toBe(1);
    expect(isSchedulerWatchdogTelemetry(watchdog)).toBe(true);

    // Test defaults: component defaults to "scheduler", expected_tick_ms and start_time default to actualMs
    const defaultWatchdog = createSchedulerWatchdogTelemetry({
      actor: "default_actor",
      interval_ms: 5000,
    });
    expect(defaultWatchdog.component).toBe("scheduler");
    expect(defaultWatchdog.drift_ms).toBe(0);
    expect(defaultWatchdog.elapsed_ms).toBe(0);
  });
});
