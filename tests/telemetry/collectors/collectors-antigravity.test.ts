import { describe, expect, it } from "bun:test";
import {
  AntigravityCollector,
  type CollectorEnvironment,
} from "../../../olt/scripts/src/telemetry/collectors/index.ts";
import type { PlatformProbeResult } from "../../../olt/scripts/src/telemetry/types.ts";

describe("AntigravityCollector", () => {
  it("probes Tier 1 Connect-RPC Language Server successfully with multiple models and user tier", async () => {
    const env: CollectorEnvironment = {
      exec: async (cmd, args) => {
        if (cmd === "lsof" && args.includes("-iTCP")) {
          return {
            stdout:
              "agy 17163 user 11u IPv4 0x166ae5799056f5b7 0t0 TCP 127.0.0.1:56963 (LISTEN)\n" +
              "agy 17163 user 12u IPv4 0xa123841d0d0af048 0t0 TCP 127.0.0.1:56964 (LISTEN)\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return null;
      },
      fetchUserStatus: async (port) => {
        if (port === "56963") {
          return {
            userStatus: {
              email: "developer@example.com",
              userTier: {
                id: "g1-ultra-tier",
                name: "Google AI Ultra",
                description: "Google AI Ultra",
                availableCredits: [
                  {
                    creditType: "GOOGLE_ONE_AI",
                    creditAmount: "2980",
                    minimumCreditAmountForUsage: "50",
                  },
                ],
              },
              planStatus: {
                planInfo: {
                  planName: "Pro",
                },
              },
              quotaInfo: {
                remainingFraction: 0.85,
              },
              cascadeModelConfigData: {
                clientModelConfigs: [
                  {
                    label: "Gemini 3.7 Flash (High)",
                    quotaInfo: { remainingFraction: 0.15164408, resetTime: "2026-08-24T14:18:42Z" },
                    modelId: "gemini-3.7-flash-high",
                    allowedTiers: ["TEAMS_TIER_PRO"],
                  },
                  {
                    label: "Claude Sonnet 4.6 (Thinking)",
                    quotaInfo: { remainingFraction: 0.9, resetTime: "2026-08-24T17:49:16Z" },
                    modelId: "claude-sonnet-4.6",
                    allowedTiers: ["TEAMS_TIER_PRO"],
                  },
                  {
                    label: "GPT-OSS 120B (Medium)",
                    quotaInfo: { remainingFraction: 1.0, resetTime: "2026-08-24T17:49:16Z" },
                    modelId: "gpt-oss-120b",
                    allowedTiers: ["TEAMS_TIER_PRO"],
                  },
                ],
              },
            },
          };
        }
        return null;
      },
    };

    const collector = new AntigravityCollector(env);
    const result = await collector.probe();

    expect(result.platformId).toBe("antigravity");
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier1_cli_command");
    expect(result.metrics.length).toBe(4);

    const overallMetric = result.metrics.find((m) => m.rawMetricName === "overall_5_hour_quota");
    expect(overallMetric).toBeDefined();
    expect(overallMetric?.canonicalProvider).toBe("google");
    expect(overallMetric?.windowType).toBe("5_hour");
    expect(overallMetric?.remainingPercentage).toBe(85);
    expect(overallMetric?.confidence).toBe("verified_exact");

    const geminiMetric = result.metrics.find((m) => m.rawMetricName === "Gemini 3.7 Flash (High)");
    expect(geminiMetric).toBeDefined();
    expect(geminiMetric?.canonicalProvider).toBe("google");
    expect(geminiMetric?.windowType).toBe("5_hour");
    expect(geminiMetric?.remainingPercentage).toBe(15.16);
    expect(geminiMetric?.confidence).toBe("verified_exact");
    expect(geminiMetric?.rawPayload).toBeDefined();

    const claudeMetric = result.metrics.find(
      (m) => m.rawMetricName === "Claude Sonnet 4.6 (Thinking)",
    );
    expect(claudeMetric).toBeDefined();
    expect(claudeMetric?.canonicalProvider).toBe("anthropic");
    expect(claudeMetric?.windowType).toBe("5_hour");
    expect(claudeMetric?.remainingPercentage).toBe(90);

    const gptMetric = result.metrics.find((m) => m.rawMetricName === "GPT-OSS 120B (Medium)");
    expect(gptMetric).toBeDefined();
    expect(gptMetric?.canonicalProvider).toBe("openai");
    expect(gptMetric?.windowType).toBe("5_hour");
    expect(gptMetric?.remainingPercentage).toBe(100);

    expect(result.rawObservations.email).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("developer@example.com");
    expect(result.rawObservations.plan).toBe("Pro");
    expect(result.rawObservations.activePort).toBe("56963");
    expect(result.rawObservations.userTier).toBeDefined();
    expect(result.rawObservations.availableCredits).toBeDefined();
  });

  it("calculates remainingPercentage accurately with 2 decimal precision", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      fetchUserStatus: async () => ({
        cascadeModelConfigData: {
          clientModelConfigs: [
            {
              label: "Model Precision Test",
              quotaInfo: { remainingFraction: 0.15164408 },
            },
            {
              label: "Model Zero Test",
              quotaInfo: { remainingFraction: 0 },
            },
            {
              label: "Model Missing QuotaInfo Test",
            },
          ],
        },
      }),
    };

    const collector = new AntigravityCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.metrics).toHaveLength(3);
    expect(result.metrics[0]?.remainingPercentage).toBe(15.16);
    expect(result.metrics[0]?.confidence).toBe("verified_exact");
    expect(result.metrics[1]?.remainingPercentage).toBe(0);
    expect(result.metrics[1]?.confidence).toBe("verified_exact");
    expect(result.metrics[2]?.remainingPercentage).toBe(null);
    expect(result.metrics[2]?.confidence).toBe("unknown");
  });

  it("probes Tier 1 CLI successfully with legacy structured quota JSON when RPC is unavailable", async () => {
    const env: CollectorEnvironment = {
      exec: async (cmd, args) => {
        if (cmd === "agy" && args[0] === "quota") {
          return {
            stdout: JSON.stringify({ remaining_percentage: 75, model: "gemini-2.5-pro" }),
            stderr: "",
            exitCode: 0,
          };
        }
        return null;
      },
    };

    const collector = new AntigravityCollector(env);
    const result = await collector.probe();

    expect(result.platformId).toBe("antigravity");
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier1_cli_command");
    expect(result.metrics.length).toBe(1);
    expect(result.metrics[0]!.remainingPercentage).toBe(75);
    expect(result.metrics[0]!.canonicalProvider).toBe("google");
    expect(result.metrics[0]!.confidence).toBe("verified_exact");
  });

  it("probes Tier 1 CLI with version string fallback", async () => {
    const env: CollectorEnvironment = {
      exec: async (cmd, args) => {
        if (cmd === "agy" && args[0] === "--version") {
          return { stdout: "agy v2.1.0\n", stderr: "", exitCode: 0 };
        }
        return null;
      },
    };

    const collector = new AntigravityCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier1_cli_command");
    expect(result.metrics[0]!.remainingPercentage).toBeNull();
    expect(result.metrics[0]!.confidence).toBe("unknown");
    expect(result.rawObservations.version).toBe("agy v2.1.0");
  });

  it("escalates from Tier 1 to Tier 2 local storage", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      homedir: "/mock/home",
      readFile: async (path) => {
        if (path.includes("antigravity-cli/state.json")) {
          return JSON.stringify({ remainingPercentage: 60, user: "test@example.com" });
        }
        return null;
      },
    };

    const collector = new AntigravityCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier2_local_storage");
    expect(result.metrics[0]!.remainingPercentage).toBe(60);
    expect(result.metrics[0]!.confidence).toBe("cached");
  });

  it("escalates from Tier 2 to Tier 3 runtime environment", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      readFile: async () => null,
      env: { GEMINI_API_KEY: "mock-key", ANTIGRAVITY_APP_DIR: "/mock/app" },
    };

    const collector = new AntigravityCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier3_runtime");
    expect(result.metrics[0]!.remainingPercentage).toBeNull();
    expect(result.metrics[0]!.confidence).toBe("unknown");
    expect(result.rawObservations.detectedVariables).toEqual([
      "GEMINI_API_KEY",
      "ANTIGRAVITY_APP_DIR",
    ]);
  });

  it("returns not detected with terminal reason when all tiers fail", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      readFile: async () => null,
      env: {},
    };

    const collector = new AntigravityCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(false);
    expect(result.primaryTierUsed).toBeNull();
    expect(result.metrics).toHaveLength(0);
    expect(result.reason).toBe("Daemon Offline · No Quota in Storage");
  });

  it("preserves unmapped empirical observations without data loss", () => {
    const rawDiscovery: PlatformProbeResult = {
      platformId: "custom_frontier_agent",
      isDetected: true,
      primaryTierUsed: "tier1_cli_command",
      metrics: [
        {
          rawMetricName: "Dynamic Burst Tokens",
          canonicalProvider: "custom",
          windowType: "burst",
          remainingPercentage: 82.5,
          sourceTier: "tier1_cli_command",
          confidence: "verified_exact",
          rawPayload: { burstRemaining: 82500, burstTotal: 100000 },
        },
      ],
      rawObservations: {
        vendorExperimentalFlag: "v2-active",
        discoveredSubcommands: ["--stats", "--quota-v2"],
      },
      errors: [],
    };

    expect(rawDiscovery.metrics[0]?.remainingPercentage).toBe(82.5);
    expect(rawDiscovery.rawObservations["vendorExperimentalFlag"]).toBe("v2-active");
  });
});
