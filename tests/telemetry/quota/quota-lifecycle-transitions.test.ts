import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { quotaFreezeCommand } from "../../../olt/scripts/src/cli/commands/quota-freeze.ts";
import { quotaResumeCommand } from "../../../olt/scripts/src/cli/commands/quota-resume.ts";
import { QuotaCircuitBreaker } from "../../../olt/scripts/src/telemetry/circuit-breaker.ts";
import { loadDagSnapshot } from "../../../olt/scripts/src/telemetry/dag-snapshot.ts";
import { readTelemetryStream } from "../../../olt/scripts/src/reporting/telemetry-stream.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import type { UnifiedTelemetryReport } from "../../../olt/scripts/src/telemetry/types.ts";
import {
  formatQuotaBadge,
  formatQuotaTelemetryLine,
  probeLiveQuotaTelemetry,
  type LifecycleQuotaTelemetry,
} from "../../../olt/scripts/src/workflow/lifecycle/quota-lifecycle.ts";
import type { CollectorEnvironment } from "../../../olt/scripts/src/telemetry/collectors/index.ts";
import { QuotaVirtualFs } from "./vfs-harness.ts";

export const quotaLifecycleTransitionsSuiteName = "Quota Lifecycle Transitions & State Freezing";
const qfs = new QuotaVirtualFs();

describe(quotaLifecycleTransitionsSuiteName, () => {
  let tmpDir: string, runRoot: string;

  beforeEach(() => {
    qfs.setup();
    tmpDir = "/virtual/quota-lifecycle";
    qfs.setFile(tmpDir, "", true);
    qfs.setFile(join(tmpDir, ".olt"), "", true);
    qfs.setFile(join(tmpDir, ".git"), "", true);
    qfs.setFile(join(tmpDir, ".gitignore"), ".olt/capsules\ncapsules\n.capsules\nnode_modules\n");
    qfs.setFile(join(tmpDir, "package.json"), "{}");
    runRoot = initRun(
      tmpDir,
      "quota-run",
      new TextEncoder().encode("quota lifecycle"),
      "file",
      true,
    );
  });

  afterEach(() => {
    qfs.cleanup();
  });

  it("handles normal states, quota breach evaluations, DAG snapshot freezes, and resumes", async () => {
    const breaker = new QuotaCircuitBreaker();
    const normalReport: UnifiedTelemetryReport = {
      timestamp: new Date().toISOString(),
      results: [
        {
          platformId: "antigravity",
          isDetected: true,
          primaryTierUsed: "tier1_cli_command",
          errors: [],
          rawObservations: {},
          metrics: [
            {
              rawMetricName: "requests",
              canonicalProvider: "antigravity",
              windowType: "sliding",
              remainingPercentage: 20,
              sourceTier: "tier1_cli_command",
              confidence: "verified_exact",
              rawPayload: { remainingPercentage: 20, requestsRemaining: 100 },
            },
          ],
        },
      ],
      summary: {},
    };
    const evalNormal = breaker.evaluate(normalReport, {
      thresholdPercentage: 10,
      activeAgentsCount: 0,
    });
    expect(evalNormal.isTriggered).toBe(false);

    const forcedResult = await quotaFreezeCommand({ repo: tmpDir, run: runRoot, force: true });
    expect(forcedResult.status).toBe("frozen");

    const breachReport: UnifiedTelemetryReport = {
      timestamp: "2024-01-01T10:00:00Z",
      results: [
        {
          platformId: "antigravity",
          isDetected: true,
          primaryTierUsed: "tier1_cli_command",
          errors: [],
          rawObservations: {},
          metrics: [
            {
              rawMetricName: "requests",
              canonicalProvider: "antigravity",
              windowType: "sliding",
              remainingPercentage: 5,
              sourceTier: "tier1_cli_command",
              confidence: "verified_exact",
              rawPayload: {
                remainingPercentage: 5,
                requestsRemaining: 100,
                resetTime: "2024-01-01T12:00:00Z",
              },
            },
          ],
        },
      ],
      summary: {},
    };
    const evalBreach = breaker.evaluate(breachReport, {
      thresholdPercentage: 10,
      activeAgentsCount: 1,
    });
    expect(
      evalBreach.isTriggered &&
        evalBreach.constrainedModels.length === 1 &&
        evalBreach.status === "QUOTA_EXHAUSTED_CIRCUIT_BROKEN",
    ).toBe(true);

    const freezeRes = await quotaFreezeCommand({
      repo: tmpDir,
      run: runRoot,
      force: true,
      json: true,
      "active-agents": "2",
    });
    const snapshot = loadDagSnapshot(tmpDir);
    const events = readTelemetryStream(tmpDir);
    expect(
      freezeRes.status === "frozen" &&
        freezeRes.json === true &&
        snapshot?.status === "frozen" &&
        snapshot?.agents !== undefined,
    ).toBe(true);
    expect(events.find((e) => e.action === "QUOTA_FREEZE_SNAPSHOT")?.status).toBe("success");

    const resumeRes = await quotaResumeCommand({
      repo: tmpDir,
      run: runRoot,
      force: true,
      detailed: true,
      json: true,
    });
    expect(
      resumeRes.status === "resumed" &&
        resumeRes.json === true &&
        loadDagSnapshot(tmpDir)?.status === "resumed",
    ).toBe(true);
    expect(
      readTelemetryStream(tmpDir).find((e) => e.action === "QUOTA_RESUME_SNAPSHOT")?.status,
    ).toBe("success");
    expect((resumeRes.markdown as string).includes("Re-register crons")).toBe(true);
  });

  it("validates formatting helpers and live environment probing", async () => {
    expect(formatQuotaBadge(100)).toBe("[██████] 100%");
    expect(formatQuotaBadge(50)).toBe("[███░░░] 50%");
    expect(formatQuotaBadge(12.5)).toBe("[█░░░░░] 12.50%");
    expect(formatQuotaBadge(null)).toBe("[░░░░░░] Unmeasured");

    const telemetry: LifecycleQuotaTelemetry = {
      report: { timestamp: new Date().toISOString(), results: [], summary: {} },
      evaluation: {
        status: "OK",
        isTriggered: false,
        thresholdPercentage: 10,
        lowestRemainingQuota: 85,
        constrainedModels: [],
        wrapUpDirectives: [],
        autoWakeSchedule: null,
        summary: "healthy",
        evaluatedAt: new Date().toISOString(),
      },
      activeHost: "antigravity",
      quotaBadge: "[█████░] 85%",
      lowestQuotaPercentage: 85,
      isTriggered: false,
      status: "OK",
    };
    const line = formatQuotaTelemetryLine(telemetry);
    expect(line.includes("Quota Telemetry") && line.includes("[█████░] 85%")).toBe(true);

    const customEnv: CollectorEnvironment = { env: { ANTIGRAVITY_CLI: "1" } };
    const live = await probeLiveQuotaTelemetry({
      env: customEnv,
      host: "antigravity",
      thresholdPercentage: 10,
    });
    expect(
      live.activeHost === "antigravity" &&
        live.report !== undefined &&
        live.evaluation !== undefined,
    ).toBe(true);
  });
});
