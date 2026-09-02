import { describe, expect, it } from "bun:test";
import {
  formatPreciseProgressBar,
  formatResetTime,
  formatTierBadge,
  formatTierShort,
  renderProgressBar,
} from "../../../olt/scripts/src/telemetry/engine-formatting.ts";
import type { NormalizedQuotaMetric } from "../../../olt/scripts/src/telemetry/types.ts";

describe("renderProgressBar and formatPreciseProgressBar", () => {
  it("renders standard progress bar with clamping and custom width", () => {
    expect(renderProgressBar(-10)).toBe("[░░░░░░░░░░] 0%");
    expect(renderProgressBar(0)).toBe("[░░░░░░░░░░] 0%");
    expect(renderProgressBar(50)).toBe("[█████░░░░░] 50%");
    expect(renderProgressBar(100)).toBe("[██████████] 100%");
    expect(renderProgressBar(120)).toBe("[██████████] 100%");
    expect(renderProgressBar(60, 5)).toBe("[███░░] 60%");
  });

  it("renders precise progress bar with decimals and integers", () => {
    expect(formatPreciseProgressBar(50)).toBe("[███░░░] 50%");
    expect(formatPreciseProgressBar(75.5)).toBe("[█████░] 75.50%");
    expect(formatPreciseProgressBar(33.333, 6)).toBe("[██░░░░] 33.33%");
    expect(formatPreciseProgressBar(0, 4)).toBe("[░░░░] 0%");
    expect(formatPreciseProgressBar(100, 4)).toBe("[████] 100%");
  });
});

describe("formatTierBadge and formatTierShort", () => {
  it("formats all tier badge variations", () => {
    expect(formatTierBadge("tier1_cli_command")).toBe("Tier 1 (CLI)");
    expect(formatTierBadge("tier2_local_storage")).toBe("Tier 2 (Storage)");
    expect(formatTierBadge("tier3_runtime")).toBe("Tier 3 (Runtime)");
    expect(formatTierBadge(null)).toBe("None");
  });

  it("formats short tier badges", () => {
    expect(formatTierShort("tier1_cli_command")).toBe("Tier 1");
    expect(formatTierShort("tier2_local_storage")).toBe("Tier 2");
    expect(formatTierShort("tier3_runtime")).toBe("Tier 3");
    expect(formatTierShort(null)).toBe("None");
  });
});

describe("formatResetTime", () => {
  function makeMetric(
    windowType: "session" | "daily" | "5_hour" | undefined,
    rawPayload: Record<string, unknown>,
  ): NormalizedQuotaMetric {
    return {
      rawMetricName: "test_metric",
      canonicalProvider: "anthropic",
      windowType,
      remainingPercentage: 80,
      sourceTier: "tier1_cli_command",
      confidence: "verified_exact",
      rawPayload,
    };
  }

  it("formats reset time in hours and minutes for future dates", () => {
    const futureDate = new Date(Date.now() + (2 * 3600 + 15 * 60) * 1000).toISOString();
    const metric = makeMetric("5_hour", { resetTime: futureDate });
    const result = formatResetTime(metric);
    expect(result).toMatch(/^in 2h 1[45]m$/);
  });

  it("formats reset time in minutes only when less than 1 hour remains", () => {
    const futureDate = new Date(Date.now() + 25 * 60 * 1000).toISOString();
    const metric = makeMetric("5_hour", {
      quotaInfo: { resetTime: futureDate },
    });
    const result = formatResetTime(metric);
    expect(result).toMatch(/^in 2[45]m$/);
  });

  it("returns Refreshed when reset time is in the past", () => {
    const pastDate = new Date(Date.now() - 60 * 1000).toISOString();
    const metric = makeMetric("5_hour", { resetTime: pastDate });
    expect(formatResetTime(metric)).toBe("Refreshed");
  });

  it("returns fallback labels based on windowType when resetTime is absent", () => {
    expect(formatResetTime(makeMetric("session", {}))).toBe("Session Active");
    expect(formatResetTime(makeMetric("daily", {}))).toBe("Daily Cached");
    expect(formatResetTime(makeMetric("5_hour", {}))).toBe("Available");
    expect(formatResetTime(makeMetric(undefined, {}))).toBe("Available");
  });
});
