import { describe, expect, it } from "bun:test";
import {
  TelemetryNormalizationEngine,
  renderProgressBar,
  formatTierBadge,
} from "../../../olt/scripts/src/telemetry/engine.ts";
import type { TelemetryCollector } from "../../../olt/scripts/src/telemetry/probe-interface.ts";
import type { PlatformProbeResult } from "../../../olt/scripts/src/telemetry/types.ts";

describe("TelemetryNormalizationEngine", () => {
  it("probes registered collectors in parallel and computes summary statistics", async () => {
    const mockCollector1: TelemetryCollector = {
      platformId: "mock1",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "mock1",
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics: [
          {
            rawMetricName: "quota",
            canonicalProvider: "mock",
            windowType: "session",
            remainingPercentage: 85,
            sourceTier: "tier1_cli_command",
            confidence: "verified_exact",
            rawPayload: {},
          },
        ],
        rawObservations: { key: "val" },
        errors: [],
      }),
    };

    const mockCollector2: TelemetryCollector = {
      platformId: "mock2",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "mock2",
        isDetected: true,
        primaryTierUsed: "tier2_local_storage",
        metrics: [
          {
            rawMetricName: "usage",
            canonicalProvider: "mock",
            windowType: "monthly",
            remainingPercentage: 15,
            sourceTier: "tier2_local_storage",
            confidence: "inferred_metric",
            rawPayload: {},
          },
        ],
        rawObservations: {},
        errors: [],
      }),
    };

    const mockCollector3: TelemetryCollector = {
      platformId: "mock3",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "mock3",
        isDetected: false,
        primaryTierUsed: null,
        metrics: [],
        rawObservations: {},
        errors: [new Error("Probe failed")],
      }),
    };

    const engine = new TelemetryNormalizationEngine([
      mockCollector1,
      mockCollector2,
      mockCollector3,
    ]);

    const report = await engine.probeAll();

    expect(report.results.length).toBe(3);
    expect(report.summary.totalCollectors).toBe(3);
    expect(report.summary.detectedPlatforms).toBe(2);
    expect(report.summary.lowestRemainingQuota).toBe(15);
    expect(Array.isArray(report.summary.activeWarnings)).toBe(true);
    expect((report.summary.activeWarnings as string[]).length).toBeGreaterThan(0);
  });

  it("handles throwing collectors gracefully without failing the overall probe", async () => {
    const throwingCollector: TelemetryCollector = {
      platformId: "buggy",
      probe: async () => {
        throw new Error("Unexpected crash");
      },
    };

    const engine = new TelemetryNormalizationEngine([throwingCollector]);
    const report = await engine.probeAll();

    expect(report.results.length).toBe(1);
    expect(report.results[0]!.isDetected).toBe(false);
    expect(report.results[0]!.errors.length).toBe(1);
    expect(report.results[0]!.errors[0]!.message).toBe("Unexpected crash");
  });

  it("formats ASCII report cleanly with tables and progress bars", async () => {
    const mockCollector: TelemetryCollector = {
      platformId: "antigravity",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "antigravity",
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics: [
          {
            rawMetricName: "rpm",
            canonicalProvider: "google",
            windowType: "minute",
            remainingPercentage: 80,
            sourceTier: "tier1_cli_command",
            confidence: "verified_exact",
            rawPayload: { detailed: true },
          },
        ],
        rawObservations: { observed: true },
        errors: [],
      }),
    };

    const engine = new TelemetryNormalizationEngine([mockCollector]);
    const report = await engine.probeAll();
    const ascii = engine.formatAsciiReport(report, true);

    expect(ascii).toContain("CROSS-PLATFORM QUOTA & USAGE TELEMETRY");
    expect(ascii).toContain("antigravity");
    expect(ascii).toContain("Tier 1 (CLI)");
    expect(ascii).toContain("YES (✓)");
    expect(ascii).toContain("Detailed Raw Observations");
  });
});

describe("renderProgressBar and formatTierBadge helpers", () => {
  it("renders progress bars at various thresholds", () => {
    expect(renderProgressBar(100, 10)).toBe("[██████████] 100%");
    expect(renderProgressBar(0, 10)).toBe("[░░░░░░░░░░] 0%");
    expect(renderProgressBar(50, 10)).toBe("[█████░░░░░] 50%");
    expect(renderProgressBar(120, 10)).toBe("[██████████] 100%");
    expect(renderProgressBar(-10, 10)).toBe("[░░░░░░░░░░] 0%");
  });

  it("formats tier badges correctly", () => {
    expect(formatTierBadge("tier1_cli_command")).toBe("Tier 1 (CLI)");
    expect(formatTierBadge("tier2_local_storage")).toBe("Tier 2 (Storage)");
    expect(formatTierBadge("tier3_runtime")).toBe("Tier 3 (Runtime)");
    expect(formatTierBadge(null)).toBe("None");
  });
});
