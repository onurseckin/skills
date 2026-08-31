import { describe, it, expect } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  formatIntervalDuration,
  parseDuration,
  parseIntervalDuration,
} from "../../../olt/scripts/src/core/scheduling/index.ts";

describe("duration", () => {
  describe("parseDuration", () => {
    it("returns positive numbers as-is", () => {
      expect(parseDuration(0)).toBe(0);
      expect(parseDuration(5000)).toBe(5000);
      expect(parseDuration(123.45)).toBe(123.45);
    });

    it("throws HarnessError on negative or invalid numbers", () => {
      expect(() => parseDuration(-1)).toThrow(HarnessError);
      expect(() => parseDuration(NaN)).toThrow(HarnessError);
      expect(() => parseDuration(Infinity)).toThrow(HarnessError);
    });

    it("throws HarnessError on empty or invalid string", () => {
      expect(() => parseDuration("")).toThrow(HarnessError);
      expect(() => parseDuration("   ")).toThrow(HarnessError);
      expect(() => parseDuration("abc")).toThrow(HarnessError);
      expect(() => parseDuration("100xyz")).toThrow(HarnessError);
      expect(() => parseDuration("-5s")).toThrow(HarnessError);
    });

    it("parses valid strings with supported duration units", () => {
      expect(parseDuration("500")).toBe(500);
      expect(parseDuration("500ms")).toBe(500);
      expect(parseDuration("2s")).toBe(2000);
      expect(parseDuration("1.5s")).toBe(1500);
      expect(parseDuration("15m")).toBe(900000);
      expect(parseDuration("0.5m")).toBe(30000);
      expect(parseDuration("4h")).toBe(14400000);
      expect(parseDuration("1d")).toBe(86400000);
    });

    it("supports case-insensitive units and whitespace trimming", () => {
      expect(parseDuration(" 100MS ")).toBe(100);
      expect(parseDuration("5S")).toBe(5000);
      expect(parseDuration("2M")).toBe(120000);
      expect(parseDuration("1H")).toBe(3600000);
      expect(parseDuration("1D")).toBe(86400000);
    });
  });

  describe("parseIntervalDuration", () => {
    it("returns 0 for zero representations", () => {
      expect(parseIntervalDuration("0")).toBe(0);
      expect(parseIntervalDuration("0ms")).toBe(0);
      expect(parseIntervalDuration("0s")).toBe(0);
      expect(parseIntervalDuration("0m")).toBe(0);
      expect(parseIntervalDuration("0h")).toBe(0);
      expect(parseIntervalDuration("0d")).toBe(0);
    });

    it("parses non-zero interval strings accurately", () => {
      expect(parseIntervalDuration("15m")).toBe(900000);
      expect(parseIntervalDuration("4h")).toBe(14400000);
    });

    it("throws HarnessError on empty string", () => {
      expect(() => parseIntervalDuration("")).toThrow(HarnessError);
      expect(() => parseIntervalDuration("  ")).toThrow(HarnessError);
    });
  });

  describe("formatIntervalDuration", () => {
    it("formats zero and negative durations as 0ms", () => {
      expect(formatIntervalDuration(0)).toBe("0ms");
      expect(formatIntervalDuration(-100)).toBe("0ms");
    });

    it("formats sub-second durations with ms suffix", () => {
      expect(formatIntervalDuration(500)).toBe("500ms");
      expect(formatIntervalDuration(999)).toBe("999ms");
    });

    it("formats second durations without hours", () => {
      expect(formatIntervalDuration(5000)).toBe("5s");
      expect(formatIntervalDuration(45000)).toBe("45s");
    });

    it("formats minutes and combined minute-second durations", () => {
      expect(formatIntervalDuration(900000)).toBe("15m");
      expect(formatIntervalDuration(90000)).toBe("1m 30s");
    });

    it("formats hours and combined hour-minute durations", () => {
      expect(formatIntervalDuration(7200000)).toBe("2h");
      expect(formatIntervalDuration(5400000)).toBe("1h 30m");
      expect(formatIntervalDuration(3660000)).toBe("1h 1m");
    });
  });
});
