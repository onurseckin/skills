import { describe, expect, test } from "bun:test";
import { checkQuotaHealth } from "../../../olt/scripts/src/reporting/doctor/index.ts";
import type { UnifiedTelemetryReport } from "../../../olt/scripts/src/telemetry/types.ts";

describe("Doctor Quota Health Engine Diagnostics", () => {
  function createMockReport(
    platformId: string,
    quotaPercent: number | null,
  ): UnifiedTelemetryReport {
    return {
      timestamp: new Date().toISOString(),
      results: [
        {
          platformId,
          isDetected: true,
          primaryTierUsed: "tier1_cli_command",
          metrics:
            quotaPercent !== null
              ? [
                  {
                    platformId,
                    canonicalProvider: platformId,
                    rawMetricName: `${platformId}-prod`,
                    remainingPercentage: quotaPercent,
                    remainingFraction: quotaPercent / 100,
                    confidence: "high",
                    sourceTier: "tier1_cli_command",
                    windowType: "session",
                  },
                ]
              : [],
          rawObservations: {},
          errors: [],
        },
      ],
      summary: {
        totalCollectors: 1,
        detectedPlatforms: 1,
        lowestRemainingQuota: quotaPercent,
      },
    };
  }

  test("passes with INFO finding when active host quota is nominal", async () => {
    const report = createMockReport("antigravity", 88.0);
    const result = await checkQuotaHealth({
      host: "antigravity",
      report,
    });

    expect(result.passed).toBe(true);
    expect(result.engine).toBe("checkQuotaHealth");
    expect(result.findings.some((f) => f.code === "QUOTA_NOMINAL_HEALTHY")).toBe(true);
    expect(result.findings.filter((f) => f.severity === "ERROR")).toHaveLength(0);
  });

  test("passes with WARN finding when active host quota is low (<20%)", async () => {
    const report = createMockReport("claude_code", 14.5);
    const result = await checkQuotaHealth({
      host: "claude_code",
      report,
    });

    expect(result.passed).toBe(true);
    const warnFinding = result.findings.find((f) => f.code === "QUOTA_LOW_WARNING");
    expect(warnFinding).toBeDefined();
    expect(warnFinding?.severity).toBe("WARN");
    expect(warnFinding?.message).toContain("running low");
  });

  test("fails with ERROR finding when active host quota is <= 10%", async () => {
    const report = createMockReport("cursor", 5.2);
    const result = await checkQuotaHealth({
      host: "cursor",
      report,
    });

    expect(result.passed).toBe(false);
    const errorFinding = result.findings.find((f) => f.code === "QUOTA_CRITICAL_BREAKER_TRIPPED");
    expect(errorFinding).toBeDefined();
    expect(errorFinding?.severity).toBe("ERROR");
    expect(errorFinding?.message).toContain("critically depleted");
  });

  test("passes with INFO finding when quota is unmeasured", async () => {
    const report = createMockReport("antigravity", null);
    const result = await checkQuotaHealth({
      host: "antigravity",
      report,
    });

    expect(result.passed).toBe(true);
    expect(result.findings.some((f) => f.code === "QUOTA_UNKNOWN_UNMEASURED")).toBe(true);
  });

  test("evaluates explicitly provided quota override number", async () => {
    const result = await checkQuotaHealth({
      host: "codex",
      quota: 4.0,
    });

    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.code === "QUOTA_CRITICAL_BREAKER_TRIPPED")).toBe(true);
  });
});
