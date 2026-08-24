import { describe, it, expect } from "bun:test";
import type {
  PlatformProbeResult,
  NormalizedQuotaMetric,
} from "../../../olt/scripts/src/telemetry/types.ts";

describe("Telemetry Resilience", () => {
  it("preserves unmapped empirical observations without data loss", () => {
    const rawDiscovery: PlatformProbeResult = {
      platformId: "custom_frontier_agent",
      isDetected: true,
      primaryTierUsed: "tier1_cli_command",
      metrics: [
        {
          rawMetricName: "Dynamic Burst Tokens",
          canonicalProvider: "custom",
          windowType: "burst",
          remainingPercentage: 82.5,
          sourceTier: "tier1_cli_command",
          confidence: "verified_exact",
          rawPayload: { burstRemaining: 82500, burstTotal: 100000 },
        },
      ],
      rawObservations: {
        vendorExperimentalFlag: "v2-active",
        discoveredSubcommands: ["--stats", "--quota-v2"],
      },
      errors: [],
    };

    expect(rawDiscovery.metrics[0]?.remainingPercentage).toBe(82.5);
    expect(rawDiscovery.rawObservations["vendorExperimentalFlag"]).toBe("v2-active");
  });
});
