import { describe, expect, it } from "bun:test";
import {
  QuotaCircuitBreaker,
  extractResetTime,
  formatCircuitBreakerMarkdown,
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

    // Verify Wrap-Up Directives
    expect(result.wrapUpDirectives.length).toBe(1);
    expect(result.wrapUpDirectives[0]!.message).toBe(CRITICAL_WRAP_UP_MESSAGE);
    expect(result.wrapUpDirectives[0]!.action).toBe("idle");
    expect(result.wrapUpDirectives[0]!.forbidKill).toBe(true);

    // Verify Auto-Wake Scheduler calculation
    // resetDate = 14:18:42, targetWakeup = 14:18:42 + 60s = 14:19:42
    // diff from fixedNow (12:00:00) = 2h 19m 42s = (2 * 3600) + (19 * 60) + 42 = 8382 seconds
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

  it("triggers at exactly 0% remaining quota", () => {
    const breaker = new QuotaCircuitBreaker();
    const resetTimeIso = "2026-08-24T13:00:00.000Z";
    const report = createMockReport([createMockMetric("exhausted-model", 0.0, resetTimeIso)]);

    const result = breaker.evaluate(report, { now: fixedNow });

    expect(result.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(result.isTriggered).toBe(true);
    expect(result.lowestRemainingQuota).toBe(0.0);
    // targetWakeup = 13:01:00Z -> diff from 12:00:00Z = 1h 1m = 3660s
    expect(result.autoWakeSchedule!.durationSeconds).toBe(3660);
    expect(result.autoWakeSchedule!.targetWakeupIso).toBe("2026-08-24T13:01:00.000Z");
  });

  it("picks the earliest relevant resetTime when multiple models are constrained", () => {
    const breaker = new QuotaCircuitBreaker();
    const report = createMockReport([
      createMockMetric("model-late", 2.0, "2026-08-24T16:00:00.000Z"),
      createMockMetric("model-earliest", 1.5, "2026-08-24T13:30:00.000Z"),
      createMockMetric("model-mid", 3.0, "2026-08-24T14:45:00.000Z"),
      createMockMetric("model-healthy", 90.0, "2026-08-24T12:30:00.000Z"), // healthy model with earlier reset should NOT be picked
    ]);

    const result = breaker.evaluate(report, { now: fixedNow });

    expect(result.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(result.constrainedModels.length).toBe(3);

    // Earliest constrained reset time is 13:30:00Z
    // targetWakeup = 13:30:00Z + 60s = 13:31:00Z
    // diff from 12:00:00Z = 1h 31m = (1 * 3600) + (31 * 60) = 5460 seconds
    expect(result.autoWakeSchedule!.targetWakeupIso).toBe("2026-08-24T13:31:00.000Z");
    expect(result.autoWakeSchedule!.durationSeconds).toBe(5460);
  });

  it("falls back to default 5-hour safe window (18000s + 60s) when resetTime is missing", () => {
    const breaker = new QuotaCircuitBreaker();
    const report = createMockReport([createMockMetric("unspecified-model", 3.0, undefined)]);

    const result = breaker.evaluate(report, { now: fixedNow });

    expect(result.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(result.constrainedModels[0]!.resetTime).toBeUndefined();

    // Default safe window: 18000s (5h) + 60s buffer = 18060s
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

    const triggeredEval = breaker.evaluate(triggeredReport, { now: fixedNow });
    const triggeredMd = formatCircuitBreakerMarkdown(triggeredEval, true);

    expect(triggeredMd).toContain("CRITICAL QUOTA CIRCUIT-BREAKER ACTIVATED (<10%)");
    expect(triggeredMd).toContain("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(triggeredMd).toContain("Target Wakeup Time (ISO)");
    expect(triggeredMd).toContain("AGENT WRAP-UP DIRECTIVES");
    expect(triggeredMd).toContain("Do NOT kill active subagents");
    expect(triggeredMd).toContain("One-Shot Scheduler Registration Payload");

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
