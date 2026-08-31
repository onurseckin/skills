import { describe, expect, it } from "bun:test";
import {
  BaseTieredCollector,
  type TierResult,
} from "../../olt/scripts/src/telemetry/base-collector.ts";
import { TelemetryNormalizationEngine } from "../../olt/scripts/src/telemetry/engine.ts";
import { redactRecord } from "../../olt/scripts/src/telemetry/redact.ts";
import type { NormalizedQuotaMetric } from "../../olt/scripts/src/telemetry/types.ts";

const SECRET = "zTq9-XVERYDISTINCTIVE-RANDOM-TOKEN-8271";

function buildLeakyPayload(): Record<string, unknown> {
  return {
    plan: "pro",
    resetTime: "2026-09-01T00:00:00Z",
    blob: SECRET,
    meta: {
      id: SECRET,
      detail: {
        nested: {
          meta: SECRET,
        },
      },
    },
    detail: [{ id: SECRET }, { blob: { meta: SECRET } }],
  };
}

class LeakySurfaceCollector extends BaseTieredCollector {
  readonly platformId = "leaky_surface";

  protected async probeTier1Cli(): Promise<TierResult | null> {
    const payload = buildLeakyPayload();
    const metrics: NormalizedQuotaMetric[] = [
      {
        rawMetricName: "leaky_metric",
        canonicalProvider: "mock",
        windowType: "session",
        remainingPercentage: 42,
        sourceTier: "tier1_cli_command",
        confidence: "verified_exact",
        rawPayload: payload,
      },
    ];
    return { sourceTier: "tier1_cli_command", metrics, rawObservations: payload };
  }

  protected async probeTier2Storage(): Promise<TierResult | null> {
    return null;
  }

  protected async probeTier3Runtime(): Promise<TierResult | null> {
    return null;
  }
}

describe("collector-boundary field allowlist (general invariant)", () => {
  it("drops a distinctive secret hidden under innocuously-named keys at every nesting depth, in JSON and in the detailed markdown report", async () => {
    const collector = new LeakySurfaceCollector();
    const result = await collector.probe();

    expect(JSON.stringify(result)).not.toContain(SECRET);

    const engine = new TelemetryNormalizationEngine([collector]);
    const report = await engine.probeAll();
    const markdown = engine.formatAsciiReport(report, true);
    expect(markdown).not.toContain(SECRET);

    expect(JSON.stringify(result)).toContain("pro");
    expect(JSON.stringify(result)).toContain("2026-09-01T00:00:00Z");
  });

  it("the same payload leaks the secret through the plain denylist redactor, proving the allowlist (not the denylist alone) is what closes the gap", () => {
    const payload = buildLeakyPayload();
    const denylistOnly = redactRecord(payload);

    expect(JSON.stringify(denylistOnly)).toContain(SECRET);
  });
});
