import { describe, expect, it } from "bun:test";
import { extractResetTime } from "../../../olt/scripts/src/telemetry/circuit-breaker.ts";
import type { NormalizedQuotaMetric } from "../../../olt/scripts/src/telemetry/types.ts";

function createMockMetric(
  modelName: string,
  remainingPercentage: number,
  resetTime?: string,
): NormalizedQuotaMetric {
  return {
    rawMetricName: modelName,
    canonicalProvider: "google",
    windowType: "5_hour",
    remainingPercentage,
    sourceTier: "tier1_cli_command",
    confidence: "verified_exact",
    rawPayload: {
      label: modelName,
      quotaInfo: {
        remainingFraction: remainingPercentage / 100,
        resetTime,
      },
    },
  };
}

describe("Circuit Breaker AutoWake Reset Extraction", () => {
  it("extracts resetTime from multiple payload conventions", () => {
    const metricWithQuotaInfo = createMockMetric("m1", 10, "2026-08-24T15:00:00Z");
    expect(extractResetTime(metricWithQuotaInfo)).toBe("2026-08-24T15:00:00Z");

    const metricWithDirectReset: NormalizedQuotaMetric = {
      rawMetricName: "m2",
      canonicalProvider: "anthropic",
      windowType: "session",
      remainingPercentage: 2,
      sourceTier: "tier2_local_storage",
      confidence: "inferred_metric",
      rawPayload: { resetTime: "2026-08-24T16:00:00Z" },
    };
    expect(extractResetTime(metricWithDirectReset)).toBe("2026-08-24T16:00:00Z");

    const metricWithSnakeCase: NormalizedQuotaMetric = {
      rawMetricName: "m3",
      canonicalProvider: "openai",
      windowType: "daily",
      remainingPercentage: 1,
      sourceTier: "tier1_cli_command",
      confidence: "verified_exact",
      rawPayload: { reset_time: "2026-08-24T17:00:00Z" },
    };
    expect(extractResetTime(metricWithSnakeCase)).toBe("2026-08-24T17:00:00Z");

    const metricWithUserStatus: NormalizedQuotaMetric = {
      rawMetricName: "m4",
      canonicalProvider: "google",
      windowType: "5_hour",
      remainingPercentage: 0,
      sourceTier: "tier1_cli_command",
      confidence: "verified_exact",
      rawPayload: {
        userStatus: {
          quotaInfo: {
            resetTime: "2026-08-24T18:00:00Z",
          },
        },
      },
    };
    expect(extractResetTime(metricWithUserStatus)).toBe("2026-08-24T18:00:00Z");

    const metricEmpty: NormalizedQuotaMetric = {
      rawMetricName: "m5",
      canonicalProvider: "google",
      windowType: "5_hour",
      remainingPercentage: 50,
      sourceTier: "tier3_runtime",
      confidence: "heuristic",
      rawPayload: {},
    };
    expect(extractResetTime(metricEmpty)).toBeUndefined();
  });
});
