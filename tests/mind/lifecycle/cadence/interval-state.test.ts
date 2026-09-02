import { describe, expect, it } from "bun:test";
import {
  extractTrailingValueSeriesFromEvents,
  extractTrailingValueSeriesFromState,
  formatRawValueSeries,
  generateTrailingValueSeries,
  type TrailingValuePoint,
} from "../../../../olt/scripts/src/mind/lifecycle/interval/state.ts";

describe("Mind Lifecycle Interval State Suite (state.ts)", () => {
  describe("generateTrailingValueSeries", () => {
    it("handles empty pulse list with zeroed values", () => {
      const res = generateTrailingValueSeries([]);
      expect(res.points).toEqual([]);
      expect(res.rawValues).toEqual([]);
      expect(res.totalValue).toBe(0);
      expect(res.meanValue).toBe(0);
      expect(res.trailingZeroStreak).toBe(0);
      expect(res.isFlatZero).toBe(false);
      expect(res.windowSize).toBe(0);
      expect(res.formattedSeries).toBe("[]");
      expect(res.markdown).toContain("**Total Value**: 0");
    });

    it("computes windowed statistics, mean, and trailing zero streak", () => {
      const points: TrailingValuePoint[] = [
        { pulseId: "p1", outcome: "success", value: 10 },
        { pulseId: "p2", outcome: "success", value: 5 },
        { pulseId: "p3", outcome: "quiescent", value: 0 },
        { pulseId: "p4", outcome: "quiescent", value: 0 },
      ];

      const res = generateTrailingValueSeries(points, 3);
      expect(res.points.length).toBe(3);
      expect(res.rawValues).toEqual([5, 0, 0]);
      expect(res.totalValue).toBe(5);
      expect(res.meanValue).toBe(1.67);
      expect(res.trailingZeroStreak).toBe(2);
      expect(res.isFlatZero).toBe(false);
      expect(res.formattedSeries).toBe("[5, 0, 0]");
    });

    it("supports non-positive windowSize by retaining all pulses", () => {
      const points: TrailingValuePoint[] = [
        { pulseId: "p1", outcome: "success", value: 2 },
        { pulseId: "p2", outcome: "success", value: 3 },
      ];
      const res = generateTrailingValueSeries(points, 0);
      expect(res.points.length).toBe(2);
      expect(res.totalValue).toBe(5);
    });

    it("emits warning banner when series is flat zero with 5 or more pulses", () => {
      const flatPoints: TrailingValuePoint[] = Array.from({ length: 6 }, (_, i) => ({
        pulseId: `p-${i}`,
        outcome: "quiescent",
        value: 0,
      }));

      const res = generateTrailingValueSeries(flatPoints);
      expect(res.isFlatZero).toBe(true);
      expect(res.trailingZeroStreak).toBe(6);
      expect(res.markdown).toContain("⚠️ **Flat Zero Series**");
    });

    it("does not emit warning banner when flat zero has fewer than 5 pulses", () => {
      const flatPoints: TrailingValuePoint[] = [
        { pulseId: "p1", outcome: "quiescent", value: 0 },
        { pulseId: "p2", outcome: "quiescent", value: 0 },
      ];

      const res = generateTrailingValueSeries(flatPoints);
      expect(res.isFlatZero).toBe(true);
      expect(res.markdown).not.toContain("⚠️ **Flat Zero Series**");
    });
  });

  describe("extractTrailingValueSeriesFromState", () => {
    it("extracts series from state pulse history with full and fallback properties", () => {
      const state = {
        pulse: {
          history: [
            {
              pulse_id: "p-hist-1",
              value: 4,
              outcome: "success",
              closed_at: "2026-09-01T10:00:00Z",
            },
            { id: "p-hist-2", value: 2, outcome: "progress", at: "2026-09-01T10:05:00Z" },
            { other_field: "ignored" },
            null,
            "invalid",
          ],
        },
      };

      const res = extractTrailingValueSeriesFromState(state);
      expect(res.points.length).toBe(3);
      expect(res.points[0]?.pulseId).toBe("p-hist-1");
      expect(res.points[0]?.value).toBe(4);
      expect(res.points[1]?.pulseId).toBe("p-hist-2");
      expect(res.points[1]?.timestamp).toBe("2026-09-01T10:05:00Z");
      expect(res.points[2]?.pulseId).toBe("pulse");
      expect(res.points[2]?.value).toBe(0);
      expect(res.points[2]?.outcome).toBe("quiescent");
    });

    it("extracts series from state pulse last record when history is absent", () => {
      const state = {
        pulse: {
          last: {
            pulse_id: "p-last-1",
            value: 8,
            outcome: "completed",
            closed_at: "2026-09-01T11:00:00Z",
          },
        },
      };

      const res = extractTrailingValueSeriesFromState(state);
      expect(res.points.length).toBe(1);
      expect(res.points[0]?.pulseId).toBe("p-last-1");
      expect(res.points[0]?.value).toBe(8);

      const stateLastDefault = {
        pulse: {
          last: {},
        },
      };
      const resDefault = extractTrailingValueSeriesFromState(stateLastDefault);
      expect(resDefault.points[0]?.pulseId).toBe("pulse-last");
      expect(resDefault.points[0]?.value).toBe(0);
    });

    it("handles missing or invalid pulse state cleanly", () => {
      expect(extractTrailingValueSeriesFromState({}).points).toEqual([]);
      expect(extractTrailingValueSeriesFromState({ pulse: null }).points).toEqual([]);
    });
  });

  describe("extractTrailingValueSeriesFromEvents & formatRawValueSeries", () => {
    it("extracts series from mind-pulse-closed event stream", () => {
      const events: Record<string, unknown>[] = [
        {
          kind: "mind-pulse-closed",
          payload: { pulse_id: "ev-1", value: 3, outcome: "success" },
          timestamp: "2026-09-01T12:00:00Z",
        },
        {
          kind: "mind-pulse-closed",
          payload: null,
        },
        {
          kind: "unrelated-event",
          payload: { value: 100 },
        },
      ];

      const res = extractTrailingValueSeriesFromEvents(events);
      expect(res.points.length).toBe(2);
      expect(res.points[0]?.pulseId).toBe("ev-1");
      expect(res.points[0]?.value).toBe(3);
      expect(res.points[1]?.pulseId).toBe("pulse");
      expect(res.points[1]?.value).toBe(0);
    });

    it("formats raw numeric arrays into bracketed string format", () => {
      expect(formatRawValueSeries([1, 2, 3])).toBe("[1, 2, 3]");
      expect(formatRawValueSeries([])).toBe("[]");
    });
  });
});
