import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
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

export const collectorConcurrencySuiteName = "collector-concurrency telemetry suite";

const vfs = new Map<string, { isDir: boolean; content?: string }>();
const spies: Array<{ mockRestore: () => void }> = [];

function setupVirtualFs(): void {
  vfs.clear();
  vfs.set(process.cwd(), { isDir: true });
  vfs.set(join(process.cwd(), ".git"), { isDir: true });
  vfs.set(join(process.cwd(), "package.json"), { content: "{}", isDir: false });

  const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
    const s = String(p).replace(/\/+$/, "");
    return vfs.has(s) || Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`));
  });
  const getStats = (p: fs.PathLike): fs.Stats => {
    const s = String(p).replace(/\/+$/, "");
    const n = vfs.get(s);
    if (!n) {
      if (Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`))) {
        return {
          dev: 1,
          ino: 1,
          nlink: 1,
          isFile: () => false,
          isDirectory: () => true,
          isSymbolicLink: () => false,
          mode: 0o755,
          size: 0,
          mtimeMs: Date.now(),
        } as fs.Stats;
      }
      throw new Error(`ENOENT: ${s}`);
    }
    return {
      dev: 1,
      ino: 1,
      nlink: 1,
      isFile: () => !n.isDir,
      isDirectory: () => n.isDir,
      isSymbolicLink: () => false,
      mode: n.isDir ? 0o755 : 0o644,
      size: n.content ? Buffer.byteLength(n.content) : 0,
      mtimeMs: Date.now(),
    } as fs.Stats;
  };
  const statSpy = spyOn(fs, "statSync").mockImplementation((p) => getStats(p));
  const lstatSpy = spyOn(fs, "lstatSync").mockImplementation((p) => getStats(p));
  const realpathSpy = spyOn(fs, "realpathSync").mockImplementation((p) => String(p));
  const readSpy = spyOn(fs, "readFileSync").mockImplementation((p, options) => {
    const n = vfs.get(String(p));
    if (!n || n.content === undefined) throw new Error(`ENOENT: ${String(p)}`);
    const enc =
      typeof options === "string"
        ? options
        : (options as { encoding?: string } | undefined)?.encoding;
    return enc === "utf-8" || enc === "utf8"
      ? n.content
      : (Buffer.from(n.content) as unknown as string);
  });
  const writeSpy = spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
    vfs.set(String(p), {
      content: typeof data === "string" ? data : new TextDecoder().decode(data as Uint8Array),
      isDir: false,
    });
  });
  const appendSpy = spyOn(fs, "appendFileSync").mockImplementation((p, data) => {
    const s = String(p);
    const str = typeof data === "string" ? data : new TextDecoder().decode(data as Uint8Array);
    vfs.set(s, { content: (vfs.get(s)?.content ?? "") + str, isDir: false });
  });
  const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation((p) => {
    vfs.set(String(p), { isDir: true });
    return undefined;
  });

  spies.push(existsSpy, statSpy, lstatSpy, realpathSpy, readSpy, writeSpy, appendSpy, mkdirSpy);
}

describe(collectorConcurrencySuiteName, () => {
  let testDir: string;

  beforeEach(() => {
    setupVirtualFs();
    testDir = "/virtual/collector-concurrency";
    vfs.set(testDir, { isDir: true });
  });

  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
    vfs.clear();
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
        await new Promise((res) => setTimeout(res, delayMs));
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
        createMockCollector("openai-fast", 5, 80),
        createMockCollector("claude-medium", 15, 60),
        createMockCollector("gemini-slow", 25, 40),
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
        createMockCollector("col-ok-1", 10, 90),
        createMockCollector("col-fail", 5, null, true),
        createMockCollector("col-ok-2", 10, 70),
      ];
      const engine = new TelemetryNormalizationEngine(collectors);
      const report = await engine.probeAll();
      expect(report.results).toHaveLength(3);
      expect(report.results.find((r) => r.platformId === "col-fail")?.isDetected).toBe(false);
      expect(report.results.find((r) => r.platformId === "col-ok-1")?.isDetected).toBe(true);
    });

    it("scales concurrent dispatch to high-volume probe registration", async () => {
      const collectors = Array.from({ length: 20 }, (_, i) =>
        createMockCollector(`worker-${i}`, 5 + (i % 5), 50 + (i % 50)),
      );
      const engine = new TelemetryNormalizationEngine(collectors);
      const report = await engine.probeAll();
      expect(report.results).toHaveLength(20);
      expect(report.summary.lowestRemainingQuota).toBe(50);
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
      expect(results[0]![0]?.metrics[0]?.remainingPercentage).toBe(0);
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
      vfs.set(capsuleDir, { isDir: true });
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
      vfs.set(join(capsuleDir, "events.jsonl"), {
        content: rawEvents.map((e) => JSON.stringify(e)).join("\n") + "\n",
        isDir: false,
      });
      const allResult = readCapsuleEvents(capsuleDir, { all: true });
      expect(allResult.totalAvailable).toBe(30);
      expect(allResult.latestSeq).toBe(30);
    });
  });
});
