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
} from "../../olt/scripts/src/core/dual-time/index.ts";
import { extractTimestampMs } from "../../olt/scripts/src/core/dual-time/clock.ts";

describe("Dual-Time Engine (DualTimeRecord, Conversion & Formatting)", () => {
  test("getDualTime() defaults to current time with complete valid structure", () => {
    const before = Date.now();
    const record = getDualTime();
    const after = Date.now();

    expect(record.timestamp_ms).toBeGreaterThanOrEqual(before);
    expect(record.timestamp_ms).toBeLessThanOrEqual(after);
    expect(typeof record.utc).toBe("string");
    expect(record.utc.endsWith("Z")).toBe(true);
    expect(typeof record.local).toBe("string");
    expect(typeof record.timezone).toBe("string");
    expect(typeof record.offset_minutes).toBe("number");
    expect(isDualTimeRecord(record)).toBe(true);
  });

  test("getDualTime converts Date instance, timestamp number, and ISO string accurately", () => {
    const fixedIso = "2026-08-22T09:30:00.000Z";
    const fixedMs = 1787391000000;
    const fixedDate = new Date(fixedIso);

    const fromDate = getDualTime(fixedDate, "America/Los_Angeles");
    const fromMs = getDualTime(fixedMs, "America/Los_Angeles");
    const fromIso = getDualTime(fixedIso, "America/Los_Angeles");

    expect(fromDate.timestamp_ms).toBe(fixedMs);
    expect(fromMs.timestamp_ms).toBe(fixedMs);
    expect(fromIso.timestamp_ms).toBe(fixedMs);

    expect(fromDate.utc).toBe("2026-08-22T09:30:00.000Z");
    expect(fromDate.local).toBe("2026-08-22T02:30:00.000-07:00");
    expect(fromDate.timezone).toBe("America/Los_Angeles");
    expect(fromDate.offset_minutes).toBe(-420);
  });

  test("getDualTime handles various global timezones and non-hour offsets", () => {
    const epoch = 1787391000000; // 2026-08-22T09:30:00.000Z

    const utcRec = getDualTime(epoch, "UTC");
    expect(utcRec.utc).toBe("2026-08-22T09:30:00.000Z");
    expect(utcRec.local).toBe("2026-08-22T09:30:00.000+00:00");
    expect(utcRec.offset_minutes).toBe(0);

    const tokyoRec = getDualTime(epoch, "Asia/Tokyo");
    expect(tokyoRec.utc).toBe("2026-08-22T09:30:00.000Z");
    expect(tokyoRec.local).toBe("2026-08-22T18:30:00.000+09:00");
    expect(tokyoRec.offset_minutes).toBe(540);

    const kathmanduRec = getDualTime(epoch, "Asia/Kathmandu");
    expect(kathmanduRec.utc).toBe("2026-08-22T09:30:00.000Z");
    expect(kathmanduRec.local).toBe("2026-08-22T15:15:00.000+05:45");
    expect(kathmanduRec.offset_minutes).toBe(345);

    const kolkataRec = getDualTime(epoch, "Asia/Kolkata");
    expect(kolkataRec.utc).toBe("2026-08-22T09:30:00.000Z");
    expect(kolkataRec.local).toBe("2026-08-22T15:00:00.000+05:30");
    expect(kolkataRec.offset_minutes).toBe(330);
  });

  test("getDualTime accepts an existing DualTimeRecord and preserves or converts timezone", () => {
    const initial = getDualTime("2026-08-22T09:30:00.000Z", "America/Los_Angeles");
    const copied = getDualTime(initial);
    expect(copied).toEqual(initial);

    const converted = getDualTime(initial, "UTC");
    expect(converted.timezone).toBe("UTC");
    expect(converted.offset_minutes).toBe(0);
    expect(converted.timestamp_ms).toBe(initial.timestamp_ms);

    // Object with timestamp_ms
    const fromObjMs = getDualTime({ timestamp_ms: 1787391000000 } as DualTimeRecord, "UTC");
    expect(fromObjMs.utc).toBe("2026-08-22T09:30:00.000Z");

    // Object with utc string
    const fromObjUtc = getDualTime(
      { utc: "2026-08-22T09:30:00.000Z" } as unknown as DualTimeRecord,
      "UTC",
    );
    expect(fromObjUtc.timestamp_ms).toBe(1787391000000);
  });

  test("getDualTime throws INVALID_ARGUMENT error on invalid inputs", () => {
    expect(() => getDualTime(NaN)).toThrow();
    expect(() => getDualTime(Infinity)).toThrow();
    expect(() => getDualTime(8.64e15 + 100000)).toThrow();
    expect(() => getDualTime("not-a-valid-date-string")).toThrow();
    expect(() => getDualTime(new Date("invalid"))).toThrow();
    expect(() => getDualTime("2026-08-22T09:30:00.000Z", "Invalid/Timezone_Name")).toThrow();
    expect(() => getDualTime({ foo: "bar" } as unknown as DualTimeRecord)).toThrow();
    expect(() => getDualTime({ timestamp_ms: NaN } as unknown as DualTimeRecord)).toThrow();
    expect(() => getDualTime({ utc: "invalid" } as unknown as DualTimeRecord)).toThrow();
    expect(() => getDualTime(true as unknown as number)).toThrow();
  });

  test("extractTimestampMs resolves all input variants and throws on invalid", () => {
    expect(extractTimestampMs(1787391000000)).toBe(1787391000000);
    expect(extractTimestampMs(new Date("2026-08-22T09:30:00.000Z"))).toBe(1787391000000);
    expect(extractTimestampMs("2026-08-22T09:30:00.000Z")).toBe(1787391000000);
    expect(extractTimestampMs({ timestamp_ms: 1787391000000 } as DualTimeRecord)).toBe(
      1787391000000,
    );
    expect(
      extractTimestampMs({ utc: "2026-08-22T09:30:00.000Z" } as unknown as DualTimeRecord),
    ).toBe(1787391000000);

    expect(() => extractTimestampMs(NaN)).toThrow();
    expect(() => extractTimestampMs(Infinity)).toThrow();
    expect(() => extractTimestampMs(new Date("invalid"))).toThrow();
    expect(() => extractTimestampMs("not-a-date")).toThrow();
    expect(() => extractTimestampMs({ utc: "not-a-date" } as unknown as DualTimeRecord)).toThrow();
    expect(() => extractTimestampMs({} as unknown as DualTimeRecord)).toThrow();
    expect(() => extractTimestampMs(null as unknown as DualTimeRecord)).toThrow();
    expect(() => extractTimestampMs(false as unknown as number)).toThrow();
  });

  test("formatDualTimeDisplay renders clean human-readable local time", () => {
    const fixedIso = "2026-08-22T09:30:00.000Z";

    const laRecord = getDualTime(fixedIso, "America/Los_Angeles");
    const laDisplay = formatDualTimeDisplay(laRecord);
    expect(laDisplay).toContain("2026-08-22 02:30:00");
    expect(laDisplay).toContain("(UTC-07:00)");

    const utcRecord = getDualTime(fixedIso, "UTC");
    const utcDisplay = formatDualTimeDisplay(utcRecord);
    expect(utcDisplay).toContain("2026-08-22 09:30:00");
    expect(utcDisplay).toContain("(UTC+00:00)");

    const kathmanduRecord = getDualTime(fixedIso, "Asia/Kathmandu");
    const kathmanduDisplay = formatDualTimeDisplay(kathmanduRecord);
    expect(kathmanduDisplay).toContain("2026-08-22 15:15:00");
    expect(kathmanduDisplay).toContain("(UTC+05:45)");

    // Test fallback when record has invalid timezone
    const fallbackRecord: DualTimeRecord = {
      utc: "2026-08-22T09:30:00.000Z",
      local: "2026-08-22T02:30:00.000-07:00",
      timezone: "Custom/Invalid_Timezone",
      offset_minutes: -420,
      timestamp_ms: 1787391000000,
    };
    const fallbackDisplay = formatDualTimeDisplay(fallbackRecord);
    expect(fallbackDisplay).toContain("2026-08-22 02:30:00 Custom/Invalid_Timezone (UTC-07:00)");
  });
});

describe("Duration Calculation & Formatting", () => {
  test("formatDuration formats across milliseconds, seconds, minutes, hours, and days", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(42)).toBe("42ms");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1000)).toBe("1.00s");
    expect(formatDuration(4250)).toBe("4.25s");
    expect(formatDuration(59990)).toBe("59.99s");
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(84500)).toBe("1m 24s");
    expect(formatDuration(3599000)).toBe("59m 59s");
    expect(formatDuration(3600000)).toBe("1h 0m 0s");
    expect(formatDuration(3661000)).toBe("1h 1m 1s");
    expect(formatDuration(86400000)).toBe("1d 0h 0m");
    expect(formatDuration(90000000)).toBe("1d 1h 0m");
    expect(formatDuration(176400000)).toBe("2d 1h 0m");
  });

  test("formatDuration handles negative durations with clean sign prefix", () => {
    expect(formatDuration(-250)).toBe("-250ms");
    expect(formatDuration(-3500)).toBe("-3.50s");
    expect(formatDuration(-65000)).toBe("-1m 5s");
    expect(formatDuration(-3661000)).toBe("-1h 1m 1s");
    expect(formatDuration(-90000000)).toBe("-1d 1h 0m");
  });

  test("calculateDuration computes duration between various input formats", () => {
    const startMs = 1787391000000;
    const endMs = 1787391004250;
    const startRecord = getDualTime(startMs);
    const endRecord = getDualTime(endMs);

    const fromRecords = calculateDuration(startRecord, endRecord);
    expect(fromRecords.duration_ms).toBe(4250);
    expect(fromRecords.formatted).toBe("4.25s");

    const fromStrings = calculateDuration("2026-08-22T09:30:00.000Z", "2026-08-22T09:30:04.250Z");
    expect(fromStrings.duration_ms).toBe(4250);
    expect(fromStrings.formatted).toBe("4.25s");

    const fromDates = calculateDuration(new Date(startMs), new Date(endMs));
    expect(fromDates.duration_ms).toBe(4250);
    expect(fromDates.formatted).toBe("4.25s");

    const fromNumbers = calculateDuration(startMs, endMs);
    expect(fromNumbers.duration_ms).toBe(4250);
    expect(fromNumbers.formatted).toBe("4.25s");
  });

  test("calculateDuration throws on invalid input", () => {
    expect(() => calculateDuration("invalid-start", 12345678)).toThrow();
    expect(() => calculateDuration(12345678, NaN)).toThrow();
  });
});

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
      test_suite: "tests/unit/core/dual-time.test.ts",
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

    expect(unitTelemetry.test_suite).toBe("tests/unit/core/dual-time.test.ts");
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
      test_suite: "tests/unit/core/timing.test.ts",
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
      test_suite: "tests/unit/core/failing.test.ts",
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

describe("Type Guards Validation", () => {
  test("type guards return false for non-conforming or partial objects", () => {
    expect(isDualTimeRecord(null)).toBe(false);
    expect(isDualTimeRecord([])).toBe(false);
    expect(isDualTimeRecord("string")).toBe(false);
    expect(isDualTimeRecord({})).toBe(false);
    expect(isDualTimeRecord({ utc: 123 })).toBe(false);
    expect(isDualTimeRecord({ utc: "2026", local: 123 })).toBe(false);
    expect(isDualTimeRecord({ utc: "2026", local: "2026", timezone: 123 })).toBe(false);
    expect(
      isDualTimeRecord({ utc: "2026", local: "2026", timezone: "UTC", offset_minutes: "0" }),
    ).toBe(false);
    expect(
      isDualTimeRecord({
        utc: "2026",
        local: "2026",
        timezone: "UTC",
        offset_minutes: 0,
        timestamp_ms: "invalid",
      }),
    ).toBe(false);

    expect(isActionTelemetry(null)).toBe(false);
    expect(isActionTelemetry([])).toBe(false);
    expect(isActionTelemetry({ action_id: 123 })).toBe(false);
    expect(isActionTelemetry({ action_id: "1", action_type: 123 })).toBe(false);
    expect(isActionTelemetry({ action_id: "1", action_type: "a", actor: 123 })).toBe(false);
    expect(
      isActionTelemetry({ action_id: "1", action_type: "a", actor: "act", display_time: 123 }),
    ).toBe(false);
    expect(
      isActionTelemetry({
        action_id: "1",
        action_type: "a",
        actor: "act",
        display_time: "time",
        timestamp: null,
      }),
    ).toBe(false);
    expect(
      isActionTelemetry({
        action_id: "1",
        action_type: "a",
        actor: "act",
        display_time: "time",
        timestamp: getDualTime(),
        details: null,
      }),
    ).toBe(false);

    expect(isSubagentLifecycleTelemetry(null)).toBe(false);
    expect(isSubagentLifecycleTelemetry([])).toBe(false);
    expect(isSubagentLifecycleTelemetry({ subagent_id: 123 })).toBe(false);
    expect(isSubagentLifecycleTelemetry({ subagent_id: "1", actor: 123 })).toBe(false);
    expect(isSubagentLifecycleTelemetry({ subagent_id: "1", actor: "act", status: 123 })).toBe(
      false,
    );
    expect(
      isSubagentLifecycleTelemetry({
        subagent_id: "1",
        actor: "act",
        status: "running",
        role: 123,
      }),
    ).toBe(false);
    expect(
      isSubagentLifecycleTelemetry({
        subagent_id: "1",
        actor: "act",
        status: "running",
        spawned_at: "invalid",
      }),
    ).toBe(false);
    expect(
      isSubagentLifecycleTelemetry({
        subagent_id: "1",
        actor: "act",
        status: "running",
        claimed_at: "invalid",
      }),
    ).toBe(false);
    expect(
      isSubagentLifecycleTelemetry({
        subagent_id: "1",
        actor: "act",
        status: "running",
        heartbeat_at: "invalid",
      }),
    ).toBe(false);
    expect(
      isSubagentLifecycleTelemetry({
        subagent_id: "1",
        actor: "act",
        status: "running",
        submitted_at: "invalid",
      }),
    ).toBe(false);
    expect(
      isSubagentLifecycleTelemetry({
        subagent_id: "1",
        actor: "act",
        status: "running",
        reviewed_at: "invalid",
      }),
    ).toBe(false);
    expect(
      isSubagentLifecycleTelemetry({
        subagent_id: "1",
        actor: "act",
        status: "running",
        duration_ms: "invalid",
      }),
    ).toBe(false);
    expect(
      isSubagentLifecycleTelemetry({
        subagent_id: "1",
        actor: "act",
        status: "running",
        duration_formatted: 123,
      }),
    ).toBe(false);
    expect(
      isSubagentLifecycleTelemetry({
        subagent_id: "1",
        actor: "act",
        status: "running",
        metadata: "invalid",
      }),
    ).toBe(false);

    expect(isToolExecutionTelemetry(null)).toBe(false);
    expect(isToolExecutionTelemetry([])).toBe(false);
    expect(isToolExecutionTelemetry({ tool_name: 123 })).toBe(false);
    expect(isToolExecutionTelemetry({ tool_name: "t", actor: 123 })).toBe(false);
    expect(isToolExecutionTelemetry({ tool_name: "t", actor: "a", started_at: "invalid" })).toBe(
      false,
    );
    expect(
      isToolExecutionTelemetry({
        tool_name: "t",
        actor: "a",
        started_at: getDualTime(),
        finished_at: "invalid",
      }),
    ).toBe(false);
    expect(
      isToolExecutionTelemetry({
        tool_name: "t",
        actor: "a",
        started_at: getDualTime(),
        finished_at: getDualTime(),
        duration_ms: "0",
      }),
    ).toBe(false);
    expect(
      isToolExecutionTelemetry({
        tool_name: "t",
        actor: "a",
        started_at: getDualTime(),
        finished_at: getDualTime(),
        duration_ms: 0,
        duration_formatted: 123,
      }),
    ).toBe(false);
    expect(
      isToolExecutionTelemetry({
        tool_name: "t",
        actor: "a",
        started_at: getDualTime(),
        finished_at: getDualTime(),
        duration_ms: 0,
        duration_formatted: "0ms",
        status: "unknown",
      }),
    ).toBe(false);
    expect(
      isToolExecutionTelemetry({
        tool_name: "t",
        actor: "a",
        started_at: getDualTime(),
        finished_at: getDualTime(),
        duration_ms: 0,
        duration_formatted: "0ms",
        status: "success",
        error: 123,
      }),
    ).toBe(false);
    expect(
      isToolExecutionTelemetry({
        tool_name: "t",
        actor: "a",
        started_at: getDualTime(),
        finished_at: getDualTime(),
        duration_ms: 0,
        duration_formatted: "0ms",
        status: "success",
        parameters: "invalid",
      }),
    ).toBe(false);
    expect(
      isToolExecutionTelemetry({
        tool_name: "t",
        actor: "a",
        started_at: getDualTime(),
        finished_at: getDualTime(),
        duration_ms: 0,
        duration_formatted: "0ms",
        status: "success",
        details: "invalid",
      }),
    ).toBe(false);

    expect(isUnitTestTelemetry(null)).toBe(false);
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
