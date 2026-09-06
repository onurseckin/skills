import { describe, expect, test } from "bun:test";
import {
  AntigravityCollector,
  type CollectorEnvironment,
} from "../../../olt/scripts/src/telemetry/collectors/index.ts";
import { evaluateCircuitBreaker } from "../../../olt/scripts/src/telemetry/circuit-breaker-evaluator.ts";
import type { UnifiedTelemetryReport } from "../../../olt/scripts/src/telemetry/types.ts";

describe("Two-Key Socratic Cognitive Validation: Proto3 Zero-Value Float Omission Track", () => {
  const baseLsof = async (cmd: string, args: string[]) =>
    cmd === "lsof" && args.includes("-iTCP")
      ? {
          stdout: "agy 17163 user 11u IPv4 0x166ae5799056f5b7 0t0 TCP 127.0.0.1:56963 (LISTEN)\n",
          stderr: "",
          exitCode: 0,
        }
      : null;

  test("Probe 1: Invariant - Top-Level quotaInfo: {} produces remainingPercentage 0.0% verified_exact", async () => {
    const env: CollectorEnvironment = {
      exec: baseLsof,
      fetchUserStatus: async (port) =>
        port === "56963" ? { userStatus: { quotaInfo: {} } } : null,
    };
    const result = await new AntigravityCollector(env).probe();
    expect(result.isDetected).toBe(true);
    const metric = result.metrics[0]!;
    expect(metric.rawMetricName).toBe("overall_5_hour_quota");
    expect(metric.canonicalProvider).toBe("google");
    expect(metric.remainingPercentage).toBe(0.0);
    expect(metric.confidence).toBe("verified_exact");
  });

  test("Probe 2: Invariant - Multi-Model Proto3 Zero Omission Discrepancy Isolation", async () => {
    const env: CollectorEnvironment = {
      exec: baseLsof,
      fetchUserStatus: async (port) =>
        port === "56963"
          ? {
              userStatus: {
                quotaInfo: { remainingFraction: 0.75 },
                cascadeModelConfigData: {
                  clientModelConfigs: [
                    {
                      label: "Gemini 3.7 Flash (High)",
                      quotaInfo: {},
                      modelId: "gemini-3.7-flash-high",
                    },
                    { label: "Claude Sonnet 4.6 (Thinking)", modelId: "claude-sonnet-4.6" },
                    {
                      label: "GPT-OSS 120B (Medium)",
                      quotaInfo: { remainingFraction: 0.0 },
                      modelId: "gpt-oss-120b",
                    },
                    {
                      label: "Claude Haiku 4.5",
                      quotaInfo: { remainingFraction: 0.354 },
                      modelId: "claude-haiku-4.5",
                    },
                  ],
                },
              },
            }
          : null,
    };
    const result = await new AntigravityCollector(env).probe();
    expect(result.metrics.length).toBe(5);
    expect(
      result.metrics.find((m) => m.rawMetricName === "Gemini 3.7 Flash (High)")
        ?.remainingPercentage,
    ).toBe(0.0);
    expect(
      result.metrics.find((m) => m.rawMetricName === "Gemini 3.7 Flash (High)")?.confidence,
    ).toBe("verified_exact");
    expect(
      result.metrics.find((m) => m.rawMetricName === "Claude Sonnet 4.6 (Thinking)")
        ?.remainingPercentage,
    ).toBeNull();
    expect(
      result.metrics.find((m) => m.rawMetricName === "Claude Sonnet 4.6 (Thinking)")?.confidence,
    ).toBe("unknown");
    expect(
      result.metrics.find((m) => m.rawMetricName === "GPT-OSS 120B (Medium)")?.remainingPercentage,
    ).toBe(0.0);
    expect(
      result.metrics.find((m) => m.rawMetricName === "GPT-OSS 120B (Medium)")?.confidence,
    ).toBe("verified_exact");
    expect(
      result.metrics.find((m) => m.rawMetricName === "Claude Haiku 4.5")?.remainingPercentage,
    ).toBe(35.4);
  });

  test("Probe 3: Invariant - Tier 2 Local Storage Fallback Proto3 Zero Parsing", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      homedir: "/mock/home",
      readFile: async (p) =>
        p.includes("antigravity-cli/state.json")
          ? JSON.stringify({ quotaInfo: {}, user: "p3@test.com" })
          : null,
    };
    const result = await new AntigravityCollector(env).probe();
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier2_local_storage");
    expect(result.metrics[0]!.remainingPercentage).toBe(0.0);
    expect(result.metrics[0]!.confidence).toBe("cached");
  });

  test("Probe 4: Invariant - Circuit Breaker Tripping on Proto3 Zero (QUOTA_EXHAUSTED_CIRCUIT_BROKEN)", async () => {
    const env: CollectorEnvironment = {
      exec: baseLsof,
      fetchUserStatus: async (port) =>
        port === "56963"
          ? {
              userStatus: {
                quotaInfo: {},
                cascadeModelConfigData: {
                  clientModelConfigs: [{ label: "Claude Sonnet 4.6", quotaInfo: {} }],
                },
              },
            }
          : null,
    };
    const probeResult = await new AntigravityCollector(env).probe();
    const report: UnifiedTelemetryReport = {
      timestamp: new Date().toISOString(),
      results: [probeResult],
      summary: { activeHost: "antigravity" },
    };
    const evalRes = evaluateCircuitBreaker(report, { activeHost: "antigravity" });
    expect(evalRes.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(evalRes.isTriggered).toBe(true);
    expect(evalRes.lowestRemainingQuota).toBe(0.0);
    expect(evalRes.wrapUpDirectives[0]!.action).toBe("idle");
    expect(evalRes.wrapUpDirectives[0]!.forbidKill).toBe(true);
  });

  test("Probe 5: Invariant - Zero False Negatives & Non-Zero Float Preservation", async () => {
    const env: CollectorEnvironment = {
      exec: baseLsof,
      fetchUserStatus: async (port) =>
        port === "56963"
          ? {
              userStatus: {
                quotaInfo: { remainingFraction: 0.0001 },
                cascadeModelConfigData: {
                  clientModelConfigs: [
                    { label: "Micro Residual Model", quotaInfo: { remainingFraction: 0.0005 } },
                    { label: "Zero Proto3 Model", quotaInfo: {} },
                  ],
                },
              },
            }
          : null,
    };
    const result = await new AntigravityCollector(env).probe();
    expect(
      result.metrics.find((m) => m.rawMetricName === "overall_5_hour_quota")?.remainingPercentage,
    ).toBe(0.01);
    expect(
      result.metrics.find((m) => m.rawMetricName === "Micro Residual Model")?.remainingPercentage,
    ).toBe(0.05);
    expect(
      result.metrics.find((m) => m.rawMetricName === "Zero Proto3 Model")?.remainingPercentage,
    ).toBe(0.0);
    expect(result.metrics.find((m) => m.rawMetricName === "Zero Proto3 Model")?.confidence).toBe(
      "verified_exact",
    );
  });

  test("Probe 6: Invariant - Malformed / Null Object Robustness", async () => {
    const env: CollectorEnvironment = {
      exec: baseLsof,
      fetchUserStatus: async (port) =>
        port === "56963"
          ? {
              userStatus: {
                quotaInfo: null,
                cascadeModelConfigData: {
                  clientModelConfigs: [
                    { label: "Model With Null Quota", quotaInfo: null },
                    { label: "Model With String Quota", quotaInfo: "invalid" },
                  ],
                },
              },
            }
          : null,
    };
    const result = await new AntigravityCollector(env).probe();
    expect(result.metrics.find((m) => m.rawMetricName === "overall_5_hour_quota")).toBeUndefined();
    expect(
      result.metrics.find((m) => m.rawMetricName === "Model With Null Quota")?.remainingPercentage,
    ).toBeNull();
    expect(
      result.metrics.find((m) => m.rawMetricName === "Model With String Quota")
        ?.remainingPercentage,
    ).toBeNull();
  });
});
