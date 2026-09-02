import { describe, expect, it } from "bun:test";
import {
  ActionSpan,
  categorizeHarnessAction,
  computeLatencyPercentiles,
} from "../../olt/scripts/src/reporting/time-telemetry/span.ts";

describe("Time Telemetry ActionSpan & Categorization Coverage", () => {
  describe("categorizeHarnessAction", () => {
    it("matches known command prefixes correctly", () => {
      const cases: readonly (readonly [string, string, number])[] = [
        ["mind:synthesize", "mind", 0],
        ["memory:lookup", "mind", 0],
        ["feedback:record", "mind", 0],
        ["smart-task:plan", "mind", 0],
        ["orchestrate", "plan", 1],
        ["plan:optimize", "plan", 2],
        ["dag:execute", "plan", 2],
        ["queue:process", "queue", 2],
        ["task:run", "task", 3],
        ["run:command", "run", 3],
        ["doctor", "doctor", 1],
        ["doctor:audit", "doctor", 1],
        ["watchdog:ping", "watchdog", 1],
        ["watchdog", "watchdog", 1],
        ["heartbeat", "watchdog", 1],
        ["subagent:spawn", "subagent", 3],
        ["gate:verify", "gate", 3],
        ["workflow:orchestrate", "workflow", 2],
      ];
      for (const [action, cat, tier] of cases) {
        expect(categorizeHarnessAction(action)).toEqual({
          category: cat as never,
          defaultTier: tier,
        });
      }
    });

    it("falls back to keyword scanning or custom category", () => {
      const keywordCases: readonly (readonly [string, string, number])[] = [
        ["  RUN_UNIT_TESTS  ", "gate", 3],
        ["security-gate-check", "gate", 3],
        ["system-watchdog-tick", "watchdog", 1],
        ["cluster-heartbeat-pulse", "watchdog", 1],
        ["worker-subagent-lifecycle", "subagent", 3],
        ["spawn-child-process", "subagent", 3],
        ["unknown-user-action", "custom", 3],
      ];
      for (const [action, cat, tier] of keywordCases) {
        expect(categorizeHarnessAction(action)).toEqual({
          category: cat as never,
          defaultTier: tier,
        });
      }
    });
  });

  describe("computeLatencyPercentiles", () => {
    it("handles empty and single-element arrays", () => {
      expect(computeLatencyPercentiles([])).toEqual({
        count: 0,
        minMs: 0,
        maxMs: 0,
        meanMs: 0,
        p50Ms: 0,
        p90Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
      });

      const single = computeLatencyPercentiles([42]);
      expect(single.count).toBe(1);
      expect(single.minMs).toBe(42);
      expect(single.maxMs).toBe(42);
      expect(single.meanMs).toBe(42);
      expect(single.p50Ms).toBe(42);
      expect(single.p99Ms).toBe(42);
    });

    it("computes accurate percentiles for multi-element collections", () => {
      const durations = [100, 20, 50, 80, 10, 30, 90, 40, 70, 60];
      const res = computeLatencyPercentiles(durations);
      expect(res.count).toBe(10);
      expect(res.minMs).toBe(10);
      expect(res.maxMs).toBe(100);
      expect(res.meanMs).toBe(55);
      expect(res.p50Ms).toBe(50);
      expect(res.p90Ms).toBe(90);
      expect(res.p95Ms).toBe(100);
      expect(res.p99Ms).toBe(100);
    });
  });

  describe("ActionSpan Lifecycle & SubSteps", () => {
    it("initializes default properties and records expected fields", () => {
      const span = new ActionSpan("task:build", "worker-1");
      expect(span.actionId).toBeDefined();
      expect(span.actionName).toBe("task:build");
      expect(span.actor).toBe("worker-1");
      expect(span.category).toBe("task");
      expect(span.tier).toBe(3);
      expect(span.status).toBe("running");
      expect(span.driftMs).toBeUndefined();
      expect(span.finishedAt).toBeUndefined();
      expect(span.durationMs).toBeUndefined();
      expect(span.durationFormatted).toBeUndefined();
      expect(span.error).toBeUndefined();
      expect(span.metadata).toEqual({});
      expect(span.subSteps).toEqual([]);

      const initialRecord = span.toRecord();
      expect(initialRecord.subSteps).toBeUndefined();
      expect(initialRecord.metadata).toBeUndefined();
    });

    it("supports custom category, tier, drift calculation, and initial metadata", () => {
      const started = 1700000005000;
      const expected = 1700000000000;
      const span = new ActionSpan("custom:action", "coordinator", {
        category: "plan",
        tier: 1,
        startedAt: started,
        timezone: "UTC",
        expectedStartMs: expected,
        metadata: { env: "prod", retries: 2 },
      });

      expect(span.category).toBe("plan");
      expect(span.tier).toBe(1);
      expect(span.driftMs).toBe(5000);
      expect(span.timezone).toBe("UTC");
      expect(span.metadata).toEqual({ env: "prod", retries: 2 });
    });

    it("manages sub-step progression with auto-finish on start and finishSubStep no-op", () => {
      const span = new ActionSpan("mind:reason", "agent-mind");

      span.finishSubStep("success");
      expect(span.subSteps.length).toBe(0);

      span.startSubStep("step-1", { stepIdx: 1 });
      span.startSubStep("step-2");

      expect(span.subSteps.length).toBe(1);
      expect(span.subSteps[0]?.name).toBe("step-1");
      expect(span.subSteps[0]?.status).toBe("success");
      expect(typeof span.subSteps[0]?.durationMs).toBe("number");
      expect(span.subSteps[0]?.details).toEqual({ stepIdx: 1 });

      span.finishSubStep("success", { outcome: "ok" });
      expect(span.subSteps.length).toBe(2);
      expect(span.subSteps[1]?.name).toBe("step-2");
      expect(typeof span.subSteps[1]?.durationMs).toBe("number");
      expect(span.subSteps[1]?.details).toEqual({ outcome: "ok" });
    });

    it("handles explicit sub-step timestamps and detail merging", () => {
      const span = new ActionSpan("dag:resolve", "worker-1", {
        startedAt: "2026-09-01T10:00:00.000Z",
      });

      span.startSubStep("step-with-details", { a: 1 }, "2026-09-01T10:00:01.000Z");
      span.finishSubStep("success", { b: 2 }, "2026-09-01T10:00:03.000Z");

      expect(span.subSteps.length).toBe(1);
      expect(span.subSteps[0]?.name).toBe("step-with-details");
      expect(span.subSteps[0]?.durationMs).toBe(2000);
      expect(span.subSteps[0]?.details).toEqual({ a: 1, b: 2 });
    });

    it("handles finish with auto-finishing open sub-step and metadata merge", () => {
      const span = new ActionSpan("dag:orchestrate", "lead-agent", {
        startedAt: "2026-09-01T12:00:00.000Z",
        metadata: { initial: true },
      });

      span.startSubStep("resolve-nodes", { count: 5 }, "2026-09-01T12:00:01.000Z");
      const record = span.finish("success", { completedNodes: 5 }, "2026-09-01T12:00:10.000Z");

      expect(span.status).toBe("success");
      expect(span.durationMs).toBe(10000);
      expect(span.durationFormatted).toBeDefined();
      expect(span.subSteps.length).toBe(1);
      expect(span.subSteps[0]?.status).toBe("success");
      expect(record.metadata).toEqual({ initial: true, completedNodes: 5 });
      expect(record.subSteps?.length).toBe(1);
    });

    it("handles fail with string error and Error instances", () => {
      const spanStr = new ActionSpan("queue:poll", "consumer", {
        startedAt: "2026-09-01T14:00:00.000Z",
      });
      const recStr = spanStr.fail("Connection reset", { attempt: 1 }, "2026-09-01T14:00:02.000Z");
      expect(spanStr.status).toBe("error");
      expect(spanStr.error).toBe("Connection reset");
      expect(recStr.error).toBe("Connection reset");
      expect(recStr.metadata).toEqual({ attempt: 1, error: "Connection reset" });

      const spanErr = new ActionSpan("run:command", "worker", {
        startedAt: "2026-09-01T14:00:00.000Z",
      });
      const recErr = spanErr.fail(
        new Error("Timeout expired"),
        undefined,
        "2026-09-01T14:00:05.000Z",
      );
      expect(spanErr.status).toBe("error");
      expect(spanErr.error).toBe("Timeout expired");
      expect(recErr.error).toBe("Timeout expired");
      expect(recErr.metadata).toEqual({ error: "Timeout expired" });
    });
  });
});
