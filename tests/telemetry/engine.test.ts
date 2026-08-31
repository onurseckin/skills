import { describe, expect, it } from "bun:test";
import {
  TelemetryNormalizationEngine,
  renderProgressBar,
  formatTierBadge,
} from "../../olt/scripts/src/telemetry/engine.ts";
import type { TelemetryCollector } from "../../olt/scripts/src/telemetry/probe-interface.ts";
import type { PlatformProbeResult } from "../../olt/scripts/src/telemetry/types.ts";

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
    expect(ascii).toContain("Tier 1");
    expect(ascii).toContain("Detailed Raw Observations");
  });

  it("renders account badges for Codex and Claude in formatAsciiReport", async () => {
    const codexCollector: TelemetryCollector = {
      platformId: "codex",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "codex",
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics: [
          {
            rawMetricName: "Codex (7-Day Limit)",
            canonicalProvider: "openai",
            windowType: "weekly",
            remainingPercentage: 24,
            sourceTier: "tier1_cli_command",
            confidence: "verified_exact",
            rawPayload: {},
          },
        ],
        rawObservations: { plan_type: "prolite" },
        errors: [],
      }),
    };

    const engine = new TelemetryNormalizationEngine([codexCollector]);
    const report = await engine.probeAll();
    const ascii = engine.formatAsciiReport(report);

    expect(ascii).toContain("Account Badges");
    expect(ascii).toContain("`[codex]` Plan: prolite");
  });

  it("formats ASCII report truthfully for Not Detected platforms with [░░░░░░] Not Detected", async () => {
    const offlineCollector: TelemetryCollector = {
      platformId: "claude",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "claude",
        isDetected: false,
        primaryTierUsed: null,
        metrics: [],
        rawObservations: {},
        errors: [],
        reason: "No Claude Session · No API Key",
      }),
    };

    const engine = new TelemetryNormalizationEngine([offlineCollector]);
    const report = await engine.probeAll();
    const ascii = engine.formatAsciiReport(report);

    expect(ascii).toContain("claude");
    expect(ascii).toContain("[░░░░░░] Not Dete");
    expect(ascii).toContain("No Claude Sessio");
    expect(ascii).not.toContain("100%");
    expect(report.summary.detectedPlatforms).toBe(0);
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

describe("TelemetryNormalizationEngine Active Host Quota Isolation", () => {
  it("isolates active host quota in Antigravity environment from stale external Claude cache", async () => {
    const antigravityCollector: TelemetryCollector = {
      platformId: "antigravity",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "antigravity",
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics: [
          {
            rawMetricName: "overall_5_hour_quota",
            canonicalProvider: "google",
            windowType: "5_hour",
            remainingPercentage: 85,
            sourceTier: "tier1_cli_command",
            confidence: "verified_exact",
            rawPayload: {},
          },
        ],
        rawObservations: {},
        errors: [],
      }),
    };

    const staleClaudeCollector: TelemetryCollector = {
      platformId: "claude",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "claude",
        isDetected: true,
        primaryTierUsed: "tier2_local_storage",
        metrics: [
          {
            rawMetricName: "stale_claude_cache",
            canonicalProvider: "anthropic",
            windowType: "session",
            remainingPercentage: 0,
            sourceTier: "tier2_local_storage",
            confidence: "cached",
            rawPayload: { isExternalCache: true },
          },
        ],
        rawObservations: { isExternalCache: true, isolatedFromActiveHost: true },
        errors: [],
      }),
    };

    const engine = new TelemetryNormalizationEngine([antigravityCollector, staleClaudeCollector]);
    const report = await engine.probeAll({
      env: { ANTIGRAVITY_APP_DIR: "/app" },
    });

    expect(report.summary.activeHost).toBe("antigravity");
    expect(report.summary.activePlatformId).toBe("antigravity");
    expect(report.summary.activeHostQuotaRemaining).toBe(85);
    // Crucial isolation check: lowestRemainingQuota MUST be 85% (active host), NOT 0% (stale external cache)
    expect(report.summary.lowestRemainingQuota).toBe(85);
    expect(report.summary.externalProviderCachesIsolated).toBe(true);
    expect(report.summary.activeWarnings).toHaveLength(0);
    expect((report.summary.isolatedWarnings as string[]).length).toBeGreaterThan(0);

    const ascii = engine.formatAsciiReport(report);
    expect(ascii).toContain("- **Active Host**: `antigravity`");
    expect(ascii).toContain("- **Active Host Quota**: 85%");
    expect(ascii).toContain("- **Lowest Remaining Quota**: 85% (active host isolated)");
  });

  it("isolates active host quota in Claude Code environment from stale Codex cache", async () => {
    const claudeCollector: TelemetryCollector = {
      platformId: "claude",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "claude",
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics: [
          {
            rawMetricName: "Claude Code (5-Hour Window)",
            canonicalProvider: "anthropic",
            windowType: "5_hour",
            remainingPercentage: 92,
            sourceTier: "tier1_cli_command",
            confidence: "verified_exact",
            rawPayload: {},
          },
        ],
        rawObservations: {},
        errors: [],
      }),
    };

    const staleCodexCollector: TelemetryCollector = {
      platformId: "codex",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "codex",
        isDetected: true,
        primaryTierUsed: "tier2_local_storage",
        metrics: [
          {
            rawMetricName: "stale_codex_usage",
            canonicalProvider: "openai",
            windowType: "monthly",
            remainingPercentage: 5,
            sourceTier: "tier2_local_storage",
            confidence: "cached",
            rawPayload: { isExternalCache: true },
          },
        ],
        rawObservations: { isExternalCache: true },
        errors: [],
      }),
    };

    const engine = new TelemetryNormalizationEngine([claudeCollector, staleCodexCollector]);
    const report = await engine.probeAll({
      env: { CLAUDE_PROJECT_DIR: "/my-project" },
    });

    expect(report.summary.activeHost).toBe("claude_code");
    expect(report.summary.activeHostQuotaRemaining).toBe(92);
    expect(report.summary.lowestRemainingQuota).toBe(92);
    expect(report.summary.externalProviderCachesIsolated).toBe(true);
  });

  it("isolates active host quota in Codex environment from low Antigravity storage", async () => {
    const codexCollector: TelemetryCollector = {
      platformId: "codex",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "codex",
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics: [
          {
            rawMetricName: "codex_tokens_remaining",
            canonicalProvider: "openai",
            windowType: "weekly",
            remainingPercentage: 78,
            sourceTier: "tier1_cli_command",
            confidence: "verified_exact",
            rawPayload: {},
          },
        ],
        rawObservations: {},
        errors: [],
      }),
    };

    const staleAntigravityCollector: TelemetryCollector = {
      platformId: "antigravity",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "antigravity",
        isDetected: true,
        primaryTierUsed: "tier2_local_storage",
        metrics: [
          {
            rawMetricName: "local_state_quota",
            canonicalProvider: "google",
            windowType: "daily",
            remainingPercentage: 8,
            sourceTier: "tier2_local_storage",
            confidence: "cached",
            rawPayload: {},
          },
        ],
        rawObservations: {},
        errors: [],
      }),
    };

    const engine = new TelemetryNormalizationEngine([codexCollector, staleAntigravityCollector]);
    const report = await engine.probeAll({
      env: { CODEX_RUNTIME: "true" },
    });

    expect(report.summary.activeHost).toBe("codex");
    expect(report.summary.activeHostQuotaRemaining).toBe(78);
    expect(report.summary.lowestRemainingQuota).toBe(78);
  });

  it("isolates active host quota in Cursor environment", async () => {
    const cursorCollector: TelemetryCollector = {
      platformId: "cursor",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "cursor",
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics: [
          {
            rawMetricName: "cursor_fast_requests",
            canonicalProvider: "cursor",
            windowType: "monthly",
            remainingPercentage: 65,
            sourceTier: "tier1_cli_command",
            confidence: "verified_exact",
            rawPayload: {},
          },
        ],
        rawObservations: {},
        errors: [],
      }),
    };

    const staleClaudeCollector: TelemetryCollector = {
      platformId: "claude",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "claude",
        isDetected: true,
        primaryTierUsed: "tier2_local_storage",
        metrics: [
          {
            rawMetricName: "claude_cache",
            canonicalProvider: "anthropic",
            windowType: "session",
            remainingPercentage: 2,
            sourceTier: "tier2_local_storage",
            confidence: "cached",
            rawPayload: {},
          },
        ],
        rawObservations: {},
        errors: [],
      }),
    };

    const engine = new TelemetryNormalizationEngine([cursorCollector, staleClaudeCollector]);
    const report = await engine.probeAll({
      env: { CURSOR_PROJECT_DIR: "/cursor-workspace" },
    });

    expect(report.summary.activeHost).toBe("cursor");
    expect(report.summary.activeHostQuotaRemaining).toBe(65);
    expect(report.summary.lowestRemainingQuota).toBe(65);
  });

  it("disables isolation when isolateActiveHost is false", async () => {
    const antigravityCollector: TelemetryCollector = {
      platformId: "antigravity",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "antigravity",
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics: [
          {
            rawMetricName: "overall_5_hour_quota",
            canonicalProvider: "google",
            windowType: "5_hour",
            remainingPercentage: 85,
            sourceTier: "tier1_cli_command",
            confidence: "verified_exact",
            rawPayload: {},
          },
        ],
        rawObservations: {},
        errors: [],
      }),
    };

    const staleClaudeCollector: TelemetryCollector = {
      platformId: "claude",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "claude",
        isDetected: true,
        primaryTierUsed: "tier2_local_storage",
        metrics: [
          {
            rawMetricName: "stale_claude_cache",
            canonicalProvider: "anthropic",
            windowType: "session",
            remainingPercentage: 0,
            sourceTier: "tier2_local_storage",
            confidence: "cached",
            rawPayload: {},
          },
        ],
        rawObservations: {},
        errors: [],
      }),
    };

    const engine = new TelemetryNormalizationEngine([antigravityCollector, staleClaudeCollector]);
    const report = await engine.probeAll({
      env: { ANTIGRAVITY_APP_DIR: "/app" },
      isolateActiveHost: false,
    });

    // When isolation is explicitly false, lowest quota falls back to global lowest (0%)
    expect(report.summary.lowestRemainingQuota).toBe(0);
    expect(report.summary.externalProviderCachesIsolated).toBe(false);
  });

  it("triggers low quota warning on active host when active quota is below 20%", async () => {
    const activeLowCollector: TelemetryCollector = {
      platformId: "antigravity",
      probe: async (): Promise<PlatformProbeResult> => ({
        platformId: "antigravity",
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics: [
          {
            rawMetricName: "gemini_requests",
            canonicalProvider: "google",
            windowType: "5_hour",
            remainingPercentage: 12.5,
            sourceTier: "tier1_cli_command",
            confidence: "verified_exact",
            rawPayload: {},
          },
        ],
        rawObservations: {},
        errors: [],
      }),
    };

    const engine = new TelemetryNormalizationEngine([activeLowCollector]);
    const report = await engine.probeAll({
      env: { ANTIGRAVITY_APP_DIR: "/app" },
    });

    expect(report.summary.lowestRemainingQuota).toBe(12.5);
    expect(report.summary.activeWarnings).toHaveLength(1);
    expect((report.summary.activeWarnings as string[])[0]).toContain("Low quota warning");
    expect((report.summary.activeWarnings as string[])[0]).toContain("12.5%");
  });

  it("exposes detectHost method for standalone discovery", () => {
    const engine = new TelemetryNormalizationEngine();
    const result = engine.detectHost({
      env: { CLAUDE_PROJECT_DIR: "/proj" },
      model: "claude-3-7-sonnet",
    });

    expect(result.activeHost).toBe("claude_code");
    expect(result.primaryPlatformId).toBe("claude");
    expect(result.signal.mechanism).toBe("environment");
  });
});
