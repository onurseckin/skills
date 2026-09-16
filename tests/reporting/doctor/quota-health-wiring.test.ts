import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { collectDiagnosticEngines } from "../../../olt/scripts/src/reporting/doctor/diagnostic-collector.ts";
import { runDoctor } from "../../../olt/scripts/src/reporting/doctor/runner.ts";
import {
  probeLiveQuotaTelemetry,
  formatQuotaBadge,
} from "../../../olt/scripts/src/workflow/lifecycle/quota-lifecycle.ts";
import {
  updateCachedTelemetryQuota,
  bootstrapTelemetryQuota,
} from "../../../olt/scripts/src/orchestrator/lifecycle/bootstrap.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { cleanupVirtualReportingFS, setupVirtualReportingFS, tempDir } from "../fixture.ts";

describe("Doctor Quota Health Wiring and Fallback Chains", () => {
  let vfs: ReturnType<typeof setupVirtualReportingFS>;

  beforeEach(() => {
    vfs = setupVirtualReportingFS();
    updateCachedTelemetryQuota(null);
    bootstrapTelemetryQuota();
  });

  afterEach(() => {
    updateCachedTelemetryQuota(null);
    bootstrapTelemetryQuota();
    cleanupVirtualReportingFS();
  });

  test("collectDiagnosticEngines wires checkQuotaHealth for nominal quota", () => {
    const result = collectDiagnosticEngines({
      repoRoot: tempDir("diag-quota-nominal"),
      quota: 85,
      host: "antigravity",
    });

    const quotaResult = result.engineResults.checkQuotaHealth;
    expect(quotaResult).toBeDefined();
    expect(quotaResult.passed).toBe(true);
    expect(quotaResult.findings.length).toBeGreaterThan(0);
    expect(quotaResult.findings[0]?.code).toBe("QUOTA_NOMINAL_HEALTHY");
    expect(quotaResult.findings[0]?.severity).toBe("INFO");

    expect(result.allEngineFindings.some((f) => f.engine === "checkQuotaHealth")).toBe(true);
    expect(result.engineInfoIssues.some((i) => i.includes("checkQuotaHealth"))).toBe(true);
  });

  test("collectDiagnosticEngines wires checkQuotaHealth for low warning quota (< 20%)", () => {
    const result = collectDiagnosticEngines({
      repoRoot: tempDir("diag-quota-warn"),
      quota: 14.5,
      host: "claude-code",
    });

    const quotaResult = result.engineResults.checkQuotaHealth;
    expect(quotaResult).toBeDefined();
    expect(quotaResult.passed).toBe(true);
    expect(quotaResult.findings[0]?.code).toBe("QUOTA_LOW_WARNING");
    expect(quotaResult.findings[0]?.severity).toBe("WARN");

    expect(
      result.engineWarnIssues.some(
        (i) => i.includes("QUOTA_LOW_WARNING") || i.includes("checkQuotaHealth"),
      ),
    ).toBe(true);
  });

  test("collectDiagnosticEngines wires checkQuotaHealth for critical quota (<= 10%)", () => {
    const result = collectDiagnosticEngines({
      repoRoot: tempDir("diag-quota-crit"),
      quota: 4.2,
      host: "codex",
    });

    const quotaResult = result.engineResults.checkQuotaHealth;
    expect(quotaResult).toBeDefined();
    expect(quotaResult.passed).toBe(false);
    expect(quotaResult.findings[0]?.code).toBe("QUOTA_CRITICAL_BREAKER_TRIPPED");
    expect(quotaResult.findings[0]?.severity).toBe("ERROR");

    expect(result.engineErrorIssues.some((i) => i.includes("checkQuotaHealth"))).toBe(true);
  });

  test("collectDiagnosticEngines wires checkQuotaHealth for unmeasured state", () => {
    const result = collectDiagnosticEngines({
      repoRoot: tempDir("diag-quota-unmeasured"),
      quota: null,
      host: "cursor",
    });

    const quotaResult = result.engineResults.checkQuotaHealth;
    expect(quotaResult).toBeDefined();
    expect(quotaResult.passed).toBe(true);
    expect(quotaResult.findings[0]?.code).toBe("QUOTA_UNKNOWN_UNMEASURED");
    expect(quotaResult.findings[0]?.severity).toBe("INFO");
  });

  test("runDoctor populates engine_results.checkQuotaHealth and doctor_findings", async () => {
    const repo = tempDir("harness-doc-quota-run");
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });

    const runRoot = initRun(
      repo,
      "quota-run",
      new TextEncoder().encode("Quota wiring prompt"),
      "file",
      true,
    );

    transact(runRoot, "worker", "set-quota", {}, (state) => {
      state.quota = 78.5;
      state.activeHost = "antigravity";
    });

    const report = await runDoctor(runRoot, { repoRoot: repo, writeScope: [] });
    expect(report.engine_results).toBeDefined();
    const quotaResult = (report.engine_results as Record<string, unknown>).checkQuotaHealth;
    expect(quotaResult).toBeDefined();

    const doctorFindings = report.doctor_findings as readonly { engine: string; code: string }[];
    expect(Array.isArray(doctorFindings)).toBe(true);
    const quotaFinding = doctorFindings.find((f) => f.engine === "checkQuotaHealth");
    expect(quotaFinding).toBeDefined();
    expect(quotaFinding?.code).toBe("QUOTA_NOMINAL_HEALTHY");
  });

  test("probeLiveQuotaTelemetry falls back to readCurrentQuota when live collectors return null", async () => {
    updateCachedTelemetryQuota(65.0);
    bootstrapTelemetryQuota();

    const result = await probeLiveQuotaTelemetry({
      host: "antigravity",
      env: { env: {} },
    });

    expect(result.lowestQuotaPercentage).toBe(65.0);
    expect(result.isTriggered).toBe(false);
    expect(result.status).toBe("OK");
    expect(result.quotaBadge).toContain("65%");
  });

  test("probeLiveQuotaTelemetry falls back to .olt/telemetry.jsonl with corrupt line skipping", async () => {
    const repo = tempDir("telemetry-jsonl-test");
    vfs.mkdirSync(join(repo, ".olt"), { recursive: true });

    const jsonlContent = [
      JSON.stringify({ timestamp: "2026-09-15T10:00:00Z", quotaRemainingPercentage: 55.5 }),
      "{ invalid json line that should be safely skipped",
      JSON.stringify({ timestamp: "2026-09-15T10:01:00Z", quotaRemainingPercentage: null }),
    ].join("\n");

    vfs.writeFileSync(join(repo, ".olt", "telemetry.jsonl"), jsonlContent, "utf-8");

    const result = await probeLiveQuotaTelemetry({
      host: "cursor",
      repoRoot: repo,
      env: { env: {} },
    });

    expect(result.lowestQuotaPercentage).toBe(55.5);
    expect(result.isTriggered).toBe(false);
    expect(result.quotaBadge).toContain("55.50%");
  });

  test("probeLiveQuotaTelemetry falls back to quota-dag-snapshot.json when telemetry.jsonl is absent", async () => {
    const repo = tempDir("snapshot-test");
    const runRoot = join(repo, ".olt", "capsules", "run-snap");
    vfs.mkdirSync(join(runRoot, ".olt"), { recursive: true });

    const snapshotContent = JSON.stringify({
      version: "2",
      repositoryRoot: repo,
      runRoot,
      status: "frozen",
      lowestQuotaObserved: 33.3,
    });

    vfs.writeFileSync(join(runRoot, ".olt", "quota-dag-snapshot.json"), snapshotContent, "utf-8");

    const result = await probeLiveQuotaTelemetry({
      host: "codex",
      repoRoot: repo,
      runRoot,
      env: { env: {} },
    });

    expect(result.lowestQuotaPercentage).toBe(33.3);
    expect(result.isTriggered).toBe(false);
    expect(result.quotaBadge).toContain("33.30%");
  });

  test("probeLiveQuotaTelemetry trips circuit breaker on low fallback quota (<= 10%)", async () => {
    const repo = tempDir("tripped-quota-test");
    vfs.mkdirSync(join(repo, ".olt"), { recursive: true });

    vfs.writeFileSync(
      join(repo, ".olt", "telemetry.jsonl"),
      JSON.stringify({ timestamp: "2026-09-15T12:00:00Z", quotaRemainingPercentage: 6.25 }) + "\n",
      "utf-8",
    );

    const result = await probeLiveQuotaTelemetry({
      host: "claude-code",
      repoRoot: repo,
      env: { env: {} },
    });

    expect(result.lowestQuotaPercentage).toBe(6.25);
    expect(result.isTriggered).toBe(true);
    expect(result.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(result.warning).toContain("Quota circuit breaker triggered");
    expect(result.quotaBadge).toContain("6.25%");
  });

  test("probeLiveQuotaTelemetry produces unmeasured fallback when all internal stores are empty", async () => {
    const emptyRepo = tempDir("empty-quota-repo");

    const result = await probeLiveQuotaTelemetry({
      host: "antigravity",
      repoRoot: emptyRepo,
      env: { env: {} },
    });

    expect(result.lowestQuotaPercentage).toBeNull();
    expect(result.isTriggered).toBe(false);
    expect(result.status).toBe("OK");
    expect(result.quotaBadge).toBe(formatQuotaBadge(null));
    expect(result.quotaBadge).toContain("Unmeasured");
  });
});
