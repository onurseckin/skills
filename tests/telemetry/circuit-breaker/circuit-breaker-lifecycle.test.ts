import { describe, expect, it } from "bun:test";
import {
  QuotaCircuitBreaker,
  normalizeCanonicalHost,
  isPlatformMatchingHost,
  detectActiveHost,
} from "../../../olt/scripts/src/telemetry/circuit-breaker.ts";
import type {
  NormalizedQuotaMetric,
  PlatformProbeResult,
  UnifiedTelemetryReport,
} from "../../../olt/scripts/src/telemetry/types.ts";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";
import { quotaCheckCommand } from "../../../olt/scripts/src/cli/commands/quota-check.ts";
import type { CollectorEnvironment } from "../../../olt/scripts/src/telemetry/collectors/index.ts";

function createMockMetric(
  modelName: string,
  remainingPercentage: number,
  resetTime?: string,
  platform = "antigravity",
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

function createMultiPlatformReport(results: PlatformProbeResult[]): UnifiedTelemetryReport {
  const detected = results.filter((r) => r.isDetected).length;
  const allPercentages = results
    .flatMap((r) => r.metrics)
    .map((m) => m.remainingPercentage)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p));
  const lowest = allPercentages.length > 0 ? Math.min(...allPercentages) : null;

  return {
    timestamp: new Date().toISOString(),
    results,
    summary: {
      totalCollectors: results.length,
      detectedPlatforms: detected,
      lowestRemainingQuota: lowest,
      activeWarnings: lowest !== null && lowest < 20 ? [`Low quota: ${lowest}%`] : [],
    },
  };
}

describe("Active Host Isolation & Inactive Provider Cache Resilience", () => {
  const fixedNow = new Date("2026-08-24T12:00:00.000Z").getTime();

  it("evaluates healthy active host (antigravity) and ignores inactive provider caches (claude 0%, codex offline)", () => {
    const report = createMultiPlatformReport([
      {
        platformId: "antigravity",
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics: [
          createMockMetric("gemini-2.5-pro", 85.0, "2026-08-24T15:00:00.000Z", "antigravity"),
        ],
        rawObservations: {},
        errors: [],
      },
      {
        platformId: "claude",
        isDetected: true,
        primaryTierUsed: "tier2_local_storage",
        metrics: [createMockMetric("claude-3-7-sonnet", 0.0, "2026-08-24T13:00:00.000Z", "claude")],
        rawObservations: {},
        errors: [],
      },
      {
        platformId: "codex",
        isDetected: false,
        primaryTierUsed: null,
        metrics: [],
        rawObservations: {},
        errors: [],
        reason: "Offline",
      },
    ]);

    const breaker = new QuotaCircuitBreaker();
    const result = breaker.evaluate(report, { activeHost: "antigravity", now: fixedNow });

    expect(result.status).toBe("OK");
    expect(result.isTriggered).toBe(false);
    expect(result.lowestRemainingQuota).toBe(85.0);
    expect(result.constrainedModels.length).toBe(0);
    expect(result.activeHost).toBe("antigravity");
  });

  it("evaluates constrained active host (claude_code) while ignoring healthy inactive antigravity", () => {
    const report = createMultiPlatformReport([
      {
        platformId: "antigravity",
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics: [
          createMockMetric("gemini-2.5-pro", 95.0, "2026-08-24T15:00:00.000Z", "antigravity"),
        ],
        rawObservations: {},
        errors: [],
      },
      {
        platformId: "claude",
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics: [createMockMetric("claude-3-7-sonnet", 4.5, "2026-08-24T13:30:00.000Z", "claude")],
        rawObservations: {},
        errors: [],
      },
    ]);

    const breaker = new QuotaCircuitBreaker();
    const result = breaker.evaluate(report, { activeHost: "claude_code", now: fixedNow });

    expect(result.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(result.isTriggered).toBe(true);
    expect(result.lowestRemainingQuota).toBe(4.5);
    expect(result.constrainedModels.length).toBe(1);
    expect(result.constrainedModels[0]!.modelName).toBe("claude-3-7-sonnet");
    expect(result.activeHost).toBe("claude_code");
  });

  it("fails closed when active host (cursor) is undetected despite other hosts being healthy", () => {
    const report = createMultiPlatformReport([
      {
        platformId: "antigravity",
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics: [createMockMetric("gemini-2.5-pro", 90.0, undefined, "antigravity")],
        rawObservations: {},
        errors: [],
      },
      {
        platformId: "cursor",
        isDetected: false,
        primaryTierUsed: null,
        metrics: [],
        rawObservations: {},
        errors: [],
        reason: "Cursor session unavailable",
      },
    ]);

    const breaker = new QuotaCircuitBreaker();
    const result = breaker.evaluate(report, { activeHost: "cursor", now: fixedNow });

    expect(result.status).toBe("QUOTA_UNKNOWN_CIRCUIT_BROKEN");
    expect(result.isTriggered).toBe(true);
    expect(result.lowestRemainingQuota).toBeNull();
  });

  it("evaluates healthy active host (codex) matching openai platform probe result", () => {
    const report = createMultiPlatformReport([
      {
        platformId: "openai",
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics: [createMockMetric("o3-mini", 70.0, "2026-08-24T16:00:00.000Z", "openai")],
        rawObservations: {},
        errors: [],
      },
      {
        platformId: "claude",
        isDetected: true,
        primaryTierUsed: "tier2_local_storage",
        metrics: [createMockMetric("claude-3-7-sonnet", 0.0, undefined, "claude")],
        rawObservations: {},
        errors: [],
      },
    ]);

    const breaker = new QuotaCircuitBreaker();
    const result = breaker.evaluate(report, { activeHost: "codex", now: fixedNow });

    expect(result.status).toBe("OK");
    expect(result.isTriggered).toBe(false);
    expect(result.lowestRemainingQuota).toBe(70.0);
  });

  it("auto-detects active host from environment variables", () => {
    const report = createMultiPlatformReport([
      {
        platformId: "antigravity",
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics: [createMockMetric("gemini-2.5-pro", 80.0, undefined, "antigravity")],
        rawObservations: {},
        errors: [],
      },
      {
        platformId: "claude",
        isDetected: true,
        primaryTierUsed: "tier2_local_storage",
        metrics: [createMockMetric("claude-3-7-sonnet", 0.0, undefined, "claude")],
        rawObservations: {},
        errors: [],
      },
    ]);

    const breaker = new QuotaCircuitBreaker();
    const result = breaker.evaluate(report, {
      env: { ANTIGRAVITY_CLI: "1" },
      now: fixedNow,
    });

    expect(result.status).toBe("OK");
    expect(result.isTriggered).toBe(false);
    expect(result.lowestRemainingQuota).toBe(80.0);
    expect(result.activeHost).toBe("antigravity");
  });

  it("normalizes canonical hosts and matches platform IDs accurately", () => {
    expect(normalizeCanonicalHost("antigravity")).toBe("antigravity");
    expect(normalizeCanonicalHost("Gemini_CLI")).toBe("antigravity");
    expect(normalizeCanonicalHost("claude-code")).toBe("claude_code");
    expect(normalizeCanonicalHost("Claude Code")).toBe("claude_code");
    expect(normalizeCanonicalHost("codex")).toBe("codex");
    expect(normalizeCanonicalHost("OpenAI")).toBe("codex");
    expect(normalizeCanonicalHost("cursor")).toBe("cursor");

    expect(isPlatformMatchingHost("antigravity", "antigravity")).toBe(true);
    expect(isPlatformMatchingHost("claude", "claude_code")).toBe(true);
    expect(isPlatformMatchingHost("claude_code", "claude")).toBe(true);
    expect(isPlatformMatchingHost("openai", "codex")).toBe(true);
    expect(isPlatformMatchingHost("cursor", "cursor")).toBe(true);
    expect(isPlatformMatchingHost("claude", "antigravity")).toBe(false);
    expect(isPlatformMatchingHost("antigravity", "cursor")).toBe(false);

    expect(detectActiveHost({ ANTIGRAVITY_CLI: "1" })).toBe("antigravity");
    expect(detectActiveHost({ CLAUDE_CODE_VERSION: "2.1.0" })).toBe("claude_code");
    expect(detectActiveHost({ CURSOR_VERSION: "0.45.0" })).toBe("cursor");
    expect(detectActiveHost({ CODEX_CLI: "1" })).toBe("codex");
    expect(detectActiveHost({})).toBeUndefined();
  });
});

describe("quota:check CLI Command & Registry", () => {
  it("registers quota:check in COMMAND_REGISTRY with zero aliases", () => {
    const cmd = findCommand("quota:check");
    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe("quota:check");
    expect(cmd?.aliases).toEqual([]);
    expect(cmd?.domain).toBe("reporting");
  });

  it("executes quotaCheckCommand with default mock environment", async () => {
    const mockEnv: CollectorEnvironment = {
      homedir: "/mock/home",
      exec: async () => null,
      readFile: async () => null,
    };

    const result = await quotaCheckCommand({}, undefined, undefined, mockEnv);

    expect(result.status).toBeDefined();
    expect(result.markdown).toBeDefined();
    expect(typeof result.isTriggered).toBe("boolean");
    expect(result.thresholdPercentage).toBe(10.0);
  });

  it("executes quotaCheckCommand with custom threshold and json output", async () => {
    const mockEnv: CollectorEnvironment = {
      homedir: "/mock/home",
      exec: async () => null,
      readFile: async () => null,
    };

    const result = await quotaCheckCommand(
      {
        threshold: "15.0",
        "active-agents": "2",
        json: true,
      },
      undefined,
      undefined,
      mockEnv,
    );

    expect(result.thresholdPercentage).toBe(15.0);
    expect(result.autoWakeSchedule === null || typeof result.autoWakeSchedule === "object").toBe(
      true,
    );
  });
});
