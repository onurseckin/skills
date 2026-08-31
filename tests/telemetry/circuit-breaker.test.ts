import { describe, expect, it } from "bun:test";
import {
  QuotaCircuitBreaker,
  extractResetTime,
  formatCircuitBreakerMarkdown,
  normalizeCanonicalHost,
  isPlatformMatchingHost,
  detectActiveHost,
  CRITICAL_WRAP_UP_MESSAGE,
  AUTO_WAKE_PROMPT,
  DEFAULT_QUOTA_THRESHOLD,
  DEFAULT_SAFE_WINDOW_SECONDS,
  DEFAULT_AUTO_WAKE_BUFFER_SECONDS,
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

function createMockReport(
  metrics: NormalizedQuotaMetric[],
  platform = "antigravity",
): UnifiedTelemetryReport {
  const lowest = metrics.length > 0 ? Math.min(...metrics.map((m) => m.remainingPercentage)) : null;

  return {
    timestamp: new Date().toISOString(),
    results: [
      {
        platformId: platform,
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics,
        rawObservations: {},
        errors: [],
      },
    ],
    summary: {
      totalCollectors: 1,
      detectedPlatforms: 1,
      lowestRemainingQuota: lowest,
      activeWarnings: lowest !== null && lowest < 20 ? [`Low quota: ${lowest}%`] : [],
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

describe("QuotaCircuitBreaker Engine", () => {
  const fixedNow = new Date("2026-08-24T12:00:00.000Z").getTime();

  it("returns status OK when quota is above 10% threshold", () => {
    const breaker = new QuotaCircuitBreaker();
    const report = createMockReport([
      createMockMetric("gemini-2.5-pro", 85.0, "2026-08-24T14:18:42.000Z"),
      createMockMetric("claude-3-7-sonnet", 42.5, "2026-08-24T15:00:00.000Z"),
    ]);

    const result = breaker.evaluate(report, { now: fixedNow });

    expect(result.status).toBe("OK");
    expect(result.isTriggered).toBe(false);
    expect(result.thresholdPercentage).toBe(DEFAULT_QUOTA_THRESHOLD);
    expect(result.lowestRemainingQuota).toBe(42.5);
    expect(result.constrainedModels.length).toBe(0);
    expect(result.wrapUpDirectives.length).toBe(0);
    expect(result.autoWakeSchedule).toBeNull();
    expect(result.summary).toContain("Quota healthy at 42.50%");
  });

  it("triggers circuit breaker when quota is below 10% (<10%) and calculates resetTime + 60s auto-wake", () => {
    const breaker = new QuotaCircuitBreaker();
    const resetTimeIso = "2026-08-24T14:18:42.000Z";
    const report = createMockReport([
      createMockMetric("gemini-2.5-flash", 80.0, "2026-08-24T16:00:00.000Z"),
      createMockMetric("gemini-2.5-pro", 4.2, resetTimeIso),
    ]);

    const result = breaker.evaluate(report, {
      now: fixedNow,
      activeAgentsCount: 3,
    });

    expect(result.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(result.isTriggered).toBe(true);
    expect(result.lowestRemainingQuota).toBe(4.2);
    expect(result.constrainedModels.length).toBe(1);
    expect(result.constrainedModels[0]!.modelName).toBe("gemini-2.5-pro");
    expect(result.constrainedModels[0]!.remainingPercentage).toBe(4.2);
    expect(result.constrainedModels[0]!.resetTime).toBe(resetTimeIso);

    expect(result.wrapUpDirectives.length).toBe(1);
    expect(result.wrapUpDirectives[0]!.message).toBe(CRITICAL_WRAP_UP_MESSAGE);
    expect(result.wrapUpDirectives[0]!.action).toBe("idle");
    expect(result.wrapUpDirectives[0]!.forbidKill).toBe(true);

    const expectedWakeupIso = "2026-08-24T14:19:42.000Z";
    const expectedDurationSec = 8382;

    expect(result.autoWakeSchedule).not.toBeNull();
    expect(result.autoWakeSchedule!.type).toBe("one_shot_timer");
    expect(result.autoWakeSchedule!.targetWakeupIso).toBe(expectedWakeupIso);
    expect(result.autoWakeSchedule!.durationSeconds).toBe(expectedDurationSec);
    expect(result.autoWakeSchedule!.prompt).toBe(AUTO_WAKE_PROMPT);
    expect(result.autoWakeSchedule!.timerCondition).toBe("never");
    expect(result.autoWakeSchedule!.activeAgentsCount).toBe(3);
  });

  it("triggers freeze at exactly 10.0% boundary condition (<= 10.0%)", () => {
    const breaker = new QuotaCircuitBreaker();
    const resetTimeIso = "2026-08-24T13:30:00.000Z";
    const boundaryReport = createMockReport([
      createMockMetric("boundary-model", 10.0, resetTimeIso),
    ]);

    const result = breaker.evaluate(boundaryReport, { now: fixedNow });

    expect(result.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(result.isTriggered).toBe(true);
    expect(result.lowestRemainingQuota).toBe(10.0);
    expect(result.constrainedModels.length).toBe(1);
  });

  it("remains OK at 10.01% remaining quota (> 10.0%)", () => {
    const breaker = new QuotaCircuitBreaker();
    const aboveReport = createMockReport([
      createMockMetric("safe-model", 10.01, "2026-08-24T13:30:00.000Z"),
    ]);

    const result = breaker.evaluate(aboveReport, { now: fixedNow });

    expect(result.status).toBe("OK");
    expect(result.isTriggered).toBe(false);
    expect(result.lowestRemainingQuota).toBe(10.01);
  });

  it("triggers at exactly 0% remaining quota", () => {
    const breaker = new QuotaCircuitBreaker();
    const resetTimeIso = "2026-08-24T13:00:00.000Z";
    const report = createMockReport([createMockMetric("exhausted-model", 0.0, resetTimeIso)]);

    const result = breaker.evaluate(report, { now: fixedNow });

    expect(result.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(result.isTriggered).toBe(true);
    expect(result.lowestRemainingQuota).toBe(0.0);
    expect(result.autoWakeSchedule!.durationSeconds).toBe(3660);
    expect(result.autoWakeSchedule!.targetWakeupIso).toBe("2026-08-24T13:01:00.000Z");
  });

  it("picks the earliest relevant resetTime when multiple models are constrained", () => {
    const breaker = new QuotaCircuitBreaker();
    const report = createMockReport([
      createMockMetric("model-late", 2.0, "2026-08-24T16:00:00.000Z"),
      createMockMetric("model-earliest", 1.5, "2026-08-24T13:30:00.000Z"),
      createMockMetric("model-mid", 3.0, "2026-08-24T14:45:00.000Z"),
      createMockMetric("model-healthy", 90.0, "2026-08-24T12:30:00.000Z"),
    ]);

    const result = breaker.evaluate(report, { now: fixedNow });

    expect(result.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(result.constrainedModels.length).toBe(3);
    expect(result.autoWakeSchedule!.targetWakeupIso).toBe("2026-08-24T13:31:00.000Z");
    expect(result.autoWakeSchedule!.durationSeconds).toBe(5460);
  });

  it("falls back to default 5-hour safe window (18000s + 60s) when resetTime is missing", () => {
    const breaker = new QuotaCircuitBreaker();
    const report = createMockReport([createMockMetric("unspecified-model", 3.0, undefined)]);

    const result = breaker.evaluate(report, { now: fixedNow });

    expect(result.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(result.constrainedModels[0]!.resetTime).toBeUndefined();
    expect(result.autoWakeSchedule!.durationSeconds).toBe(18060);
    const expectedWakeupDate = new Date(fixedNow + 18060 * 1000).toISOString();
    expect(result.autoWakeSchedule!.targetWakeupIso).toBe(expectedWakeupDate);
  });

  it("generates targeted wrap-up directives when specific activeAgentIds are supplied", () => {
    const breaker = new QuotaCircuitBreaker();
    const report = createMockReport([
      createMockMetric("gemini-2.5-pro", 2.5, "2026-08-24T13:00:00.000Z"),
    ]);

    const result = breaker.evaluate(report, {
      now: fixedNow,
      activeAgentIds: ["agent-implementer-1", "agent-validator-1"],
    });

    expect(result.wrapUpDirectives.length).toBe(2);
    expect(result.wrapUpDirectives[0]!.recipient).toBe("agent-implementer-1");
    expect(result.wrapUpDirectives[1]!.recipient).toBe("agent-validator-1");
    expect(result.autoWakeSchedule!.activeAgentsCount).toBe(2);
  });

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

  it("formats markdown and ASCII representations clearly", () => {
    const breaker = new QuotaCircuitBreaker();
    const triggeredReport = createMockReport([
      createMockMetric("gemini-2.5-pro", 3.5, "2026-08-24T14:18:42.000Z"),
    ]);

    const triggeredEval = breaker.evaluate(triggeredReport, {
      now: fixedNow,
      activeHost: "antigravity",
    });
    const triggeredMd = formatCircuitBreakerMarkdown(triggeredEval, true);

    expect(triggeredMd).toContain("CRITICAL QUOTA CIRCUIT-BREAKER ACTIVATED (<10%)");
    expect(triggeredMd).toContain("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(triggeredMd).toContain("Target Wakeup Time (ISO)");
    expect(triggeredMd).toContain("AGENT WRAP-UP DIRECTIVES");
    expect(triggeredMd).toContain("Do NOT kill active subagents");
    expect(triggeredMd).toContain("One-Shot Scheduler Registration Payload");
    expect(triggeredMd).toContain("antigravity");

    const nominalReport = createMockReport([
      createMockMetric("gemini-2.5-pro", 95.0, "2026-08-24T14:18:42.000Z"),
    ]);
    const nominalEval = breaker.evaluate(nominalReport, { now: fixedNow });
    const nominalMd = formatCircuitBreakerMarkdown(nominalEval);

    expect(nominalMd).toContain("QUOTA CIRCUIT-BREAKER: STATUS NOMINAL");
    expect(nominalMd).toContain("OK");
  });

  it("fails closed for offline or undetected platforms", () => {
    const breaker = new QuotaCircuitBreaker();
    const offlineReport: UnifiedTelemetryReport = {
      timestamp: new Date().toISOString(),
      results: [
        {
          platformId: "antigravity",
          isDetected: false,
          primaryTierUsed: null,
          metrics: [],
          rawObservations: {},
          errors: [],
          reason: "Daemon Offline · No Quota in Storage",
        },
        {
          platformId: "claude",
          isDetected: false,
          primaryTierUsed: null,
          metrics: [],
          rawObservations: {},
          errors: [],
          reason: "No Claude Session · No API Key",
        },
        {
          platformId: "codex",
          isDetected: false,
          primaryTierUsed: null,
          metrics: [],
          rawObservations: {},
          errors: [],
          reason: "No Codex Sessions · No API Key",
        },
      ],
      summary: {
        totalCollectors: 3,
        detectedPlatforms: 0,
        lowestRemainingQuota: null,
        activeWarnings: [],
      },
    };

    const result = breaker.evaluate(offlineReport, { now: fixedNow });

    expect(result.status).toBe("QUOTA_UNKNOWN_CIRCUIT_BROKEN");
    expect(result.isTriggered).toBe(true);
    expect(result.lowestRemainingQuota).toBeNull();
    expect(result.constrainedModels.length).toBe(0);
    expect(result.wrapUpDirectives.length).toBe(1);
    expect(result.autoWakeSchedule).not.toBeNull();
    expect(result.summary).toContain("unavailable or unmeasured");
  });
});

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
