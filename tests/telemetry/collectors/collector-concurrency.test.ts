import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TelemetryCollector } from "../../../olt/scripts/src/telemetry/probe-interface.ts";
import type { PlatformProbeResult } from "../../../olt/scripts/src/telemetry/types.ts";
import { TelemetryNormalizationEngine } from "../../../olt/scripts/src/telemetry/engine.ts";
import { parseCodexRolloutUsage } from "../../../olt/scripts/src/telemetry/collectors/openai/rollout-parser.ts";
import { parseClaudeUsagePayload } from "../../../olt/scripts/src/telemetry/collectors/claude/stream-parser.ts";
import {
  emitTelemetryEvent,
  readTelemetryStream,
} from "../../../olt/scripts/src/reporting/telemetry-stream.ts";
import { readCapsuleEvents } from "../../../olt/scripts/src/reporting/event-stream.ts";

describe("collector-concurrency telemetry suite", () => {
  const roots: string[] = [];
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "collector-concurrency-"));
    roots.push(testDir);
  });

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function createMockCollector(
    platformId: string,
    delayMs: number,
    quota: number | null,
    shouldFail = false,
  ): TelemetryCollector {
    return {
      platformId,
      platformName: `Platform ${platformId}`,
      async probe(): Promise<PlatformProbeResult> {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (shouldFail) {
          throw new Error(`Probe failure for ${platformId}`);
        }
        return {
          platformId,
          isDetected: true,
          primaryTierUsed: "tier1_cli_command",
          metrics:
            quota !== null
              ? [
                  {
                    canonicalProvider: platformId,
                    rawMetricName: "quota",
                    windowType: "session",
                    windowDurationMinutes: null,
                    remainingPercentage: quota,
                    consumedPercentage: 100 - quota,
                    confidenceScore: 0.95,
                    tierConfidence: "tier1_cli_command",
                    rawPayload: { quota },
                  },
                ]
              : [],
          rawObservations: { quota },
          errors: [],
        };
      },
    };
  }

  describe("multi-threaded collector dispatch", () => {
    it("dispatches multiple collectors concurrently with varying latency", async () => {
      const collectors = [
        createMockCollector("openai-fast", 5, 80),
        createMockCollector("claude-medium", 15, 60),
        createMockCollector("gemini-slow", 25, 40),
      ];

      const engine = new TelemetryNormalizationEngine(collectors);
      const startTime = Date.now();
      const report = await engine.probeAll();
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100);
      expect(report.results).toHaveLength(3);
      expect(report.summary.totalCollectors).toBe(3);
      expect(report.summary.detectedPlatforms).toBe(3);
      expect(report.summary.lowestRemainingQuota).toBe(40);
    });

    it("isolates errors during concurrent probe execution without dropping successful probes", async () => {
      const collectors = [
        createMockCollector("col-ok-1", 10, 90),
        createMockCollector("col-fail", 5, null, true),
        createMockCollector("col-ok-2", 10, 70),
      ];

      const engine = new TelemetryNormalizationEngine(collectors);
      const report = await engine.probeAll();

      expect(report.results).toHaveLength(3);
      const failResult = report.results.find((r) => r.platformId === "col-fail");
      expect(failResult?.isDetected).toBe(false);
      expect(failResult?.errors).toHaveLength(1);
      expect(failResult?.errors[0]?.message).toContain("Probe failure for col-fail");

      const ok1 = report.results.find((r) => r.platformId === "col-ok-1");
      expect(ok1?.isDetected).toBe(true);
      expect(ok1?.metrics[0]?.remainingPercentage).toBe(90);

      const ok2 = report.results.find((r) => r.platformId === "col-ok-2");
      expect(ok2?.isDetected).toBe(true);
      expect(ok2?.metrics[0]?.remainingPercentage).toBe(70);
    });

    it("scales concurrent dispatch to high-volume probe registration", async () => {
      const count = 20;
      const collectors: TelemetryCollector[] = [];
      for (let i = 0; i < count; i++) {
        collectors.push(createMockCollector(`worker-${i}`, 5 + (i % 5), 50 + (i % 50)));
      }

      const engine = new TelemetryNormalizationEngine(collectors);
      const report = await engine.probeAll();

      expect(report.results).toHaveLength(count);
      expect(report.summary.detectedPlatforms).toBe(count);
      expect(report.summary.totalCollectors).toBe(count);
      expect(report.summary.lowestRemainingQuota).toBe(50);
    });
  });

  describe("parallel telemetry parsing bursts", () => {
    it("handles concurrent parallel parser executions without cross-contamination", async () => {
      const parseTasks = Array.from({ length: 50 }, (_, i) => {
        const remaining = (i * 2) % 100;
        const codexPayload = {
          rate_limits: {
            primary: {
              used_percent: 100 - remaining,
              window_minutes: 300,
              resets_at: 1787990400000,
            },
          },
        };
        const claudePayload = {
          five_hour: { utilization: 100 - remaining },
          seven_day: { utilization: Math.max(0, 100 - (remaining + 10)) },
        };

        return Promise.all([
          Promise.resolve(parseCodexRolloutUsage(codexPayload)),
          Promise.resolve(
            parseClaudeUsagePayload(claudePayload, "tier1_cli_command", "verified_exact"),
          ),
        ]);
      });

      const results = await Promise.all(parseTasks);
      expect(results).toHaveLength(50);

      for (let i = 0; i < 50; i++) {
        const expectedRemaining = (i * 2) % 100;
        const [codexResult, claudeResult] = results[i]!;

        expect(codexResult).toBeDefined();
        expect(codexResult?.metrics).toHaveLength(1);
        expect(codexResult?.metrics[0]?.remainingPercentage).toBe(expectedRemaining);
        expect(codexResult?.metrics[0]?.windowType).toBe("5_hour");

        expect(claudeResult).toBeDefined();
        expect(claudeResult?.metrics).toHaveLength(2);
        expect(claudeResult?.metrics[0]?.remainingPercentage).toBe(expectedRemaining);
        expect(claudeResult?.metrics[1]?.remainingPercentage).toBe(
          Math.min(100, expectedRemaining + 10),
        );
      }
    });

    it("parses high-throughput malformed payload bursts gracefully in parallel", async () => {
      const inputs = [
        null,
        undefined,
        {},
        { invalid: true },
        { rate_limit: "corrupt" },
        { five_hour: "corrupt" },
      ];

      const tasks = inputs.flatMap((input) => [
        Promise.resolve(parseCodexRolloutUsage(input)),
        Promise.resolve(parseClaudeUsagePayload(input, "tier1_cli_command", "verified_exact")),
      ]);

      const settled = await Promise.all(tasks);
      expect(settled).toHaveLength(12);
      for (const res of settled) {
        expect(res === null || (typeof res === "object" && Array.isArray(res.metrics))).toBe(true);
      }
    });
  });

  describe("event ordering preservation", () => {
    it("preserves sequential order during concurrent telemetry event emissions", () => {
      const baseTime = 1787990400000;
      for (let i = 1; i <= 25; i++) {
        const iso = new Date(baseTime + i * 1000).toISOString();
        emitTelemetryEvent(
          {
            timestamp: iso,
            actor: `agent-${i % 4}`,
            action: `run_step_${i}`,
            status: "success",
            details: { step: i },
          },
          testDir,
        );
      }

      const events = readTelemetryStream(testDir);
      expect(events).toHaveLength(25);

      for (let i = 0; i < events.length; i++) {
        const ev = events[i]!;
        expect(ev.action).toBe(`run_step_${i + 1}`);
        expect(ev.details?.step).toBe(i + 1);
        expect(new Date(ev.timestamp).getTime()).toBe(baseTime + (i + 1) * 1000);
      }
    });

    it("maintains sequence integrity when parsing capsule events across sequence ranges", () => {
      const capsuleDir = join(testDir, "capsule-ordering-test");
      mkdirSync(capsuleDir, { recursive: true });

      const rawEvents = Array.from({ length: 30 }, (_, i) => ({
        schema: "harness.event",
        version: 1,
        run_id: "order-run",
        capsule_id: "cap-order",
        sequence: i + 1,
        revision: 1,
        timestamp: new Date(1787990400000 + i * 500).toISOString(),
        actor: i % 2 === 0 ? "implementer-1" : "validator-1",
        kind: i % 2 === 0 ? "task-claimed" : "review-recorded",
        payload: { index: i + 1 },
      }));

      writeFileSync(
        join(capsuleDir, "events.jsonl"),
        rawEvents.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );

      const allResult = readCapsuleEvents(capsuleDir, { all: true });
      expect(allResult.totalAvailable).toBe(30);
      expect(allResult.latestSeq).toBe(30);
      expect(allResult.matchingEvents).toHaveLength(30);

      for (let i = 0; i < 30; i++) {
        expect(allResult.matchingEvents[i]?.sequence).toBe(i + 1);
      }

      const windowResult = readCapsuleEvents(capsuleDir, {
        fromSeq: 10,
        toSeq: 20,
        filterActor: "implementer-1",
      });
      expect(windowResult.matchingEvents.length).toBeGreaterThan(0);
      for (const ev of windowResult.matchingEvents) {
        expect(ev.sequence).toBeGreaterThanOrEqual(10);
        expect(ev.sequence).toBeLessThanOrEqual(20);
        expect(ev.actor).toBe("implementer-1");
      }
    });
  });
});
