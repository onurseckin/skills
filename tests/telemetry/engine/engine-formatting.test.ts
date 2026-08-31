import { describe, expect, it } from "bun:test";
import { TelemetryNormalizationEngine } from "../../../olt/scripts/src/telemetry/engine.ts";
import type { TelemetryCollector } from "../../../olt/scripts/src/telemetry/probe-interface.ts";
import type { PlatformProbeResult } from "../../../olt/scripts/src/telemetry/types.ts";

function createStubCollector(
  platformId: string,
  remainingPercentage: number,
  isExternal = false,
): TelemetryCollector {
  return {
    platformId,
    probe: async (): Promise<PlatformProbeResult> => ({
      platformId,
      isDetected: true,
      primaryTierUsed: isExternal ? "tier2_local_storage" : "tier1_cli_command",
      metrics: [
        {
          rawMetricName: `${platformId}_metric`,
          canonicalProvider: platformId === "antigravity" ? "google" : platformId === "claude" ? "anthropic" : platformId === "cursor" ? "cursor" : "openai",
          windowType: "5_hour",
          remainingPercentage,
          sourceTier: isExternal ? "tier2_local_storage" : "tier1_cli_command",
          confidence: isExternal ? "cached" : "verified_exact",
          rawPayload: isExternal ? { isExternalCache: true } : {},
        },
      ],
      rawObservations: isExternal ? { isExternalCache: true, isolatedFromActiveHost: true } : {},
      errors: [],
    }),
  };
}

describe("TelemetryNormalizationEngine Active Host Quota Isolation & Formatting", () => {
  it("isolates active host quota in Antigravity environment from stale external Claude cache", async () => {
    const antigravityCollector = createStubCollector("antigravity", 85);
    const staleClaudeCollector = createStubCollector("claude", 0, true);

    const engine = new TelemetryNormalizationEngine([antigravityCollector, staleClaudeCollector]);
    const report = await engine.probeAll({
      env: { ANTIGRAVITY_APP_DIR: "/app" },
    });

    expect(report.summary.activeHost).toBe("antigravity");
    expect(report.summary.activePlatformId).toBe("antigravity");
    expect(report.summary.activeHostQuotaRemaining).toBe(85);
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
    const claudeCollector = createStubCollector("claude", 92);
    const staleCodexCollector = createStubCollector("codex", 5, true);

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
    const codexCollector = createStubCollector("codex", 78);
    const staleAntigravityCollector = createStubCollector("antigravity", 8, true);

    const engine = new TelemetryNormalizationEngine([codexCollector, staleAntigravityCollector]);
    const report = await engine.probeAll({
      env: { CODEX_RUNTIME: "true" },
    });

    expect(report.summary.activeHost).toBe("codex");
    expect(report.summary.activeHostQuotaRemaining).toBe(78);
    expect(report.summary.lowestRemainingQuota).toBe(78);
  });

  it("isolates active host quota in Cursor environment", async () => {
    const cursorCollector = createStubCollector("cursor", 65);
    const staleClaudeCollector = createStubCollector("claude", 2, true);

    const engine = new TelemetryNormalizationEngine([cursorCollector, staleClaudeCollector]);
    const report = await engine.probeAll({
      env: { CURSOR_PROJECT_DIR: "/cursor-workspace" },
    });

    expect(report.summary.activeHost).toBe("cursor");
    expect(report.summary.activeHostQuotaRemaining).toBe(65);
    expect(report.summary.lowestRemainingQuota).toBe(65);
  });

  it("disables isolation when isolateActiveHost is false", async () => {
    const antigravityCollector = createStubCollector("antigravity", 85);
    const staleClaudeCollector = createStubCollector("claude", 0, true);

    const engine = new TelemetryNormalizationEngine([antigravityCollector, staleClaudeCollector]);
    const report = await engine.probeAll({
      env: { ANTIGRAVITY_APP_DIR: "/app" },
      isolateActiveHost: false,
    });

    expect(report.summary.lowestRemainingQuota).toBe(0);
    expect(report.summary.externalProviderCachesIsolated).toBe(false);
  });

  it("triggers low quota warning on active host when active quota is below 20%", async () => {
    const activeLowCollector = createStubCollector("antigravity", 12.5);

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
