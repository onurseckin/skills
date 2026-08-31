import { describe, expect, it } from "bun:test";
import {
  CodexCollector,
  OpenAICollector,
  createDefaultCollectors,
  type CollectorEnvironment,
} from "../../../olt/scripts/src/telemetry/collectors/index.ts";

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
