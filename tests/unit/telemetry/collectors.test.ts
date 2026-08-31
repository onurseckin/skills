import { describe, expect, it } from "bun:test";
import {
  AntigravityCollector,
  ClaudeCollector,
  CursorCollector,
  OpenAICollector,
  CodexCollector,
  createDefaultCollectors,
  detectActiveHost,
  detectHostFromEnvironment,
  detectHostFromExplicit,
  detectHostFromModel,
  detectHostFromProcessTree,
  detectHostFromTerminal,
  isCanonicalHost,
  isPlatformMatchingHost,
  normalizeHostName,
  canonicalHostToPlatformId,
  platformIdToCanonicalHost,
  type CollectorEnvironment,
} from "../../../olt/scripts/src/telemetry/collectors/index.ts";

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
    expect(result.metrics.length).toBe(4); // 1 overall + 3 models

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
});

describe("ClaudeCollector", () => {
  it("probes Tier 1 Claude OAuth usage data successfully with 5-hour and 7-day limits", async () => {
    const env: CollectorEnvironment = {
      fetchClaudeUsage: async () => ({
        cachedUsageUtilization: {
          fetchedAtMs: Date.now(),
          utilization: {
            five_hour: { utilization: 25.5, resets_at: "2026-08-24T18:00:00Z" },
            seven_day: { utilization: 10.0, resets_at: "2026-08-30T00:00:00Z" },
            seven_day_opus: { utilization: 50.0 },
            seven_day_sonnet: { utilization: 15.0 },
            spend: { used: { amount_minor: 500, currency: "USD" } },
          },
        },
        oauthAccount: {
          emailAddress: "developer@example.com",
          accountUuid: "00000000-0000-0000-0000-000000000001",
          billingType: "stripe_subscription",
        },
      }),
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.platformId).toBe("claude");
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier1_cli_command");
    expect(result.metrics.length).toBe(4);
    expect(result.metrics[0]!.rawMetricName).toBe("Claude Code (5-Hour Window)");
    expect(result.metrics[0]!.remainingPercentage).toBe(74.5);
    expect(result.metrics[0]!.confidence).toBe("verified_exact");
    expect(result.metrics[1]!.rawMetricName).toBe("Claude Code (7-Day Weekly Limit)");
    expect(result.metrics[1]!.remainingPercentage).toBe(90.0);
    expect(result.metrics[2]!.rawMetricName).toBe("Claude Opus (7-Day Limit)");
    expect(result.metrics[2]!.remainingPercentage).toBe(50.0);
    expect(result.metrics[3]!.rawMetricName).toBe("Claude Sonnet (7-Day Limit)");
    expect(result.metrics[3]!.remainingPercentage).toBe(85.0);
    expect(result.rawObservations.email).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("developer@example.com");
  });

  it("probes Tier 1 CLI usage output when OAuth is unavailable", async () => {
    const env: CollectorEnvironment = {
      fetchClaudeUsage: async () => null,
      exec: async (cmd, args) => {
        if (cmd === "claude" && args[0] === "/usage") {
          return {
            stdout: JSON.stringify({ remaining_percentage: 82 }),
            stderr: "",
            exitCode: 0,
          };
        }
        return null;
      },
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.platformId).toBe("claude");
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier1_cli_command");
    expect(result.metrics[0]!.remainingPercentage).toBe(82);
    expect(result.metrics[0]!.canonicalProvider).toBe("anthropic");
    expect(result.metrics[0]!.confidence).toBe("verified_exact");
  });

  it("probes Tier 2 local storage ~/.claude.json cached utilization when daemon is offline", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      homedir: "/mock/home",
      readFile: async (path) => {
        if (path.endsWith(".claude.json")) {
          return JSON.stringify({
            cachedUsageUtilization: {
              utilization: {
                five_hour: { utilization: 40.0 },
                seven_day: { utilization: 20.0 },
                seven_day_sonnet: { utilization: 10.0 },
              },
            },
            oauthAccount: {
              emailAddress: "developer@example.com",
              billingType: "stripe_subscription",
              planTier: "claude_max",
            },
          });
        }
        return null;
      },
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.platformId).toBe("claude");
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier2_local_storage");
    expect(result.metrics.length).toBe(3);
    expect(result.metrics[0]!.remainingPercentage).toBe(60.0);
    expect(result.metrics[0]!.confidence).toBe("cached");
    expect(result.metrics[1]!.remainingPercentage).toBe(80.0);
    expect(result.metrics[1]!.confidence).toBe("cached");
    expect(result.metrics[2]!.remainingPercentage).toBe(90.0);
    expect(result.metrics[2]!.confidence).toBe("cached");
    expect(result.rawObservations.email).toBeUndefined();
    expect(result.rawObservations.billingType).toBeUndefined();
    expect(result.rawObservations.planTier).toBe("claude_max");
    expect(JSON.stringify(result)).not.toContain("developer@example.com");
    expect(JSON.stringify(result)).not.toContain("stripe_subscription");
  });

  it("probes Tier 2 local storage stats.json cache fallback", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      homedir: "/mock/home",
      readFile: async (path) => {
        if (path.includes(".claude/stats.json")) {
          return JSON.stringify({ remainingPercentage: 45 });
        }
        return null;
      },
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier2_local_storage");
    expect(result.metrics[0]!.remainingPercentage).toBe(45);
    expect(result.metrics[0]!.confidence).toBe("cached");
  });

  it("probes Tier 3 runtime environment for Claude", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      readFile: async () => null,
      env: { ANTHROPIC_API_KEY: "sk-ant-mock", CLAUDE_API_KEY: "claude-key" },
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier3_runtime");
    expect(result.metrics[0]!.remainingPercentage).toBeNull();
    expect(result.metrics[0]!.confidence).toBe("unknown");
    expect(result.rawObservations.detectedVariables).toEqual([
      "ANTHROPIC_API_KEY",
      "CLAUDE_API_KEY",
    ]);
  });

  it("returns not detected with terminal reason when all tiers fail for Claude", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      readFile: async () => null,
      env: {},
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(false);
    expect(result.primaryTierUsed).toBeNull();
    expect(result.metrics).toHaveLength(0);
    expect(result.reason).toBe("No Claude Session · No API Key");
  });
});

describe("CursorCollector", () => {
  it("probes Tier 1 CLI status output", async () => {
    const env: CollectorEnvironment = {
      exec: async (cmd, args) => {
        if (cmd === "cursor" && args[0] === "status") {
          return {
            stdout: JSON.stringify({ remaining_percentage: 90 }),
            stderr: "",
            exitCode: 0,
          };
        }
        return null;
      },
    };

    const collector = new CursorCollector(env);
    const result = await collector.probe();

    expect(result.platformId).toBe("cursor");
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier1_cli_command");
    expect(result.metrics[0]!.remainingPercentage).toBe(90);
  });

  it("probes Tier 2 local storage configuration", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      homedir: "/mock/home",
      readFile: async (path) => {
        if (path.includes("Cursor") && path.includes("storage.json")) {
          return JSON.stringify({ remainingPercentage: 30 });
        }
        return null;
      },
    };

    const collector = new CursorCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier2_local_storage");
    expect(result.metrics[0]!.remainingPercentage).toBe(30);
  });

  it("probes Tier 3 runtime environment", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      readFile: async () => null,
      env: { CURSOR_DIR: "/mock/cursor" },
    };

    const collector = new CursorCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier3_runtime");
  });
});

describe("OpenAICollector and CodexCollector", () => {
  it("probes OpenAI Tier 1 CLI output", async () => {
    const env: CollectorEnvironment = {
      exec: async (cmd, args) => {
        if (cmd === "openai" && args[0] === "quota") {
          return {
            stdout: JSON.stringify({ remaining_percentage: 50 }),
            stderr: "",
            exitCode: 0,
          };
        }
        return null;
      },
    };

    const collector = new OpenAICollector(env);
    const result = await collector.probe();

    expect(result.platformId).toBe("openai");
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier1_cli_command");
    expect(result.metrics[0]!.remainingPercentage).toBe(50);
  });

  it("probes OpenAI Tier 2 local storage cached fallback", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      homedir: "/mock/home",
      readFile: async (path) => {
        if (path.includes(".openai/usage.json")) {
          return JSON.stringify({ remainingPercentage: 55 });
        }
        return null;
      },
    };

    const collector = new OpenAICollector(env);
    const result = await collector.probe();

    expect(result.platformId).toBe("openai");
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier2_local_storage");
    expect(result.metrics[0]!.remainingPercentage).toBe(55);
    expect(result.metrics[0]!.confidence).toBe("cached");
  });

  it("probes OpenAI Tier 3 runtime environment", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      readFile: async () => null,
      env: { OPENAI_API_KEY: "sk-openai-key" },
    };

    const collector = new OpenAICollector(env);
    const result = await collector.probe();

    expect(result.platformId).toBe("openai");
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier3_runtime");
    expect(result.metrics[0]!.remainingPercentage).toBeNull();
    expect(result.metrics[0]!.confidence).toBe("unknown");
  });

  it("returns not detected with terminal reason when all tiers fail for OpenAI", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      readFile: async () => null,
      env: {},
    };

    const collector = new OpenAICollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(false);
    expect(result.primaryTierUsed).toBeNull();
    expect(result.metrics).toHaveLength(0);
    expect(result.reason).toBe("No Codex Sessions · No API Key");
  });

  it("probes CodexCollector Tier 1 live rollout token_count with future reset time and weekly window", async () => {
    const futureResetSec = Math.floor(Date.now() / 1000) + 7200;
    const env: CollectorEnvironment = {
      fetchCodexUsage: async () => ({
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 125000,
              cached_input_tokens: 85000,
              output_tokens: 15000,
              reasoning_output_tokens: 3500,
              total_tokens: 140000,
            },
            model_context_window: 258400,
          },
          rate_limits: {
            primary: {
              used_percent: 76.0,
              window_minutes: 10080,
              resets_at: futureResetSec,
            },
            plan_type: "prolite",
          },
        },
      }),
    };

    const collector = new CodexCollector(env);
    const result = await collector.probe();

    expect(result.platformId).toBe("codex");
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier1_cli_command");
    expect(result.metrics.length).toBe(1);

    const metric = result.metrics[0]!;
    expect(metric.rawMetricName).toBe("Codex (7-Day Limit)");
    expect(metric.canonicalProvider).toBe("openai");
    expect(metric.windowType).toBe("weekly");
    expect(metric.remainingPercentage).toBe(24.0);
    expect(metric.confidence).toBe("verified_exact");

    expect(result.rawObservations.plan_type).toBe("prolite");
    expect(result.rawObservations.resets_at).toBe(futureResetSec);
    expect(result.rawObservations.model_context_window).toBe(258400);
    expect(result.rawObservations.total_token_usage).toBeDefined();
  });

  it("evaluates time-aware quota decay to 100% when resets_at is in the past", async () => {
    const pastResetSec = Math.floor(Date.now() / 1000) - 300;
    const env: CollectorEnvironment = {
      fetchCodexUsage: async () => ({
        rate_limits: {
          primary: {
            used_percent: 85.0,
            window_minutes: 300,
            resets_at: pastResetSec,
          },
          plan_type: "prolite",
        },
      }),
    };

    const collector = new CodexCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.metrics[0]!.remainingPercentage).toBe(100.0);
    expect(result.metrics[0]!.windowType).toBe("5_hour");
    expect(result.metrics[0]!.rawMetricName).toBe("OpenAI Codex (5_hour)");
  });

  it("maps session window type when window_minutes is not 300 or 10080", async () => {
    const env: CollectorEnvironment = {
      fetchCodexUsage: async () => ({
        rate_limits: {
          primary: {
            used_percent: 35.5,
            window_minutes: 60,
          },
          plan_type: "free",
        },
      }),
    };

    const collector = new CodexCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.metrics[0]!.remainingPercentage).toBe(64.5);
    expect(result.metrics[0]!.windowType).toBe("session");
    expect(result.metrics[0]!.rawMetricName).toBe("OpenAI Codex (session)");
  });

  it("probes CodexCollector Tier 1 CLI output fallback when fetchCodexUsage is null", async () => {
    const env: CollectorEnvironment = {
      fetchCodexUsage: async () => null,
      exec: async (cmd, args) => {
        if (cmd === "codex" && args[0] === "quota") {
          return {
            stdout: JSON.stringify({ remaining_percentage: 65 }),
            stderr: "",
            exitCode: 0,
          };
        }
        return null;
      },
    };

    const collector = new CodexCollector(env);
    const result = await collector.probe();

    expect(result.platformId).toBe("codex");
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier1_cli_command");
    expect(result.metrics[0]!.remainingPercentage).toBe(65);
  });

  it("escalates CodexCollector from Tier 1 to Tier 2 local storage auth.json cache", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      homedir: "/mock/home",
      readFile: async (path) => {
        if (path.includes(".codex/auth.json")) {
          return JSON.stringify({ tokens: { access_token: "mock-token" }, plan_type: "plus" });
        }
        return null;
      },
    };

    const collector = new CodexCollector(env);
    const result = await collector.probe();

    expect(result.platformId).toBe("codex");
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier2_local_storage");
    expect(result.metrics[0]!.remainingPercentage).toBeNull();
    expect(result.metrics[0]!.confidence).toBe("unknown");
    expect(result.metrics[0]!.rawMetricName).toBe("cached_codex_auth");
  });

  it("escalates CodexCollector from Tier 1 to Tier 2 local storage usage.json", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      homedir: "/mock/home",
      readFile: async (path) => {
        if (path.includes(".codex/usage.json")) {
          return JSON.stringify({ remainingPercentage: 40 });
        }
        return null;
      },
    };

    const collector = new CodexCollector(env);
    const result = await collector.probe();

    expect(result.platformId).toBe("codex");
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier2_local_storage");
    expect(result.metrics[0]!.remainingPercentage).toBe(40);
    expect(result.metrics[0]!.confidence).toBe("cached");
  });

  it("escalates CodexCollector from Tier 2 to Tier 3 runtime environment", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      readFile: async () => null,
      env: { CODEX_API_KEY: "mock-codex" },
    };

    const collector = new CodexCollector(env);
    const result = await collector.probe();

    expect(result.platformId).toBe("codex");
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier3_runtime");
    expect(result.metrics[0]!.remainingPercentage).toBeNull();
    expect(result.metrics[0]!.confidence).toBe("unknown");
    expect(result.rawObservations.detectedVariables).toEqual(["CODEX_API_KEY"]);
  });

  it("returns not detected with terminal reason when all tiers fail for CodexCollector", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      readFile: async () => null,
      env: {},
    };

    const collector = new CodexCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(false);
    expect(result.primaryTierUsed).toBeNull();
    expect(result.metrics).toHaveLength(0);
    expect(result.reason).toBe("No Codex Sessions · No API Key");
  });
});

describe("createDefaultCollectors", () => {
  it("instantiates default frontier collectors", () => {
    const collectors = createDefaultCollectors();
    expect(collectors.length).toBe(5);
    const ids = collectors.map((c) => c.platformId);
    expect(ids).toContain("antigravity");
    expect(ids).toContain("claude");
    expect(ids).toContain("cursor");
    expect(ids).toContain("openai");
    expect(ids).toContain("codex");
  });
});

describe("Active Host Detection & Isolation", () => {
  describe("detectHostFromEnvironment", () => {
    it("detects antigravity from primary environment variables", () => {
      const sig1 = detectHostFromEnvironment({ ANTIGRAVITY_APP_DIR: "/app/dir" });
      expect(sig1?.host).toBe("antigravity");
      expect(sig1?.confidence).toBe("verified_exact");
      expect(sig1?.mechanism).toBe("environment");

      const sig2 = detectHostFromEnvironment({ GEMINI_CLI_HOME: "/home/gemini" });
      expect(sig2?.host).toBe("antigravity");
      expect(sig2?.confidence).toBe("verified_exact");
    });

    it("detects claude_code from primary environment variables", () => {
      const sig1 = detectHostFromEnvironment({ CLAUDE_PROJECT_DIR: "/proj" });
      expect(sig1?.host).toBe("claude_code");
      expect(sig1?.confidence).toBe("verified_exact");

      const sig2 = detectHostFromEnvironment({ CLAUDE_CODE_ENTRY: "/bin/claude" });
      expect(sig2?.host).toBe("claude_code");
      expect(sig2?.confidence).toBe("verified_exact");
    });

    it("detects codex from primary environment variables", () => {
      const sig1 = detectHostFromEnvironment({ CODEX_RUNTIME: "1" });
      expect(sig1?.host).toBe("codex");
      expect(sig1?.confidence).toBe("verified_exact");

      const sig2 = detectHostFromEnvironment({ CODEX_THREAD_ID: "th_123" });
      expect(sig2?.host).toBe("codex");
      expect(sig2?.confidence).toBe("verified_exact");
    });

    it("detects cursor from primary environment variables", () => {
      const sig1 = detectHostFromEnvironment({ CURSOR_PROJECT_DIR: "/cursor/proj" });
      expect(sig1?.host).toBe("cursor");
      expect(sig1?.confidence).toBe("verified_exact");

      const sig2 = detectHostFromEnvironment({ CURSOR_TRACE_ID: "trace_abc" });
      expect(sig2?.host).toBe("cursor");
      expect(sig2?.confidence).toBe("verified_exact");
    });

    it("detects hosts from secondary inferred environment variables", () => {
      expect(detectHostFromEnvironment({ ANTIGRAVITY_VERSION: "1.0.0" })?.host).toBe("antigravity");
      expect(detectHostFromEnvironment({ CLAUDE_CODE_VERSION: "2.1.0" })?.host).toBe("claude_code");
      expect(detectHostFromEnvironment({ CODEX_VERSION: "0.9.0" })?.host).toBe("codex");
      expect(detectHostFromEnvironment({ OPENCODE_CLI: "1" })?.host).toBe("codex");
      expect(detectHostFromEnvironment({ CURSOR_CHANNEL: "nightly" })?.host).toBe("cursor");
    });

    it("handles explicit environment host overrides", () => {
      const sig = detectHostFromEnvironment({ OVERRIDE_HOST: "codex" });
      expect(sig?.host).toBe("codex");
      expect(sig?.mechanism).toBe("explicit_override");
    });

    it("returns null when no matching environment variables exist", () => {
      expect(detectHostFromEnvironment({})).toBeNull();
    });
  });

  describe("detectHostFromProcessTree", () => {
    it("detects antigravity from process tree tokens", () => {
      const sig = detectHostFromProcessTree(["zsh", "agy", "bun"]);
      expect(sig?.host).toBe("antigravity");
      expect(sig?.confidence).toBe("inferred");
    });

    it("detects claude_code from process tree tokens", () => {
      const sig = detectHostFromProcessTree("node -> claude-code -> bun");
      expect(sig?.host).toBe("claude_code");
    });

    it("detects codex from process tree tokens", () => {
      const sig = detectHostFromProcessTree(["bash", "codex", "worker"]);
      expect(sig?.host).toBe("codex");
    });

    it("detects cursor from process tree tokens", () => {
      const sig = detectHostFromProcessTree("cursor -> zsh -> bun");
      expect(sig?.host).toBe("cursor");
    });

    it("returns null for non-matching process tree", () => {
      expect(detectHostFromProcessTree(["init", "systemd"])).toBeNull();
    });
  });

  describe("detectHostFromModel", () => {
    it("maps Gemini models to antigravity", () => {
      expect(detectHostFromModel("gemini-3.7-flash-high")?.host).toBe("antigravity");
      expect(detectHostFromModel("gemini-1.5-pro")?.host).toBe("antigravity");
    });

    it("maps Claude models to claude_code", () => {
      expect(detectHostFromModel("claude-sonnet-4-6")?.host).toBe("claude_code");
      expect(detectHostFromModel("claude-3-5-sonnet")?.host).toBe("claude_code");
    });

    it("maps OpenAI / Codex models to codex", () => {
      expect(detectHostFromModel("o3-mini")?.host).toBe("codex");
      expect(detectHostFromModel("o1-preview")?.host).toBe("codex");
      expect(detectHostFromModel("gpt-4o")?.host).toBe("codex");
      expect(detectHostFromModel("gpt-5-preview")?.host).toBe("codex");
      expect(detectHostFromModel("codex-davinci")?.host).toBe("codex");
    });

    it("maps Cursor models to cursor", () => {
      expect(detectHostFromModel("cursor-fast")?.host).toBe("cursor");
    });

    it("returns null for unmapped models", () => {
      expect(detectHostFromModel("llama-3-70b")).toBeNull();
      expect(detectHostFromModel("")).toBeNull();
    });
  });

  describe("detectHostFromTerminal", () => {
    it("detects cursor terminal from TERM_PROGRAM", () => {
      const sig = detectHostFromTerminal({ TERM_PROGRAM: "cursor" });
      expect(sig?.host).toBe("cursor");
      expect(sig?.confidence).toBe("heuristic");
    });
  });

  describe("detectActiveHost integration and precedence", () => {
    it("prioritizes explicit host over environment", () => {
      const res = detectActiveHost({
        explicitHost: "codex",
        env: { ANTIGRAVITY_APP_DIR: "/app" },
      });
      expect(res.activeHost).toBe("codex");
      expect(res.signal.mechanism).toBe("explicit_override");
    });

    it("prioritizes environment over process tree", () => {
      const res = detectActiveHost({
        env: { CLAUDE_PROJECT_DIR: "/proj" },
        processTree: ["agy", "bun"],
      });
      expect(res.activeHost).toBe("claude_code");
      expect(res.signal.mechanism).toBe("environment");
    });

    it("prioritizes process tree over model", () => {
      const res = detectActiveHost({
        processTree: ["cursor", "bun"],
        model: "gemini-3.7-flash",
      });
      expect(res.activeHost).toBe("cursor");
      expect(res.signal.mechanism).toBe("process_tree");
    });

    it("falls back to antigravity heuristic when no signature is matched", () => {
      const res = detectActiveHost({ env: {} });
      expect(res.activeHost).toBe("antigravity");
      expect(res.isFallback).toBe(true);
    });
  });

  describe("Canonical host helper utilities", () => {
    it("validates canonical hosts", () => {
      expect(isCanonicalHost("antigravity")).toBe(true);
      expect(isCanonicalHost("claude_code")).toBe(true);
      expect(isCanonicalHost("codex")).toBe(true);
      expect(isCanonicalHost("cursor")).toBe(true);
      expect(isCanonicalHost("vscode")).toBe(false);
    });

    it("normalizes diverse host representations", () => {
      expect(normalizeHostName("agy")).toBe("antigravity");
      expect(normalizeHostName("claude")).toBe("claude_code");
      expect(normalizeHostName("claude-code")).toBe("claude_code");
      expect(normalizeHostName("openai")).toBe("codex");
      expect(normalizeHostName("opencode")).toBe("codex");
      expect(normalizeHostName("cursor_agent")).toBe("cursor");
      expect(normalizeHostName("unknown")).toBeNull();
    });

    it("maps canonical hosts to primary platform IDs", () => {
      expect(canonicalHostToPlatformId("antigravity")).toBe("antigravity");
      expect(canonicalHostToPlatformId("claude_code")).toBe("claude");
      expect(canonicalHostToPlatformId("codex")).toBe("codex");
      expect(canonicalHostToPlatformId("cursor")).toBe("cursor");
      expect(platformIdToCanonicalHost("claude")).toBe("claude_code");
    });

    it("correctly matches platforms to canonical hosts", () => {
      expect(isPlatformMatchingHost("antigravity", "antigravity")).toBe(true);
      expect(isPlatformMatchingHost("claude", "claude_code")).toBe(true);
      expect(isPlatformMatchingHost("codex", "codex")).toBe(true);
      expect(isPlatformMatchingHost("openai", "codex")).toBe(true);
      expect(isPlatformMatchingHost("cursor", "cursor")).toBe(true);
      expect(isPlatformMatchingHost("claude", "antigravity")).toBe(false);
    });
  });

  describe("Collector External Cache Isolation", () => {
    it("isolates Claude storage cache when active host is Antigravity", async () => {
      const env: CollectorEnvironment = {
        activeHost: "antigravity",
        exec: async () => null,
        readFile: async (p) => {
          if (p.endsWith(".claude.json")) {
            return JSON.stringify({
              remainingPercentage: 0,
              cachedUsageUtilization: {
                utilization: {
                  five_hour: { utilization: 100 },
                },
              },
            });
          }
          return null;
        },
      };

      const collector = new ClaudeCollector(env);
      const res = await collector.probe();

      expect(res.isDetected).toBe(true);
      expect(res.primaryTierUsed).toBe("tier2_local_storage");
      expect(res.reason).toContain("Isolated External Cache");
      expect(res.metrics[0]?.remainingPercentage).toBe(0);
    });

    it("isolates Codex storage cache when active host is Claude Code", async () => {
      const env: CollectorEnvironment = {
        activeHost: "claude_code",
        exec: async () => null,
        readFile: async (p) => {
          if (p.endsWith("usage.json") || p.endsWith("session.json")) {
            return JSON.stringify({ remainingPercentage: 10 });
          }
          return null;
        },
      };

      const collector = new CodexCollector(env);
      const res = await collector.probe();

      expect(res.isDetected).toBe(true);
      expect(res.primaryTierUsed).toBe("tier2_local_storage");
      expect(res.reason).toContain("Isolated External Cache");
    });

    it("isolates Cursor storage cache when active host is Codex", async () => {
      const env: CollectorEnvironment = {
        activeHost: "codex",
        exec: async () => null,
        readFile: async (p) => {
          if (p.endsWith("storage.json") || p.endsWith("state.json")) {
            return JSON.stringify({ remainingPercentage: 5 });
          }
          return null;
        },
      };

      const collector = new CursorCollector(env);
      const res = await collector.probe();

      expect(res.isDetected).toBe(true);
      expect(res.primaryTierUsed).toBe("tier2_local_storage");
      expect(res.reason).toContain("Isolated External Cache");
    });

    it("enriches active model in Antigravity collector when activeModel is configured", async () => {
      const env: CollectorEnvironment = {
        activeHost: "antigravity",
        activeModel: "gemini-3.7-flash-high",
        exec: async (cmd) => {
          if (cmd === "lsof") {
            return {
              stdout: "agy 100 1u IPv4 0x1 0t0 TCP 127.0.0.1:4000 (LISTEN)\n",
              stderr: "",
              exitCode: 0,
            };
          }
          return null;
        },
        fetchUserStatus: async () => ({
          userStatus: {
            quotaInfo: { remainingFraction: 0.9 },
            cascadeModelConfigData: {
              clientModelConfigs: [
                {
                  label: "Gemini 3.7 Flash (High)",
                  modelId: "gemini-3.7-flash-high",
                  quotaInfo: { remainingFraction: 0.85 },
                },
                {
                  label: "Claude Sonnet 4.6",
                  modelId: "claude-sonnet-4.6",
                  quotaInfo: { remainingFraction: 0.4 },
                },
              ],
            },
          },
        }),
      };

      const collector = new AntigravityCollector(env);
      const res = await collector.probe();

      expect(res.isDetected).toBe(true);
      expect(res.rawObservations.name).toBe("gemini-3.7-flash-high");
      const activeMetric = res.metrics.find((m) => m.rawMetricName === "Gemini 3.7 Flash (High)");
      expect((activeMetric?.rawPayload as Record<string, unknown>).name).toBe(
        "gemini-3.7-flash-high",
      );
    });
  });
});
