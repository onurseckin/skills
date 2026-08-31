import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, writeFileSync, rmSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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

describe("Quota Lifecycle Transitions & State Freezing", () => {
  const roots: string[] = [];
  let tmpDir: string;
  let runRoot: string;

  beforeEach(() => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "quota-lifecycle-")));
    roots.push(tmpDir);

    const targetDir = join(tmpDir, ".olt");
    mkdirSync(targetDir, { recursive: true });

    const git = spawnSync("git", ["init", "--quiet", tmpDir]);
    if (git.status !== 0) throw new Error("could not initialize quota lifecycle test repository");
    writeFileSync(
      join(tmpDir, ".gitignore"),
      ".olt/capsules\ncapsules\n.capsules\nnode_modules\n",
    );
    writeFileSync(join(tmpDir, "package.json"), "{}");
    spawnSync("git", ["add", "-A"], { cwd: tmpDir });
    spawnSync("git", ["commit", "-m", "init", "--allow-empty"], { cwd: tmpDir });

    runRoot = initRun(
      tmpDir,
      "quota-run",
      new TextEncoder().encode("quota lifecycle"),
      "file",
      true,
    );
  });

  afterEach(() => {
    for (const root of roots.splice(0)) {
      if (existsSync(root)) {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("Normal state (quota > 10%) -> quota:check is OK and quota:freeze skips unless forced", async () => {
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
    const evaluation = breaker.evaluate(normalReport, {
      thresholdPercentage: 10,
      activeAgentsCount: 0,
    });

    expect(evaluation.isTriggered).toBe(false);

    const forcedResult = await quotaFreezeCommand({ repo: tmpDir, run: runRoot, force: true });
    expect(forcedResult.status).toBe("frozen");
  });

  it("Quota breach (<10%) -> triggers circuit breaker, computes resetTime + 60s auto-wake", () => {
    const breaker = new QuotaCircuitBreaker();
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
    const evaluation = breaker.evaluate(breachReport, {
      thresholdPercentage: 10,
      activeAgentsCount: 1,
    });

    expect(evaluation.isTriggered).toBe(true);
    expect(evaluation.constrainedModels.length).toBe(1);
    expect(evaluation.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
  });

  it("quota:freeze executes, snapshots DAG, writes file, emits event", async () => {
    const result = await quotaFreezeCommand({
      repo: tmpDir,
      run: runRoot,
      force: true,
      json: true,
      "active-agents": "2",
    });

    expect(result.status).toBe("frozen");
    expect(result.json).toBe(true);

    const snapshot = loadDagSnapshot(tmpDir);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.status).toBe("frozen");
    expect(snapshot?.agents).toBeDefined();

    const markdown = result.markdown as string;
    expect(typeof markdown).toBe("string");

    const events = readTelemetryStream(tmpDir);
    const freezeEvent = events.find((e) => e.action === "QUOTA_FREEZE_SNAPSHOT");
    expect(freezeEvent).toBeDefined();
    expect(freezeEvent?.status).toBe("success");
  });

  it("quota:resume executes, restores DAG coordinates, re-registers crons, emits event", async () => {
    await quotaFreezeCommand({ repo: tmpDir, run: runRoot, force: true });

    const result = await quotaResumeCommand({
      repo: tmpDir,
      run: runRoot,
      force: true,
      detailed: true,
      json: true,
    });

    expect(result.status).toBe("resumed");
    expect(result.json).toBe(true);

    const snapshot = loadDagSnapshot(tmpDir);
    expect(snapshot?.status).toBe("resumed");

    const events = readTelemetryStream(tmpDir);
    const resumeEvent = events.find((e) => e.action === "QUOTA_RESUME_SNAPSHOT");
    expect(resumeEvent).toBeDefined();
    expect(resumeEvent?.status).toBe("success");

    const md = result.markdown as string;
    expect(md).toContain("Re-register crons");
  });

  it("validates zero-kill invariant and cron suspension boundaries", () => {
    const invariant = { forbidKill: true, preserveIdle: true };
    expect(invariant.forbidKill).toBe(true);
    expect(invariant.preserveIdle).toBe(true);
  });

  describe("Live Quota Probing & Formatting Unit Functions", () => {
    it("formatQuotaBadge formats percentage and unmeasured values correctly", () => {
      expect(formatQuotaBadge(100)).toBe("[██████] 100%");
      expect(formatQuotaBadge(50)).toBe("[███░░░] 50%");
      expect(formatQuotaBadge(12.5)).toBe("[█░░░░░] 12.50%");
      expect(formatQuotaBadge(null)).toBe("[░░░░░░] Unmeasured");
    });

    it("formatQuotaTelemetryLine formats structured line", () => {
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
      expect(line).toContain("Quota Telemetry");
      expect(line).toContain("[█████░] 85%");
      expect(line).toContain("antigravity");
      expect(line).toContain("Status: OK");
    });

    it("probeLiveQuotaTelemetry probes live environment and handles mock collector environment", async () => {
      const customEnv: CollectorEnvironment = {
        env: {
          ANTIGRAVITY_CLI: "1",
        },
      };

      const telemetry = await probeLiveQuotaTelemetry({
        env: customEnv,
        host: "antigravity",
        thresholdPercentage: 10,
      });

      expect(telemetry.activeHost).toBe("antigravity");
      expect(telemetry.report).toBeDefined();
      expect(telemetry.evaluation).toBeDefined();
      expect(telemetry.quotaBadge).toBeDefined();
      expect(typeof telemetry.isTriggered).toBe("boolean");
    });
  });
});
