import { describe, expect, it } from "bun:test";
import { QuotaCircuitBreaker } from "../../../olt/scripts/src/telemetry/circuit-breaker.ts";
import { TelemetryNormalizationEngine } from "../../../olt/scripts/src/telemetry/engine.ts";
import type { TelemetryCollector } from "../../../olt/scripts/src/telemetry/probe-interface.ts";
import type {
  PlatformProbeResult,
  UnifiedTelemetryReport,
} from "../../../olt/scripts/src/telemetry/types.ts";
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

  it("keeps the exhausted circuit status when a genuinely low observation accompanies an unknown one", async () => {
    const engine = new TelemetryNormalizationEngine([
      unknownOnlyCollector("presence_only"),
      realLowQuotaCollector("genuinely_low", 2),
    ]);
    const report = await engine.probeAll();

    const breaker = new QuotaCircuitBreaker();
    const evaluation = breaker.evaluate(report, { thresholdPercentage: 5, activeAgentsCount: 0 });

    expect(evaluation.isTriggered).toBe(true);
    expect(evaluation.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(evaluation.lowestRemainingQuota).toBe(2);
  });

  it("fails closed with idle directives and safe-window wakeup when every detected reading is unknown", async () => {
    const engine = new TelemetryNormalizationEngine([
      unknownOnlyCollector("presence_only_a"),
      unknownOnlyCollector("presence_only_b"),
    ]);
    const report = await engine.probeAll();

    const breaker = new QuotaCircuitBreaker();
    const evaluation = breaker.evaluate(report, {
      thresholdPercentage: 5,
      activeAgentIds: ["worker-a"],
      now: "2026-08-24T12:00:00.000Z",
    });

    expect(evaluation.status).toBe("QUOTA_UNKNOWN_CIRCUIT_BROKEN");
    expect(evaluation.isTriggered).toBe(true);
    expect(evaluation.lowestRemainingQuota).toBeNull();
    expect(evaluation.wrapUpDirectives).toHaveLength(1);
    expect(evaluation.wrapUpDirectives[0]!.recipient).toBe("worker-a");
    expect(evaluation.wrapUpDirectives[0]!.action).toBe("idle");
    expect(evaluation.autoWakeSchedule?.durationSeconds).toBe(18_060);
    const markdown = QuotaCircuitBreaker.formatMarkdown(evaluation);
    expect(markdown).toContain("QUOTA AVAILABILITY UNAVAILABLE / UNMEASURED");
    expect(markdown).not.toMatch(/healthy|nominal|exhausted/i);
  });

  it("fails closed when a healthy numeric reading is accompanied by an unmeasured observation", async () => {
    const engine = new TelemetryNormalizationEngine([
      realLowQuotaCollector("healthy", 80),
      unknownOnlyCollector("unknown"),
    ]);
    const evaluation = new QuotaCircuitBreaker().evaluate(await engine.probeAll(), {
      thresholdPercentage: 5,
    });

    expect(evaluation.status).toBe("QUOTA_UNKNOWN_CIRCUIT_BROKEN");
    expect(evaluation.isTriggered).toBe(true);
    expect(evaluation.lowestRemainingQuota).toBe(80);
    expect(evaluation.constrainedModels).toHaveLength(0);
    expect(evaluation.autoWakeSchedule).not.toBeNull();
  });

  it("fails closed for empty, undetected, errored, and null-only reports", () => {
    const breaker = new QuotaCircuitBreaker();
    const cases: UnifiedTelemetryReport[] = [
      { timestamp: new Date().toISOString(), results: [], summary: {} },
      {
        timestamp: new Date().toISOString(),
        results: [
          {
            platformId: "undetected",
            isDetected: false,
            primaryTierUsed: null,
            metrics: [],
            rawObservations: {},
            errors: [],
          },
        ],
        summary: {},
      },
      {
        timestamp: new Date().toISOString(),
        results: [
          {
            platformId: "errored",
            isDetected: true,
            primaryTierUsed: null,
            metrics: [],
            rawObservations: {},
            errors: ["probe failed"],
          },
        ],
        summary: {},
      },
      {
        timestamp: new Date().toISOString(),
        results: [
          {
            platformId: "null-only",
            isDetected: true,
            primaryTierUsed: null,
            metrics: [
              {
                rawMetricName: "unmeasured",
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
          },
        ],
        summary: {},
      },
    ];

    for (const report of cases) {
      const evaluation = breaker.evaluate(report);
      expect(evaluation.status).toBe("QUOTA_UNKNOWN_CIRCUIT_BROKEN");
      expect(evaluation.isTriggered).toBe(true);
      expect(evaluation.autoWakeSchedule).not.toBeNull();
    }
  });

  it("uses a finite low summary as lower-bound exhaustion evidence without treating a high summary as healthy", () => {
    const incomplete = (lowestRemainingQuota: number | null): UnifiedTelemetryReport => ({
      timestamp: new Date().toISOString(),
      results: [
        {
          platformId: "errored",
          isDetected: true,
          primaryTierUsed: null,
          metrics: [],
          rawObservations: {},
          errors: ["quota probe unavailable"],
        },
      ],
      summary: { lowestRemainingQuota },
    });
    const breaker = new QuotaCircuitBreaker();

    const low = breaker.evaluate(incomplete(2), { thresholdPercentage: 5 });
    expect(low.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(low.isTriggered).toBe(true);
    expect(low.lowestRemainingQuota).toBe(2);

    const high = breaker.evaluate(incomplete(80), { thresholdPercentage: 5 });
    expect(high.status).toBe("QUOTA_UNKNOWN_CIRCUIT_BROKEN");
    expect(high.isTriggered).toBe(true);
    expect(high.lowestRemainingQuota).toBeNull();

    const nonfinite = breaker.evaluate(incomplete(Number.NaN), { thresholdPercentage: 5 });
    expect(nonfinite.status).toBe("QUOTA_UNKNOWN_CIRCUIT_BROKEN");
    expect(nonfinite.isTriggered).toBe(true);
    expect(nonfinite.lowestRemainingQuota).toBeNull();
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
    expect(evaluation.status).toBe("QUOTA_UNKNOWN_CIRCUIT_BROKEN");
    expect(evaluation.isTriggered).toBe(true);
  });
});
