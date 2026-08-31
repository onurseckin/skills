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
