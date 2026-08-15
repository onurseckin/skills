import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectHostModel,
  detectHostTelemetry,
  resolveModelTier,
} from "../../../orchestrating-long-tasks/scripts/src/summary/host-telemetry.ts";

function withTempHome(fn: (home: string) => void): void {
  const tempHome = mkdtempSync(join(tmpdir(), "telemetry-test-"));
  try {
    fn(tempHome);
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
}

describe("host telemetry and discovery", () => {
  describe("resolveModelTier", () => {
    const cases: Array<[string, "xs" | "s" | "m" | "l"]> = [
      ["Claude 3 Opus", "l"],
      ["claude-3-opus-20240229", "l"],
      ["Gemini 1.5 Pro", "l"],
      ["Gemini 3.7 Flash (High)", "l"],
      ["o1-preview", "l"],
      ["o3-mini", "l"],
      ["deepseek-r1-large", "l"],
      ["gemini-1.5-ultra", "l"],
      ["gpt-4o-max", "l"],
      ["DeepSeek-R1-671B", "l"],
      ["Claude 3.7 Sonnet (Thinking)", "m"],
      ["Claude 3.5 Sonnet", "m"],
      ["claude-sonnet-4", "m"],
      ["gpt-4o", "m"],
      ["unknown-custom-model", "m"],
      ["Claude 3.5 Haiku", "s"],
      ["Gemini 2.0 Flash", "s"],
      ["GPT-4o-mini", "s"],
      ["gemini-1.5-flash-8b", "s"],
      ["model-lite", "s"],
      ["small-coder", "s"],
      ["claude-instant-1.2", "s"],
      ["gemini-nano", "xs"],
      ["micro-model", "xs"],
      ["model-xs", "xs"],
    ];

    test("accurately classifies all models into expected tiers", () => {
      for (const [model, expected] of cases) {
        expect(resolveModelTier(model)).toBe(expected);
      }
    });
  });

  describe("Antigravity Adapter resolution", () => {
    test("resolves model and embedded thinking level from settings.json", () => {
      withTempHome((home) => {
        const agDir = join(home, ".gemini", "antigravity-cli");
        mkdirSync(agDir, { recursive: true });
        writeFileSync(
          join(agDir, "settings.json"),
          JSON.stringify({ model: "Gemini 3.7 Flash (High)" }),
        );
        const res = detectHostTelemetry(undefined, { homeDir: home, env: {} });
        expect(res.model).toBe("Gemini 3.7 Flash (High)");
        expect(res.tier).toBe("l");
        expect(res.hostAgent).toEqual({
          hostTool: "antigravity",
          modelName: "Gemini 3.7 Flash (High)",
          thinkingLevel: "high",
          modelTier: "l",
        });
      });
    });

    test("resolves separate model and thinkingLevel/reasoningEffort in settings.json", () => {
      withTempHome((home) => {
        const agDir = join(home, ".gemini", "antigravity-cli");
        mkdirSync(agDir, { recursive: true });
        writeFileSync(
          join(agDir, "settings.json"),
          JSON.stringify({ model: "gemini-2.5-pro", thinkingLevel: "high" }),
        );
        const r1 = detectHostTelemetry(undefined, { homeDir: home, env: {} });
        expect(r1.model).toBe("gemini-2.5-pro (High)");
        expect(r1.hostAgent?.thinkingLevel).toBe("high");

        writeFileSync(
          join(agDir, "settings.json"),
          JSON.stringify({ model: "gemini-2.5-flash", reasoningEffort: "medium" }),
        );
        const r2 = detectHostTelemetry(undefined, { homeDir: home, env: {} });
        expect(r2.model).toBe("gemini-2.5-flash (Medium)");
        expect(r2.hostAgent?.thinkingLevel).toBe("medium");
      });
    });

    test("handles case variations and deduplicates parenthesized thinking levels without double suffixes", () => {
      withTempHome((home) => {
        const agDir = join(home, ".gemini", "antigravity-cli");
        mkdirSync(agDir, { recursive: true });
        writeFileSync(
          join(agDir, "settings.json"),
          JSON.stringify({ model: "Gemini 3.7 Flash (High)", thinkingLevel: "HIGH" }),
        );
        const r1 = detectHostTelemetry(undefined, { homeDir: home, env: {} });
        expect(r1.model).toBe("Gemini 3.7 Flash (High)");
        expect(r1.hostAgent?.thinkingLevel).toBe("high");

        writeFileSync(
          join(agDir, "settings.json"),
          JSON.stringify({ model: "Gemini 3.7 Flash (High)", thinkingLevel: "medium" }),
        );
        const r2 = detectHostTelemetry(undefined, { homeDir: home, env: {} });
        expect(r2.model).toBe("Gemini 3.7 Flash (Medium)");
        expect(r2.hostAgent?.thinkingLevel).toBe("medium");
      });
    });

    test("safely handles corrupt, empty, whitespace, or invalid model in settings.json", () => {
      const edgeContents = [
        "invalid-json-content {{{",
        "",
        "   \n\t  \r\n  ",
        JSON.stringify({ model: "   ", thinkingLevel: "high" }),
        JSON.stringify({ model: 12345, otherProp: true }),
        JSON.stringify({}),
      ];
      for (const content of edgeContents) {
        withTempHome((home) => {
          const agDir = join(home, ".gemini", "antigravity-cli");
          mkdirSync(agDir, { recursive: true });
          writeFileSync(join(agDir, "settings.json"), content);
          expect(detectHostTelemetry(undefined, { homeDir: home, env: {} })).toEqual({});
        });
      }
    });
  });

  describe("Claude Code Adapter resolution", () => {
    test("resolves from CLAUDE_CODE_MODEL and ANTHROPIC_MODEL environment variables", () => {
      withTempHome((home) => {
        const r1 = detectHostTelemetry(undefined, {
          homeDir: home,
          env: { CLAUDE_CODE_MODEL: "claude-3-7-sonnet" },
        });
        expect(r1).toEqual({
          model: "claude-3-7-sonnet",
          tier: "m",
          hostAgent: { hostTool: "claude-code", modelName: "claude-3-7-sonnet", modelTier: "m" },
        });

        const r2 = detectHostTelemetry(undefined, {
          homeDir: home,
          env: { ANTHROPIC_MODEL: "claude-3-opus-20240229" },
        });
        expect(r2).toEqual({
          model: "claude-3-opus-20240229",
          tier: "l",
          hostAgent: {
            hostTool: "claude-code",
            modelName: "claude-3-opus-20240229",
            modelTier: "l",
          },
        });
      });
    });

    test("resolves from ~/.claude.json config file with model or currentModel", () => {
      withTempHome((home) => {
        writeFileSync(join(home, ".claude.json"), JSON.stringify({ model: "claude-3-5-haiku" }));
        expect(detectHostTelemetry(undefined, { homeDir: home, env: {} })).toEqual({
          model: "claude-3-5-haiku",
          tier: "s",
          hostAgent: { hostTool: "claude-code", modelName: "claude-3-5-haiku", modelTier: "s" },
        });

        writeFileSync(
          join(home, ".claude.json"),
          JSON.stringify({ currentModel: "claude-3-7-sonnet" }),
        );
        expect(detectHostTelemetry(undefined, { homeDir: home, env: {} })).toEqual({
          model: "claude-3-7-sonnet",
          tier: "m",
          hostAgent: { hostTool: "claude-code", modelName: "claude-3-7-sonnet", modelTier: "m" },
        });
      });
    });

    test("safely handles corrupt or empty ~/.claude.json", () => {
      for (const content of ["{ invalid: json", "   \n\t  ", ""]) {
        withTempHome((home) => {
          writeFileSync(join(home, ".claude.json"), content);
          expect(detectHostTelemetry(undefined, { homeDir: home, env: {} })).toEqual({});
        });
      }
    });
  });

  describe("Cursor Adapter & Custom Env resolution", () => {
    test("resolves and ignores empty/whitespace CURSOR_MODEL", () => {
      withTempHome((home) => {
        const r1 = detectHostTelemetry(undefined, {
          homeDir: home,
          env: { CURSOR_MODEL: "gpt-4o" },
        });
        expect(r1).toEqual({
          model: "gpt-4o",
          tier: "m",
          hostAgent: { hostTool: "cursor", modelName: "gpt-4o", modelTier: "m" },
        });

        const r2 = detectHostTelemetry(undefined, { homeDir: home, env: { CURSOR_MODEL: "   " } });
        expect(r2).toEqual({});
      });
    });

    test("resolves MODEL, AI_MODEL, GEMINI_MODEL, and ANTIGRAVITY_MODEL", () => {
      withTempHome((home) => {
        const envCases: Array<[Record<string, string>, string, "s" | "m" | "l"]> = [
          [{ MODEL: "custom-gemini-pro" }, "custom-gemini-pro", "l"],
          [{ AI_MODEL: "ai-model-test" }, "ai-model-test", "m"],
          [{ GEMINI_MODEL: "gemini-2.0-flash-exp" }, "gemini-2.0-flash-exp", "s"],
          [{ ANTIGRAVITY_MODEL: "antigravity-custom" }, "antigravity-custom", "m"],
        ];
        for (const [env, model, tier] of envCases) {
          const res = detectHostTelemetry(undefined, { homeDir: home, env });
          expect(res).toEqual({
            model,
            tier,
            hostAgent: { hostTool: "custom", modelName: model, modelTier: tier },
          });
        }
      });
    });

    test("ignores whitespace-only explicit environment variables", () => {
      withTempHome((home) => {
        expect(
          detectHostTelemetry(undefined, {
            homeDir: home,
            env: { MODEL: "   ", AI_MODEL: "\t", GEMINI_MODEL: "", ANTIGRAVITY_MODEL: "\n" },
          }),
        ).toEqual({});
      });
    });
  });

  describe("Zero Synthetic Default Fabrication & Environment Isolation", () => {
    test("returns empty object when no settings and no environment variables exist", () => {
      withTempHome((home) => {
        expect(detectHostTelemetry(undefined, { homeDir: home, env: {} })).toEqual({});
        expect(detectHostModel(undefined, { homeDir: home, env: {} })).toEqual({});
      });
    });

    test("returns empty object when home directory environment variables are missing or empty", () => {
      const res = detectHostTelemetry(undefined, {
        homeDir: "/non/existent/path/for/hermetic/testing",
        env: {
          HOME: "",
          USERPROFILE: "",
          CLAUDE_CODE_MODEL: "",
          ANTHROPIC_MODEL: "",
          CURSOR_MODEL: "",
          MODEL: "",
          AI_MODEL: "",
          GEMINI_MODEL: "",
          ANTIGRAVITY_MODEL: "",
        },
      });
      expect(res).toEqual({});
    });
  });

  describe("Active Host Discovery Integration", () => {
    test("discovers authentic host configuration in active environment", () => {
      const telemetry = detectHostTelemetry();
      expect(telemetry.hostAgent).toBeDefined();
      expect(telemetry.hostAgent?.hostTool).toBe("antigravity");
      expect(telemetry.model).toBe("Gemini 3.7 Flash (High)");
      expect(telemetry.tier).toBe("l");

      const host = detectHostModel();
      expect(host.model).toBe("Gemini 3.7 Flash (High)");
      expect(host.tier).toBe("l");
    });
  });
});
