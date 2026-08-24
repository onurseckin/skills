import { describe, expect, it } from "bun:test";
import {
  AntigravityCollector,
  ClaudeCollector,
  CursorCollector,
  OpenAICollector,
  CodexCollector,
  createDefaultCollectors,
  type CollectorEnvironment,
} from "../../../olt/scripts/src/telemetry/collectors/index.ts";

describe("AntigravityCollector", () => {
  it("probes Tier 1 CLI successfully with structured quota JSON", async () => {
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
    expect(result.metrics[0]!.confidence).toBe("inferred_metric");
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
    expect(result.metrics[0]!.confidence).toBe("inferred_metric");
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
    expect(result.metrics[0]!.confidence).toBe("heuristic");
    expect(result.rawObservations.detectedVariables).toEqual([
      "GEMINI_API_KEY",
      "ANTIGRAVITY_APP_DIR",
    ]);
  });

  it("returns not detected when all tiers fail", async () => {
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
  });
});

describe("ClaudeCollector", () => {
  it("probes Tier 1 CLI usage output", async () => {
    const env: CollectorEnvironment = {
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
  });

  it("probes Tier 2 local storage cache", async () => {
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
  });

  it("probes Tier 3 runtime environment", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      readFile: async () => null,
      env: { ANTHROPIC_API_KEY: "sk-ant-mock" },
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier3_runtime");
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

  it("probes CodexCollector with platformId codex", async () => {
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
