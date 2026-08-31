import { describe, expect, it } from "bun:test";
import {
  DefaultCollectorEnvironment,
  type CollectorEnvironment,
} from "../../../olt/scripts/src/telemetry/collectors/common.ts";
import {
  parseCliFallback,
  parseCodexStorage,
  parseOpenAIStorage,
  parseRuntimeEnv,
} from "../../../olt/scripts/src/telemetry/collectors/openai/fallback-parser.ts";
import { parseCodexRolloutUsage } from "../../../olt/scripts/src/telemetry/collectors/openai/rollout-parser.ts";
import {
  CodexCollector,
  OpenAICollector,
} from "../../../olt/scripts/src/telemetry/collectors/openai.ts";

describe("OpenAI & Codex Rollout and Fallback Parsers", () => {
  describe("parseCodexRolloutUsage", () => {
    it("returns null for non-object, null, or empty inputs", () => {
      expect(parseCodexRolloutUsage(null)).toBeNull();
      expect(parseCodexRolloutUsage(undefined)).toBeNull();
      expect(parseCodexRolloutUsage("not-an-object")).toBeNull();
      expect(parseCodexRolloutUsage(123)).toBeNull();
      expect(parseCodexRolloutUsage({})).toBeNull();
    });

    it("parses valid rollout usage with 5-hour window and active usage", () => {
      const sample = {
        rate_limits: {
          plan_type: "plus",
          primary: {
            used_percent: 25.5,
            window_minutes: 300,
            resets_at: Math.floor(Date.now() / 1000) + 7200,
          },
        },
        info: {
          total_token_usage: 45000,
          model_context_window: 128000,
        },
      };

      const result = parseCodexRolloutUsage(sample);
      expect(result).not.toBeNull();
      expect(result?.sourceTier).toBe("tier1_cli_command");
      expect(result?.metrics.length).toBe(1);

      const metric = result?.metrics[0];
      expect(metric?.canonicalProvider).toBe("openai");
      expect(metric?.windowType).toBe("5_hour");
      expect(metric?.rawMetricName).toBe("OpenAI Codex (5_hour)");
      expect(metric?.remainingPercentage).toBe(74.5);
      expect(metric?.confidence).toBe("verified_exact");
    });

    it("parses 7-day weekly window and handles expired resets_at as 100 percent remaining", () => {
      const pastEpochSec = Math.floor(Date.now() / 1000) - 100;
      const sample = {
        payload: {
          plan_type: "team",
          rate_limits: {
            primary: {
              used_percent: 80,
              window_minutes: 10080,
              resets_at: pastEpochSec,
            },
          },
        },
      };

      const result = parseCodexRolloutUsage(sample);
      expect(result).not.toBeNull();
      expect(result?.metrics[0]?.windowType).toBe("weekly");
      expect(result?.metrics[0]?.rawMetricName).toBe("Codex (7-Day Limit)");
      expect(result?.metrics[0]?.remainingPercentage).toBe(100.0);
    });

    it("handles ISO string reset timestamps and alternative field names", () => {
      const futureIso = new Date(Date.now() + 3600000).toISOString();
      const sample = {
        plan_type: "pro",
        rate_limits: {
          primary: {
            utilization: 40,
            windowMinutes: 60,
            resetTime: futureIso,
          },
        },
      };

      const result = parseCodexRolloutUsage(sample);
      expect(result).not.toBeNull();
      expect(result?.metrics[0]?.windowType).toBe("session");
      expect(result?.metrics[0]?.rawMetricName).toBe("OpenAI Codex (session)");
      expect(result?.metrics[0]?.remainingPercentage).toBe(60);
    });
  });

  describe("parseCliFallback", () => {
    it("parses valid JSON output from quota --json command", async () => {
      const env = new DefaultCollectorEnvironment({
        exec: async (cmd, args) => {
          if (cmd === "openai" && args.includes("quota")) {
            return {
              stdout: JSON.stringify({ remaining_percentage: 82.4 }),
              stderr: "",
              exitCode: 0,
            };
          }
          return null;
        },
      });

      const result = await parseCliFallback(env, "openai", "openai_tokens_remaining");
      expect(result).not.toBeNull();
      expect(result?.sourceTier).toBe("tier1_cli_command");
      expect(result?.metrics[0]?.remainingPercentage).toBe(82.4);
      expect(result?.metrics[0]?.confidence).toBe("verified_exact");
      expect(result?.metrics[0]?.rawMetricName).toBe("openai_tokens_remaining");
    });

    it("falls back to cli_presence when quota stdout is invalid JSON", async () => {
      const env = new DefaultCollectorEnvironment({
        exec: async (cmd, args) => {
          if (cmd === "codex" && args.includes("quota")) {
            return {
              stdout: "OpenAI CLI v1.2.3 quota unavailable",
              stderr: "",
              exitCode: 0,
            };
          }
          return null;
        },
      });

      const result = await parseCliFallback(env, "codex", "codex_tokens_remaining");
      expect(result).not.toBeNull();
      expect(result?.metrics[0]?.rawMetricName).toBe("cli_presence");
      expect(result?.metrics[0]?.remainingPercentage).toBeNull();
      expect(result?.metrics[0]?.confidence).toBe("unknown");
    });

    it("probes --version when quota command is unsupported", async () => {
      const env = new DefaultCollectorEnvironment({
        exec: async (cmd, args) => {
          if (cmd === "openai" && args.includes("--version")) {
            return {
              stdout: "openai 1.30.0\n",
              stderr: "",
              exitCode: 0,
            };
          }
          return null;
        },
      });

      const result = await parseCliFallback(env, "openai", "openai_tokens_remaining");
      expect(result).not.toBeNull();
      expect(result?.metrics[0]?.rawMetricName).toBe("cli_presence");
      expect(result?.rawObservations["version"]).toBe("openai 1.30.0");
    });

    it("returns null when neither quota nor version executes", async () => {
      const env = new DefaultCollectorEnvironment({
        exec: async () => null,
      });

      const result = await parseCliFallback(env, "openai", "openai_tokens_remaining");
      expect(result).toBeNull();
    });
  });

  describe("parseOpenAIStorage and parseCodexStorage", () => {
    it("extracts usage percentage from local JSON storage files", async () => {
      const env = new DefaultCollectorEnvironment({
        homedir: "/fake/home",
        readFile: async (path) => {
          if (path === "/fake/home/.openai/usage.json") {
            return JSON.stringify({ remainingPercentage: 65.5 });
          }
          return null;
        },
      });

      const result = await parseOpenAIStorage(env);
      expect(result).not.toBeNull();
      expect(result?.sourceTier).toBe("tier2_local_storage");
      expect(result?.metrics[0]?.remainingPercentage).toBe(65.5);
      expect(result?.metrics[0]?.confidence).toBe("cached");
    });

    it("extracts codex auth token or session metadata when usage percentage is absent", async () => {
      const env = new DefaultCollectorEnvironment({
        homedir: "/fake/home",
        readFile: async (path) => {
          if (path === "/fake/home/.codex/auth.json") {
            return JSON.stringify({ session_token: "sess_12345", account: "user@example.com" });
          }
          return null;
        },
      });

      const result = await parseCodexStorage(env);
      expect(result).not.toBeNull();
      expect(result?.metrics[0]?.rawMetricName).toBe("cached_codex_auth");
      expect(result?.metrics[0]?.remainingPercentage).toBeNull();
    });

    it("extracts codex config TOML metadata", async () => {
      const env = new DefaultCollectorEnvironment({
        homedir: "/fake/home",
        readFile: async (path) => {
          if (path === "/fake/home/.codex/config.toml") {
            return "[auth]\napi_key = 'sk-test'\nmodel = 'gpt-4o'";
          }
          return null;
        },
      });

      const result = await parseCodexStorage(env);
      expect(result).not.toBeNull();
      expect(result?.metrics[0]?.rawMetricName).toBe("cached_codex_config");
    });
  });

  describe("parseRuntimeEnv", () => {
    it("detects configured environment variables and returns tier3 result", () => {
      const env = {
        OPENAI_API_KEY: "sk-proj-test",
        OTHER_VAR: "value",
      };

      const result = parseRuntimeEnv(env, ["OPENAI_API_KEY", "CODEX_API_KEY"]);
      expect(result).not.toBeNull();
      expect(result?.sourceTier).toBe("tier3_runtime");
      expect(result?.metrics[0]?.rawMetricName).toBe("runtime_environment");
      expect(result?.metrics[0]?.confidence).toBe("unknown");
    });

    it("returns null when no target environment variables are present", () => {
      const env = {
        USER: "tester",
      };

      const result = parseRuntimeEnv(env, ["OPENAI_API_KEY", "CODEX_API_KEY"]);
      expect(result).toBeNull();
    });
  });

  describe("OpenAICollector and CodexCollector end-to-end integration", () => {
    it("collects metrics via tiered probing pipeline", async () => {
      const customEnv: CollectorEnvironment = {
        fetchCodexUsage: async () => ({
          rate_limits: {
            plan_type: "pro",
            primary: {
              used_percent: 15,
              window_minutes: 300,
            },
          },
        }),
      };

      const collector = new CodexCollector(customEnv);
      const snapshot = await collector.probe();

      expect(snapshot.platformId).toBe("codex");
      expect(snapshot.isDetected).toBe(true);
      expect(snapshot.metrics.length).toBe(1);
      expect(snapshot.metrics[0]?.remainingPercentage).toBe(85);
    });

    it("OpenAICollector falls back across tiers to terminal state when absent", async () => {
      const emptyEnv: CollectorEnvironment = {
        exec: async () => null,
        readFile: async () => null,
        env: {},
      };

      const collector = new OpenAICollector(emptyEnv);
      const snapshot = await collector.probe();

      expect(snapshot.platformId).toBe("openai");
      expect(snapshot.isDetected).toBe(false);
      expect(snapshot.reason).toBe("No Codex Sessions · No API Key");
    });
  });
});
