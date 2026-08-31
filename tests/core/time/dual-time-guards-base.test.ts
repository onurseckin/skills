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
  });
});