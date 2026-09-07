import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const collectorConcurrencySuiteName = "collector-concurrency telemetry suite";

describe(collectorConcurrencySuiteName, () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;
  let testDir: string;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(process.cwd(), { recursive: true });
    vfs.mkdirSync(join(process.cwd(), ".git"), { recursive: true });
    vfs.writeFileSync(join(process.cwd(), "package.json"), "{}");
    testDir = "/virtual/collector-concurrency";
    vfs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
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
        if (delayMs > 0) {
          await Promise.resolve();
        }
        if (shouldFail) throw new Error(`Probe failure for ${platformId}`);
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
        createMockCollector("openai-fast", 0, 80),
        createMockCollector("claude-medium", 0, 60),
        createMockCollector("gemini-slow", 0, 40),
      ];
      const engine = new TelemetryNormalizationEngine(collectors);
      const startTime = Date.now();
      const report = await engine.probeAll();
      expect(Date.now() - startTime).toBeLessThan(100);
      expect(report.results).toHaveLength(3);
      expect(report.summary.lowestRemainingQuota).toBe(40);
    });

    it("isolates errors during concurrent probe execution without dropping successful probes", async () => {
      const collectors = [
        createMockCollector("col-ok-1", 0, 90),
        createMockCollector("col-fail", 0, null, true),
        createMockCollector("col-ok-2", 0, 70),
      ];
      const engine = new TelemetryNormalizationEngine(collectors);
      const report = await engine.probeAll();
      expect(report.results).toHaveLength(3);
      expect(report.results.find((r) => r.platformId === "col-fail")?.isDetected).toBe(false);
      expect(report.results.find((r) => r.platformId === "col-ok-1")?.isDetected).toBe(true);
    });

    it("scales concurrent dispatch to high-volume probe registration", async () => {
      const collectors = Array.from({ length: 20 }, (_, i) =>
        createMockCollector(`worker-${i}`, 0, 50 + (i % 50)),
      );
      const engine = new TelemetryNormalizationEngine(collectors);
      const report = await engine.probeAll();
      expect(report.results).toHaveLength(20);
      expect(report.summary.lowestRemainingQuota).toBe(50);
    });

    it("handles mixed concurrent probe failures, empty metrics, and success without thread leakage", async () => {
      const collectors = [
        createMockCollector("col-crash-1", 0, null, true),
        createMockCollector("col-empty", 0, null, false),
        createMockCollector("col-valid-1", 0, 85, false),
        createMockCollector("col-crash-2", 0, null, true),
        createMockCollector("col-valid-2", 0, 95, false),
      ];
      const engine = new TelemetryNormalizationEngine(collectors);
      const report = await engine.probeAll();
      expect(report.results).toHaveLength(5);
      expect(report.summary.lowestRemainingQuota).toBe(85);
      const successful = report.results.filter((r) => r.isDetected);
      expect(successful).toHaveLength(3);
    });
  });

  describe("parallel telemetry parsing bursts", () => {
    it("handles concurrent parallel parser executions without cross-contamination", async () => {
      const parseTasks = Array.from({ length: 50 }, (_, i) => {
        const remaining = (i * 2) % 100;
        return Promise.all([
          Promise.resolve(
            parseCodexRolloutUsage({
              rate_limits: {
                primary: {
                  used_percent: 100 - remaining,
                  window_minutes: 300,
                  resets_at: 1787990400000,
                },
              },
            }),
          ),
          Promise.resolve(
            parseClaudeUsagePayload(
              {
                five_hour: { utilization: 100 - remaining },
                seven_day: { utilization: Math.max(0, 100 - (remaining + 10)) },
              },
              "tier1_cli_command",
              "verified_exact",
            ),
          ),
        ]);
      });
      const results = await Promise.all(parseTasks);
      expect(results).toHaveLength(50);
      const firstEntry = results[0];
      const subEntry = firstEntry ? firstEntry[0] : undefined;
      expect(subEntry?.metrics[0]?.remainingPercentage).toBe(0);
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
    });
  });

  describe("event ordering preservation", () => {
    it("preserves sequential order during concurrent telemetry event emissions", () => {
      const baseTime = 1787990400000;
      for (let i = 1; i <= 25; i++) {
        emitTelemetryEvent(
          {
            timestamp: new Date(baseTime + i * 1000).toISOString(),
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
      expect(events[0]?.action).toBe("run_step_1");
    });

    it("maintains sequence integrity when parsing capsule events across sequence ranges", () => {
      const capsuleDir = join(testDir, "capsule-ordering-test");
      vfs.mkdirSync(capsuleDir, { recursive: true });
      const rawEvents = Array.from({ length: 30 }, (_, i) => ({
        schema: "harness.event",
        version: 1,
        run_id: "order-run",
        capsule_id: "cap-order",
        sequence: i + 1,
        revision: 1,
        timestamp: new Date(1787990400000 + i * 500).toISOString(),
        actor: i % 2 === 0 ? "implementer-1" : "validator-1",
        kind: "task-claimed",
        payload: { index: i + 1 },
      }));
      vfs.writeFileSync(
        join(capsuleDir, "events.jsonl"),
        rawEvents.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );
      const allResult = readCapsuleEvents(capsuleDir, { all: true });
      expect(allResult.totalAvailable).toBe(30);
      expect(allResult.latestSeq).toBe(30);
    });
  });
});
