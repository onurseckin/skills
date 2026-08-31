import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { managePulseSupervisoryCadence } from "../../../olt/scripts/src/mind/pulsing/index.ts";
import {
  loadDagSnapshot,
  resumeDagSnapshot,
} from "../../../olt/scripts/src/telemetry/snapshot/index.ts";
import type { UnifiedTelemetryReport } from "../../../olt/scripts/src/telemetry/types.ts";

describe("Mind Pulse Quota Freeze & DAG Snapshot Hardwiring", () => {
  const TEST_DIR = join(process.cwd(), "tests-tmp-mind-pulse-freeze");

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  function createLowQuotaReport(): UnifiedTelemetryReport {
    return {
      timestamp: new Date().toISOString(),
      results: [
        {
          platformId: "antigravity",
          isDetected: true,
          primaryTierUsed: "tier1_cli_command",
          metrics: [
            {
              platformId: "antigravity",
              canonicalProvider: "antigravity",
              rawMetricName: "gemini-2.5-flash",
              remainingPercentage: 5.0,
              remainingFraction: 0.05,
              confidence: "high",
              sourceTier: "tier1_cli_command",
              windowType: "session",
              rawPayload: { quotaInfo: { resetTime: "2026-09-01T14:00:00.000Z" } },
            },
          ],
          rawObservations: {},
          errors: [],
        },
      ],
      summary: {
        totalCollectors: 1,
        detectedPlatforms: 1,
        lowestRemainingQuota: 5.0,
      },
    };
  }

  test("captures and persists DAG snapshot upon pulse supervisory freeze", async () => {
    const report = createLowQuotaReport();
    const result = await managePulseSupervisoryCadence({
      runRoot: TEST_DIR,
      repoRoot: TEST_DIR,
      baseIntervalMs: 300_000,
      host: "antigravity",
      cachedReport: report,
      captureSnapshotOnFreeze: true,
    });

    expect(result.shouldFreeze).toBe(true);
    expect(result.snapshotCaptured).toBe(true);
    expect(result.snapshotPath).toBeDefined();

    const loaded = loadDagSnapshot(TEST_DIR);
    expect(loaded).toBeDefined();
    expect(loaded?.status).toBe("frozen");
    expect(loaded?.lowestQuotaObserved).toBe(5.0);
    expect(loaded?.constrainedModels).toContain("gemini-2.5-flash");

    // Test resume workflow
    const resumeResult = await resumeDagSnapshot({
      repoRoot: TEST_DIR,
      runRoot: TEST_DIR,
    });
    expect(resumeResult.resumeDirectives.length).toBeGreaterThan(0);

    const reloaded = loadDagSnapshot(TEST_DIR);
    expect(reloaded?.status).toBe("resumed");
  });
});
