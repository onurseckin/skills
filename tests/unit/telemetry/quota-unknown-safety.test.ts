import { describe, expect, it } from "bun:test";
import { QuotaCircuitBreaker } from "../../../olt/scripts/src/telemetry/circuit-breaker.ts";
import { TelemetryNormalizationEngine } from "../../../olt/scripts/src/telemetry/engine.ts";
import type { TelemetryCollector } from "../../../olt/scripts/src/telemetry/probe-interface.ts";
import type { PlatformProbeResult } from "../../../olt/scripts/src/telemetry/types.ts";
import {
  ClaudeCollector,
  type CollectorEnvironment,
} from "../../../olt/scripts/src/telemetry/collectors/index.ts";

function unknownOnlyCollector(platformId: string): TelemetryCollector {
  return {
    platformId,
    probe: async (): Promise<PlatformProbeResult> => ({
      platformId,
      isDetected: true,
      primaryTierUsed: "tier3_runtime",
      metrics: [
        {
          rawMetricName: "runtime_environment",
          canonicalProvider: "mock",
          windowType: "session",
          remainingPercentage: null,
          sourceTier: "tier3_runtime",
          confidence: "unknown",
          rawPayload: {},
        },
      ],
      rawObservations: {},
      errors: [],
    }),
  };
}

function realLowQuotaCollector(
  platformId: string,
  remainingPercentage: number,
): TelemetryCollector {
  return {
    platformId,
    probe: async (): Promise<PlatformProbeResult> => ({
      platformId,
      isDetected: true,
      primaryTierUsed: "tier1_cli_command",
      metrics: [
        {
          rawMetricName: "real_quota",
          canonicalProvider: "mock",
          windowType: "session",
          remainingPercentage,
          sourceTier: "tier1_cli_command",
          confidence: "verified_exact",
          rawPayload: {},
        },
      ],
      rawObservations: {},
      errors: [],
    }),
  };
}

describe("unknown quota readings must never masquerade as healthy", () => {
  it("does not compute a lowestRemainingQuota of 100 for a presence-only detection", async () => {
    const engine = new TelemetryNormalizationEngine([unknownOnlyCollector("mock1")]);
    const report = await engine.probeAll();

    expect(report.summary.lowestRemainingQuota).toBeNull();
  });

  it("an unknown-only platform does not block the circuit breaker from freezing when another platform is genuinely low", async () => {
    const engine = new TelemetryNormalizationEngine([
      unknownOnlyCollector("presence_only"),
      realLowQuotaCollector("genuinely_low", 2),
    ]);
    const report = await engine.probeAll();

    const breaker = new QuotaCircuitBreaker();
    const evaluation = breaker.evaluate(report, { thresholdPercentage: 5, activeAgentsCount: 0 });

    expect(evaluation.isTriggered).toBe(true);
    expect(evaluation.lowestRemainingQuota).toBe(2);
  });

  it("does not trigger the circuit breaker purely because a reading is unknown", async () => {
    const engine = new TelemetryNormalizationEngine([
      unknownOnlyCollector("presence_only_a"),
      unknownOnlyCollector("presence_only_b"),
    ]);
    const report = await engine.probeAll();

    const breaker = new QuotaCircuitBreaker();
    const evaluation = breaker.evaluate(report, { thresholdPercentage: 5, activeAgentsCount: 0 });

    expect(evaluation.isTriggered).toBe(false);
    expect(evaluation.lowestRemainingQuota).toBeNull();
  });

  it("renders an unknown metric as Unknown rather than a full progress bar in the ASCII report", async () => {
    const engine = new TelemetryNormalizationEngine([unknownOnlyCollector("presence_only")]);
    const report = await engine.probeAll();
    const ascii = engine.formatAsciiReport(report);

    expect(ascii).toContain("Unknown");
    expect(ascii).not.toContain("[██████] 100%");
  });

  it("a live Claude CLI-presence-only detection (no /usage data) reports unknown, not a fabricated 100%", async () => {
    const env: CollectorEnvironment = {
      fetchClaudeUsage: async () => null,
      exec: async (cmd, args) => {
        if (cmd === "claude" && args[0] === "--version") {
          return { stdout: "claude 2.1.0\n", stderr: "", exitCode: 0 };
        }
        return null;
      },
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.metrics[0]!.remainingPercentage).toBeNull();
    expect(result.metrics[0]!.confidence).toBe("unknown");

    const breaker = new QuotaCircuitBreaker();
    const evaluation = breaker.evaluate(
      { results: [result], timestamp: new Date().toISOString(), summary: {} },
      { thresholdPercentage: 5, activeAgentsCount: 0 },
    );
    expect(evaluation.lowestRemainingQuota).toBeNull();
    expect(evaluation.isTriggered).toBe(false);
  });
});
