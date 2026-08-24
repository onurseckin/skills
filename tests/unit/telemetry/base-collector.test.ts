import { describe, it, expect } from "bun:test";
import {
  BaseTieredCollector,
  type TierResult,
} from "../../../olt/scripts/src/telemetry/base-collector.ts";

class MockCollector extends BaseTieredCollector {
  readonly platformId = "mock_app";
  protected async probeTier1Cli(): Promise<TierResult | null> {
    return null; /* CLI absent */
  }
  protected async probeTier2Storage(): Promise<TierResult | null> {
    return {
      sourceTier: "tier2_local_storage",
      metrics: [
        {
          rawMetricName: "Cached Quota",
          canonicalProvider: "mock",
          windowType: "daily",
          remainingPercentage: 45,
          sourceTier: "tier2_local_storage",
          confidence: "inferred_metric",
          rawPayload: { diskQuota: 45 },
        },
      ],
      rawObservations: { foundDb: "/path/to/mock.db" },
    };
  }
  protected async probeTier3Runtime(): Promise<TierResult | null> {
    return null;
  }
}

describe("BaseTieredCollector", () => {
  it("escalates cleanly from Tier 1 to Tier 2 when CLI is absent", async () => {
    const collector = new MockCollector();
    const result = await collector.probe();
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier2_local_storage");
    expect(result.metrics[0]?.remainingPercentage).toBe(45);
  });
});
