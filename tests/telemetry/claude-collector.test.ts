import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  ClaudeCollector,
  type CollectorEnvironment,
} from "../../olt/scripts/src/telemetry/collectors/index.ts";

describe("ClaudeCollector", () => {
  it("probes Tier 1 Claude OAuth usage data successfully with multiple quota windows", async () => {
    const env: CollectorEnvironment = {
      fetchClaudeUsage: async () => ({
        cachedUsageUtilization: {
          fetchedAtMs: 1787577547632,
          utilization: {
            five_hour: { utilization: 25.5, resets_at: "2026-08-24T18:00:00Z" },
            seven_day: { utilization: 10.0, resets_at: "2026-08-30T00:00:00Z" },
            seven_day_opus: { utilization: 40.0 },
            seven_day_sonnet: { utilization: 15.0 },
            spend: { used: { amount_minor: 500, currency: "USD" } },
            limits: [{ kind: "session", is_active: true }],
          },
        },
        oauthAccount: {
          emailAddress: "developer@example.com",
          accountUuid: "00000000-0000-0000-0000-000000000001",
          billingType: "stripe_subscription",
          planTier: "team_tier",
        },
      }),
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.platformId).toBe("claude");
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier1_cli_command");
    expect(result.metrics.length).toBe(4);

    const fiveHour = result.metrics.find((m) => m.windowType === "5_hour");
    expect(fiveHour).toBeDefined();
    expect(fiveHour?.rawMetricName).toBe("Claude Code (5-Hour Window)");
    expect(fiveHour?.remainingPercentage).toBe(74.5);
    expect(fiveHour?.confidence).toBe("verified_exact");
    expect(fiveHour?.canonicalProvider).toBe("anthropic");

    const weekly = result.metrics.find(
      (m) => m.rawMetricName === "Claude Code (7-Day Weekly Limit)",
    );
    expect(weekly).toBeDefined();
    expect(weekly?.remainingPercentage).toBe(90.0);

    const opus = result.metrics.find((m) => m.rawMetricName === "Claude Opus (7-Day Limit)");
    expect(opus).toBeDefined();
    expect(opus?.remainingPercentage).toBe(60.0);

    const sonnet = result.metrics.find((m) => m.rawMetricName === "Claude Sonnet (7-Day Limit)");
    expect(sonnet).toBeDefined();
    expect(sonnet?.remainingPercentage).toBe(85.0);

    expect(result.rawObservations.planTier).toBe("team_tier");
  });

  it("handles utilization boundary clamping for extreme percentages", async () => {
    const env: CollectorEnvironment = {
      fetchClaudeUsage: async () => ({
        cachedUsageUtilization: {
          utilization: {
            five_hour: { utilization: 120.0 },
            seven_day: { utilization: -15.0 },
          },
        },
      }),
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    const fiveHour = result.metrics.find((m) => m.windowType === "5_hour");
    expect(fiveHour?.remainingPercentage).toBe(0);
    const weekly = result.metrics.find((m) => m.windowType === "weekly");
    expect(weekly?.remainingPercentage).toBe(100);
  });

  it("probes Tier 1 CLI fallback via claude /usage --json", async () => {
    const env: CollectorEnvironment = {
      fetchClaudeUsage: async () => null,
      exec: async (cmd, args) => {
        if (cmd === "claude" && args[0] === "/usage" && args[1] === "--json") {
          return {
            stdout: JSON.stringify({ remaining_percentage: 42.5 }),
            stderr: "",
            exitCode: 0,
          };
        }
        return null;
      },
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier1_cli_command");
    expect(result.metrics.length).toBe(1);
    expect(result.metrics[0]?.rawMetricName).toBe("claude_session_tokens");
    expect(result.metrics[0]?.remainingPercentage).toBe(42.5);
    expect(result.metrics[0]?.confidence).toBe("verified_exact");
  });

  it("probes Tier 1 CLI fallback when claude /usage returns unparseable output", async () => {
    const env: CollectorEnvironment = {
      fetchClaudeUsage: async () => null,
      exec: async (cmd, args) => {
        if (cmd === "claude" && args[0] === "/usage") {
          return {
            stdout: "Claude CLI v1.0.0 (Usage: 50% used)",
            stderr: "",
            exitCode: 0,
          };
        }
        return null;
      },
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier1_cli_command");
    expect(result.metrics[0]?.rawMetricName).toBe("cli_presence");
    expect(result.metrics[0]?.remainingPercentage).toBeNull();
    expect(result.metrics[0]?.confidence).toBe("unknown");
  });

  it("probes Tier 1 CLI fallback via claude --version", async () => {
    const env: CollectorEnvironment = {
      fetchClaudeUsage: async () => null,
      exec: async (cmd, args) => {
        if (cmd === "claude" && args[0] === "--version") {
          return {
            stdout: "claude-code 0.2.29\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return null;
      },
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier1_cli_command");
    expect(result.metrics[0]?.rawMetricName).toBe("cli_presence");
    expect(result.metrics[0]?.remainingPercentage).toBeNull();
    expect(result.rawObservations.version).toBe("claude-code 0.2.29");
  });

  it("probes Tier 2 local storage from .claude.json cache", async () => {
    const mockHome = "/mock/home";
    const env: CollectorEnvironment = {
      fetchClaudeUsage: async () => null,
      exec: async () => null,
      homedir: mockHome,
      readFile: async (path) => {
        if (path === join(mockHome, ".claude.json")) {
          return JSON.stringify({
            cachedUsageUtilization: {
              utilization: {
                five_hour: { utilization: 30.0 },
                seven_day: { utilization: 20.0 },
              },
            },
            oauthAccount: {
              emailAddress: "cached@example.com",
              planTier: "pro",
            },
          });
        }
        return null;
      },
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier2_local_storage");
    expect(result.metrics.length).toBe(2);
    expect(result.metrics[0]?.remainingPercentage).toBe(70.0);
    expect(result.metrics[0]?.confidence).toBe("cached");
    expect(result.metrics[1]?.remainingPercentage).toBe(80.0);
    expect(result.rawObservations.storagePath).toBe(join(mockHome, ".claude.json"));
    expect(result.rawObservations.planTier).toBe("pro");
  });

  it("probes Tier 2 local storage with legacy remainingPercentage payload", async () => {
    const mockHome = "/mock/home";
    const env: CollectorEnvironment = {
      fetchClaudeUsage: async () => null,
      exec: async () => null,
      homedir: mockHome,
      readFile: async (path) => {
        if (path === join(mockHome, ".claude", "stats.json")) {
          return JSON.stringify({ remainingPercentage: 55 });
        }
        return null;
      },
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier2_local_storage");
    expect(result.metrics[0]?.rawMetricName).toBe("local_session_stats");
    expect(result.metrics[0]?.remainingPercentage).toBe(55);
    expect(result.metrics[0]?.confidence).toBe("cached");
  });

  it("probes Tier 3 runtime environment variables", async () => {
    const env: CollectorEnvironment = {
      fetchClaudeUsage: async () => null,
      exec: async () => null,
      readFile: async () => null,
      env: {
        ANTHROPIC_API_KEY: "sk-ant-test-key",
        CLAUDE_SESSION_ID: "session-12345",
      },
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier3_runtime");
    expect(result.metrics[0]?.rawMetricName).toBe("runtime_environment");
    expect(result.metrics[0]?.remainingPercentage).toBeNull();
    expect(result.metrics[0]?.confidence).toBe("unknown");
    expect(result.rawObservations.detectedVariables).toEqual([
      "ANTHROPIC_API_KEY",
      "CLAUDE_SESSION_ID",
    ]);
  });

  it("returns undetectable state with terminal reason when all tiers fail", async () => {
    const env: CollectorEnvironment = {
      fetchClaudeUsage: async () => null,
      exec: async () => null,
      readFile: async () => null,
      env: {},
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.platformId).toBe("claude");
    expect(result.isDetected).toBe(false);
    expect(result.primaryTierUsed).toBeNull();
    expect(result.metrics).toHaveLength(0);
    expect(result.reason).toBe("No Claude Session · No API Key");
  });
});
