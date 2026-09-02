import { describe, expect, it } from "bun:test";
import { formatAsciiReport } from "../../olt/scripts/src/telemetry/engine-formatting.ts";
import type { UnifiedTelemetryReport } from "../../olt/scripts/src/telemetry/types.ts";

describe("formatAsciiReport - Comprehensive Table and Summary Coverage", () => {
  it("formats table rows for undetected platforms, detected without quota, and multi-metric platforms", () => {
    const report: UnifiedTelemetryReport = {
      timestamp: new Date().toISOString(),
      summary: {
        totalCollectors: 4,
        detectedPlatforms: 2,
        activeHost: "claude_code",
        activeHostSignal: { mechanism: "environment", confidence: "exact" },
        activeModel: "claude-3-7-sonnet",
        activeHostQuotaRemaining: 88,
        lowestRemainingQuota: 45,
        externalProviderCachesIsolated: true,
        activeWarnings: ["Active quota under limit", "Disk near threshold"],
        isolatedWarnings: [],
      },
      results: [
        {
          platformId: "cursor",
          isDetected: false,
          reason: "binary_missing",
          primaryTierUsed: null,
          metrics: [],
          rawObservations: {},
          errors: [],
        },
        {
          platformId: "gemini",
          isDetected: true,
          primaryTierUsed: "tier1_cli_command",
          metrics: [],
          rawObservations: {},
          errors: [{ tier: "tier1_cli_command", message: "API key expired" }],
        },
        {
          platformId: "claude",
          isDetected: true,
          primaryTierUsed: "tier1_cli_command",
          metrics: [
            {
              rawMetricName: "claude_5h",
              canonicalProvider: "anthropic",
              windowType: "5_hour",
              remainingPercentage: 88,
              sourceTier: "tier1_cli_command",
              confidence: "verified_exact",
              rawPayload: {},
            },
            {
              rawMetricName: undefined,
              canonicalProvider: "anthropic",
              windowType: undefined,
              remainingPercentage: null,
              sourceTier: "tier1_cli_command",
              confidence: "heuristics_fallback",
              rawPayload: {},
            },
          ],
          rawObservations: { planType: "Team", extra: 123 },
          errors: [],
        },
      ],
    };

    const formatted = formatAsciiReport(report, true);
    expect(formatted).toContain("cursor");
    expect(formatted).toContain("[░░░░░░] Not Dete");
    expect(formatted).toContain("binary_missing");
    expect(formatted).toContain("Detected (No Quot");
    expect(formatted).toContain("Tier 1 (heur");
    expect(formatted).toContain("claude_5h");
    expect(formatted).toContain("[??????] Unknown");
    expect(formatted).toContain("Not Measured");
    expect(formatted).toContain("- **Summary**: 2/4 platforms discovered.");
    expect(formatted).toContain("- **Active Host**: `claude_code` (environment)");
    expect(formatted).toContain("- **Active Model**: `claude-3-7-sonnet`");
    expect(formatted).toContain("- **Active Host Quota**: 88%");
    expect(formatted).toContain("- **Lowest Remaining Quota**: 45% (active host isolated)");
    expect(formatted).toContain("⚠️  Active quota under limit");
    expect(formatted).toContain("- **Non-Fatal Probe Errors** (1):");
    expect(formatted).toContain("`[gemini]` API key expired");
    expect(formatted).toContain("### Detailed Raw Observations");
    expect(formatted).toContain('"planType": "Team"');
  });

  it("formats account badges for antigravity, codex, and openai platforms", () => {
    const report: UnifiedTelemetryReport = {
      timestamp: new Date().toISOString(),
      summary: {
        totalCollectors: 3,
        detectedPlatforms: 3,
        lowestRemainingQuota: 50,
        externalProviderCachesIsolated: false,
      },
      results: [
        {
          platformId: "antigravity",
          isDetected: true,
          primaryTierUsed: "tier2_local_storage",
          metrics: [],
          rawObservations: {
            userTier: {
              name: "Pro Tier",
              availableCredits: [{ creditAmount: 500 }],
            },
            plan: "Enterprise",
          },
          errors: [],
        },
        {
          platformId: "codex",
          isDetected: true,
          primaryTierUsed: "tier2_local_storage",
          metrics: [],
          rawObservations: { plan_type: "Plus" },
          errors: [],
        },
        {
          platformId: "openai",
          isDetected: true,
          primaryTierUsed: "tier1_cli_command",
          metrics: [],
          rawObservations: { plan: "Usage-Based" },
          errors: [],
        },
      ],
    };

    const formatted = formatAsciiReport(report);
    expect(formatted).toContain("`[antigravity]` Pro Tier · 500 Credits · Plan: Enterprise");
    expect(formatted).toContain("`[codex]` Plan: Plus");
    expect(formatted).toContain("`[openai]` Plan: Usage-Based");
    expect(formatted).toContain("- **Lowest Remaining Quota**: 50%");
    expect(formatted).not.toContain("(active host isolated)");
  });

  it("handles fallback defaults when summary fields are missing or empty", () => {
    const report: UnifiedTelemetryReport = {
      timestamp: new Date().toISOString(),
      summary: {},
      results: [
        {
          platformId: "antigravity",
          isDetected: false,
          primaryTierUsed: null,
          metrics: [],
          rawObservations: {
            userTier: {
              name: undefined,
              availableCredits: [{ creditAmount: undefined }],
            },
          },
          errors: [],
        },
      ],
    };

    const formatted = formatAsciiReport(report);
    expect(formatted).toContain("- **Summary**: 0/1 platforms discovered.");
    expect(formatted).toContain("`[antigravity]` unknown · 0 Credits");
    expect(formatted).not.toContain("- **Active Host**:");
    expect(formatted).not.toContain("- **Active Model**:");
    expect(formatted).not.toContain("- **Non-Fatal Probe Errors**");
  });
});
