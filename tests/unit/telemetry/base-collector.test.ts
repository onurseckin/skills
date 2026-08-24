import { describe, it, expect } from "bun:test";
import {
  BaseTieredCollector,
  type TierResult,
} from "../../../olt/scripts/src/telemetry/base-collector.ts";
import type {
  ConfidenceLevel,
  NormalizedQuotaMetric,
  PlatformProbeResult,
  TierType,
  UnifiedTelemetryReport,
} from "../../../olt/scripts/src/telemetry/types.ts";
import type { TelemetryCollector } from "../../../olt/scripts/src/telemetry/probe-interface.ts";

class Tier1SuccessCollector extends BaseTieredCollector {
  readonly platformId = "tier1_app";
  protected async probeTier1Cli(): Promise<TierResult | null> {
    return {
      sourceTier: "tier1_cli_command",
      metrics: [
        {
          rawMetricName: "CLI Quota",
          canonicalProvider: "tier1_prov",
          windowType: "sliding_5h",
          remainingPercentage: 88,
          sourceTier: "tier1_cli_command",
          confidence: "verified_exact",
          rawPayload: { cli_raw: true },
        },
      ],
      rawObservations: { cli_version: "1.0.0" },
    };
  }
  protected async probeTier2Storage(): Promise<TierResult | null> {
    throw new Error("Tier 2 should not be called when Tier 1 succeeds");
  }
  protected async probeTier3Runtime(): Promise<TierResult | null> {
    throw new Error("Tier 3 should not be called when Tier 1 succeeds");
  }
}

class Tier2SuccessCollector extends BaseTieredCollector {
  readonly platformId = "tier2_app";
  protected async probeTier1Cli(): Promise<TierResult | null> {
    return null;
  }
  protected async probeTier2Storage(): Promise<TierResult | null> {
    return {
      sourceTier: "tier2_local_storage",
      metrics: [
        {
          rawMetricName: "Storage Quota",
          canonicalProvider: "tier2_prov",
          windowType: "daily",
          remainingPercentage: 45,
          sourceTier: "tier2_local_storage",
          confidence: "inferred_metric",
          rawPayload: { storage_bytes: 4500 },
        },
      ],
      rawObservations: { db_path: "/data/mock.db" },
    };
  }
  protected async probeTier3Runtime(): Promise<TierResult | null> {
    throw new Error("Tier 3 should not be called when Tier 2 succeeds");
  }
}

class Tier3SuccessCollector extends BaseTieredCollector {
  readonly platformId = "tier3_app";
  protected async probeTier1Cli(): Promise<TierResult | null> {
    return null;
  }
  protected async probeTier2Storage(): Promise<TierResult | null> {
    return null;
  }
  protected async probeTier3Runtime(): Promise<TierResult | null> {
    return {
      sourceTier: "tier3_runtime",
      metrics: [
        {
          rawMetricName: "Runtime Heuristic",
          canonicalProvider: "tier3_prov",
          windowType: "weekly",
          remainingPercentage: 12,
          sourceTier: "tier3_runtime",
          confidence: "heuristic",
          rawPayload: { heuristic_score: 12 },
        },
      ],
      rawObservations: { mem_dump: "ok" },
    };
  }
}

class AllNullCollector extends BaseTieredCollector {
  readonly platformId = "undetected_app";
  protected async probeTier1Cli(): Promise<TierResult | null> {
    return null;
  }
  protected async probeTier2Storage(): Promise<TierResult | null> {
    return null;
  }
  protected async probeTier3Runtime(): Promise<TierResult | null> {
    return null;
  }
}

class ThrowingCollector extends BaseTieredCollector {
  readonly platformId = "throwing_app";
  protected async probeTier1Cli(): Promise<TierResult | null> {
    throw new Error("Tier 1 CLI crashed");
  }
  protected async probeTier2Storage(): Promise<TierResult | null> {
    // Non-Error thrown
    throw "Tier 2 storage string failure";
  }
  protected async probeTier3Runtime(): Promise<TierResult | null> {
    throw new Error("Tier 3 runtime fatal");
  }
}

class ThrowingThenTier3SuccessCollector extends BaseTieredCollector {
  readonly platformId = "mixed_app";
  protected async probeTier1Cli(): Promise<TierResult | null> {
    throw new Error("Tier 1 failed");
  }
  protected async probeTier2Storage(): Promise<TierResult | null> {
    throw "Tier 2 failed";
  }
  protected async probeTier3Runtime(): Promise<TierResult | null> {
    return {
      sourceTier: "tier3_runtime",
      metrics: [
        {
          rawMetricName: "Fallback Quota",
          canonicalProvider: "fallback_prov",
          windowType: "session",
          remainingPercentage: 99,
          sourceTier: "tier3_runtime",
          confidence: "unknown",
          rawPayload: {},
        },
      ],
      rawObservations: { recovered: true },
    };
  }
}

describe("BaseTieredCollector", () => {
  it("probes Tier 1 successfully and short-circuits subsequent tiers", async () => {
    const collector: TelemetryCollector = new Tier1SuccessCollector();
    const result: PlatformProbeResult = await collector.probe();

    expect(result.platformId).toBe("tier1_app");
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier1_cli_command");
    expect(result.metrics.length).toBe(1);
    expect(result.metrics[0]?.rawMetricName).toBe("CLI Quota");
    expect(result.metrics[0]?.remainingPercentage).toBe(88);
    expect(result.metrics[0]?.confidence).toBe("verified_exact");
    expect(result.rawObservations).toEqual({ cli_version: "1.0.0" });
    expect(result.errors).toEqual([]);
  });

  it("escalates cleanly from Tier 1 to Tier 2 when Tier 1 returns null", async () => {
    const collector = new Tier2SuccessCollector();
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier2_local_storage");
    expect(result.metrics[0]?.remainingPercentage).toBe(45);
    expect(result.errors).toEqual([]);
  });

  it("escalates cleanly from Tier 2 to Tier 3 when Tier 1 & 2 return null", async () => {
    const collector = new Tier3SuccessCollector();
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier3_runtime");
    expect(result.metrics[0]?.remainingPercentage).toBe(12);
    expect(result.metrics[0]?.confidence).toBe("heuristic");
    expect(result.errors).toEqual([]);
  });

  it("returns isDetected: false and empty metrics when all tiers return null", async () => {
    const collector = new AllNullCollector();
    const result = await collector.probe();

    expect(result.platformId).toBe("undetected_app");
    expect(result.isDetected).toBe(false);
    expect(result.primaryTierUsed).toBeNull();
    expect(result.metrics).toEqual([]);
    expect(result.rawObservations).toEqual({});
    expect(result.errors).toEqual([]);
  });

  it("catches Error instances and string throws, records them, and recovers if a later tier succeeds", async () => {
    const collector = new ThrowingThenTier3SuccessCollector();
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier3_runtime");
    expect(result.errors.length).toBe(2);
    expect(result.errors[0]?.message).toBe("Tier 1 failed");
    expect(result.errors[1]?.message).toBe("Tier 2 failed");
    expect(result.metrics[0]?.remainingPercentage).toBe(99);
  });

  it("catches all errors across tiers when all tiers throw", async () => {
    const collector = new ThrowingCollector();
    const result = await collector.probe();

    expect(result.isDetected).toBe(false);
    expect(result.primaryTierUsed).toBeNull();
    expect(result.errors.length).toBe(3);
    expect(result.errors[0]?.message).toBe("Tier 1 CLI crashed");
    expect(result.errors[1]?.message).toBe("Tier 2 storage string failure");
    expect(result.errors[2]?.message).toBe("Tier 3 runtime fatal");
  });

  it("validates telemetry types and interfaces shape", () => {
    const metric: NormalizedQuotaMetric = {
      rawMetricName: "test_metric",
      canonicalProvider: "test_provider",
      windowType: "hourly",
      remainingPercentage: 50,
      sourceTier: "tier1_cli_command",
      confidence: "verified_exact",
      rawPayload: { test: true },
    };

    const probeResult: PlatformProbeResult = {
      platformId: "test_platform",
      isDetected: true,
      primaryTierUsed: "tier1_cli_command",
      metrics: [metric],
      rawObservations: { ping: "ok" },
      errors: [],
    };

    const report: UnifiedTelemetryReport = {
      timestamp: "2026-08-24T00:00:00.000Z",
      results: [probeResult],
      summary: { totalPlatforms: 1 },
    };

    expect(report.results.length).toBe(1);
    expect(report.results[0]?.platformId).toBe("test_platform");
  });
});
