import { describe, expect, test } from "bun:test";
import {
  normalizeRoleKey,
  resolveAgentHostConfiguration,
  resolveAgentModel,
  resolveAgentModelTier,
  resolveAgentThinkingEffort,
  resolveAgentTokenBudget,
} from "../../../olt/scripts/src/authority/host-bindings.ts";
import {
  agentBriefCommand,
  executeAgentBrief,
} from "../../../olt/scripts/src/cli/commands/agent-brief.ts";
import { generateDefaultRepoPolicy } from "../../../olt/scripts/src/policy/generator.ts";
import type { RepoPolicy } from "../../../olt/scripts/src/policy/types.ts";

describe("host-bindings", () => {
  const defaultPolicy = generateDefaultRepoPolicy();

  describe("normalizeRoleKey", () => {
    test("normalizes role aliases to canonical policy agent keys", () => {
      expect(normalizeRoleKey("mind")).toBe("mind_supervisor");
      expect(normalizeRoleKey("mind-supervisor")).toBe("mind_supervisor");
      expect(normalizeRoleKey("tier-0")).toBe("mind_supervisor");
      expect(normalizeRoleKey("critic")).toBe("completeness_critic");
      expect(normalizeRoleKey("completeness-critic")).toBe("completeness_critic");
      expect(normalizeRoleKey("validator")).toBe("validator_code_quality");
      expect(normalizeRoleKey("validator-code-quality")).toBe("validator_code_quality");
      expect(normalizeRoleKey("worker")).toBe("implementer");
      expect(normalizeRoleKey("repairer")).toBe("implementer");
      expect(normalizeRoleKey("tier-1")).toBe("orchestrator");
      expect(normalizeRoleKey("tier-2")).toBe("coordinator");
      expect(normalizeRoleKey("tier-3")).toBe("implementer");
      expect(normalizeRoleKey("ui-validator")).toBe("validator_ui_design");
      expect(normalizeRoleKey("owner")).toBe("owner");
      expect(normalizeRoleKey("")).toBe("");
    });
  });

  describe("resolveAgentHostConfiguration across canonical hosts", () => {
    test("resolves antigravity host bindings for mind supervisor", () => {
      const config = resolveAgentHostConfiguration("mind", "antigravity", defaultPolicy);
      expect(config.model).toBe("gemini-3.7-flash");
      expect(config.model_tier).toBe("high");
      expect(config.thinking_effort).toBe("high");
      expect(config.max_tokens).toBe(8192);
      expect(config.scheduler?.interval_seconds).toBe(300);
    });

    test("resolves claude_code host bindings for mind supervisor", () => {
      const config = resolveAgentHostConfiguration("mind_supervisor", "claude_code", defaultPolicy);
      expect(config.model).toBe("claude-5-opus");
      expect(config.model_tier).toBe("xhigh");
      expect(config.thinking_effort).toBe("high");
      expect(config.max_tokens).toBe(8192);
      expect(config.scheduler?.interval_seconds).toBe(900);
    });

    test("resolves codex host bindings for mind supervisor", () => {
      const config = resolveAgentHostConfiguration("mind", "codex", defaultPolicy);
      expect(config.model).toBe("gpt-5.6-sol");
      expect(config.model_tier).toBe("xhigh");
      expect(config.thinking_effort).toBe("high");
      expect(config.max_tokens).toBe(8192);
      expect(config.scheduler?.interval_seconds).toBe(900);
    });

    test("resolves cursor host bindings for mind supervisor", () => {
      const config = resolveAgentHostConfiguration("mind", "cursor", defaultPolicy);
      expect(config.model).toBe("cursor-latest");
      expect(config.model_tier).toBe("high");
      expect(config.thinking_effort).toBe("high");
      expect(config.max_tokens).toBe(8192);
      expect(config.scheduler?.interval_seconds).toBe(300);
    });

    test("resolves orchestrator bindings across hosts", () => {
      expect(resolveAgentModel("orchestrator", "antigravity", defaultPolicy)).toBe(
        "gemini-3.7-flash",
      );
      expect(resolveAgentModel("orchestrator", "claude_code", defaultPolicy)).toBe("claude-5-opus");
      expect(resolveAgentModel("orchestrator", "codex", defaultPolicy)).toBe("gpt-5.6-sol");
      expect(resolveAgentModel("orchestrator", "cursor", defaultPolicy)).toBe("cursor-latest");
    });

    test("resolves implementer and worker alias bindings across hosts", () => {
      expect(resolveAgentModel("implementer", "antigravity", defaultPolicy)).toBe(
        "gemini-3.7-flash",
      );
      expect(resolveAgentModel("worker", "claude_code", defaultPolicy)).toBe("claude-5-sonnet");
      expect(resolveAgentModel("repairer", "codex", defaultPolicy)).toBe("gpt-5.6-terra");
      expect(resolveAgentModel("implementer", "cursor", defaultPolicy)).toBe("cursor-latest");
    });
  });

  describe("helper functions", () => {
    test("resolveAgentModel returns exact model name", () => {
      const model = resolveAgentModel("critic", "claude_code", defaultPolicy);
      expect(model).toBe("claude-5-sonnet");
    });

    test("resolveAgentModelTier returns model tier", () => {
      expect(resolveAgentModelTier("mind", "claude_code", defaultPolicy)).toBe("xhigh");
      expect(resolveAgentModelTier("implementer", "claude_code", defaultPolicy)).toBe("high");
    });

    test("resolveAgentThinkingEffort returns thinking effort", () => {
      expect(resolveAgentThinkingEffort("mind", "antigravity", defaultPolicy)).toBe("high");
    });

    test("resolveAgentTokenBudget returns token budget or max tokens", () => {
      expect(resolveAgentTokenBudget("mind", "antigravity", defaultPolicy)).toBe(8192);

      const customPolicy: RepoPolicy = {
        ...defaultPolicy,
        agents: {
          ...defaultPolicy.agents,
          custom_role: {
            tier: 3,
            rbac: { can_execute_shell: false, can_edit_code: false },
            hosts: {
              antigravity: { model: "gemini-custom", model_tier: "high", token_budget: 16384 },
              claude_code: { model: "claude-custom", model_tier: "high", token_budget: 16384 },
              codex: { model: "gpt-custom", model_tier: "high", token_budget: 16384 },
              cursor: { model: "cursor-custom", model_tier: "high", token_budget: 16384 },
            },
          },
        },
      };

      expect(resolveAgentTokenBudget("custom_role", "antigravity", customPolicy)).toBe(16384);
    });
  });

  describe("host auto-detection and fallback", () => {
    test("uses detectActiveHost when host is omitted", () => {
      const orig = { ...process.env };
      try {
        delete process.env["ANTIGRAVITY_APP_DIR"];
        delete process.env["GEMINI_CLI_HOME"];
        delete process.env["CODEX_RUNTIME"];
        delete process.env["CODEX_THREAD_ID"];
        delete process.env["CURSOR_PROJECT_DIR"];
        delete process.env["CURSOR_TRACE_ID"];
        process.env["CLAUDE_PROJECT_DIR"] = "/tmp/test-claude";

        const config = resolveAgentHostConfiguration("mind", undefined, defaultPolicy);
        expect(config.model).toBe("claude-5-opus");
      } finally {
        process.env = orig;
      }
    });

    test("uses loadRepoPolicy when policy is omitted", () => {
      const config = resolveAgentHostConfiguration("mind", "antigravity");
      expect(config.model).toBe("gemini-3.7-flash");
    });
  });

  describe("error handling", () => {
    test("throws INVALID_ARGUMENT when role is empty or invalid", () => {
      expect(() => resolveAgentHostConfiguration("", "antigravity", defaultPolicy)).toThrow(
        /Role name must be a non-empty string/i,
      );
      expect(() => resolveAgentHostConfiguration("   ", "antigravity", defaultPolicy)).toThrow(
        /Role name must be a non-empty string/i,
      );
    });

    test("throws INVALID_ARGUMENT when role cannot be resolved", () => {
      expect(() =>
        resolveAgentHostConfiguration(
          "nonexistent_unknown_agent_role_xyz",
          "antigravity",
          defaultPolicy,
        ),
      ).toThrow(/Cannot resolve agent role/i);
    });

    test("throws INTEGRITY when host configuration is missing for a role", () => {
      const brokenPolicy: RepoPolicy = {
        ...defaultPolicy,
        agents: {
          incomplete_agent: {
            tier: 3,
            rbac: { can_execute_shell: false, can_edit_code: false },
            hosts: {
              antigravity: { model: "m", model_tier: "high" },
            } as unknown as Record<
              "antigravity" | "claude_code" | "codex" | "cursor",
              { model: string; model_tier: "high" }
            >,
          },
        },
      };

      expect(() =>
        resolveAgentHostConfiguration("incomplete_agent", "claude_code", brokenPolicy),
      ).toThrow(/Missing host configuration for role/i);
    });
  });

  describe("executeAgentBrief integration", () => {
    test("renders model bindings for mind role without (None) stubs", () => {
      const brief = executeAgentBrief({ role: "mind" });

      expect(brief).toContain("SECTION 1: SYSTEM IDENTITY & HOST TOOL PROTOCOL");
      expect(brief).toContain("gemini-3.7-flash");
      expect(brief).toContain("claude-5-opus");
      expect(brief).toContain("gpt-5.6-sol");
      expect(brief).toContain("cursor-latest");

      expect(brief).toContain("SECTION 3: REPOSITORY POLICY & PERMISSION BOUNDARIES");
      expect(brief).toContain("ALLOWED COMMANDS:");
      expect(brief).toContain("mind:pulse");
      expect(brief).not.toContain("ALLOWED COMMANDS:\n  (None)");
    });

    test("renders specific active host binding when host is passed", () => {
      const brief = executeAgentBrief({ role: "mind", host: "claude_code" });
      expect(brief).toContain("ACTIVE HOST: claude_code");
      expect(brief).toContain("MODEL BINDING: claude-5-opus (Tier: xhigh)");
      expect(brief).toContain("THINKING EFFORT: high");
    });

    test("agentBriefCommand accepts --host flag and outputs valid markdown", async () => {
      const result = await agentBriefCommand({ role: "mind", host: "codex" });
      const markdown = String(result["markdown"]);

      expect(markdown).toContain("ACTIVE HOST: codex");
      expect(markdown).toContain("MODEL BINDING: gpt-5.6-sol (Tier: xhigh)");
      expect(markdown).toContain("gpt-5.6-sol");
    });
  });
});
