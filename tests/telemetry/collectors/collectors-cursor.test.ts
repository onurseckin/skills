import { describe, expect, it } from "bun:test";
import {
  ClaudeCollector,
  CursorCollector,
  type CollectorEnvironment,
} from "../../../olt/scripts/src/telemetry/collectors/index.ts";

describe("Claude and Cursor Collector Integration", () => {
  describe("ClaudeCollector extended probing", () => {
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

      expect(result.platformId).toBe("claude");
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
});
