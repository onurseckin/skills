import { describe, expect, it } from "bun:test";
import {
  normalizeReactiveTrigger,
  resolveTimestampMs,
} from "../../../olt/scripts/src/watchdog/autonomic-watchdog/reactive-dispatcher.ts";

describe("ReactiveDispatcher & Trigger Normalization", () => {
  describe("resolveTimestampMs", () => {
    it("resolves numbers, Dates, ISO strings and falls back to now", () => {
      expect(resolveTimestampMs(1700000000000)).toBe(1700000000000);

      const d = new Date("2026-08-20T10:00:00.000Z");
      expect(resolveTimestampMs(d)).toBe(d.getTime());

      const iso = "2026-08-20T11:00:00.000Z";
      expect(resolveTimestampMs(iso)).toBe(Date.parse(iso));

      expect(resolveTimestampMs("invalid-date")).toBeGreaterThan(0);
      expect(resolveTimestampMs(undefined)).toBeGreaterThan(0);
    });
  });

  describe("normalizeReactiveTrigger", () => {
    it("normalizes string triggers into reactive event objects", () => {
      const { normalized, resolvedMs } = normalizeReactiveTrigger(
        "subagent_progress",
        1700000000000,
      );
      expect(resolvedMs).toBe(1700000000000);
      expect(normalized.type).toBe("subagent_progress");
      expect(normalized.timestamp).toBe(new Date(1700000000000).toISOString());
    });

    it("normalizes object triggers preserving agentId, taskId, payload, and custom timestamp", () => {
      const trigger = {
        type: "lease_released",
        source: "agent_runner",
        taskId: "task-100",
        agentId: "agent-200",
        payload: { success: true },
        timestamp: "2026-08-20T09:00:00.000Z",
      };

      const { normalized } = normalizeReactiveTrigger(trigger, 1700000000000);
      expect(normalized.type).toBe("lease_released");
      expect(normalized.source).toBe("agent_runner");
      expect(normalized.taskId).toBe("task-100");
      expect(normalized.agentId).toBe("agent-200");
      expect(normalized.timestamp).toBe("2026-08-20T09:00:00.000Z");
      expect(normalized.payload).toEqual({ success: true });
    });

    it("falls back to default reactive_wakeup when trigger is undefined or empty", () => {
      const { normalized } = normalizeReactiveTrigger(undefined, 1700000000000);
      expect(normalized.type).toBe("reactive_wakeup");
      expect(normalized.timestamp).toBe(new Date(1700000000000).toISOString());
    });
  });
});
