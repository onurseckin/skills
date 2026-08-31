import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evidenced } from "../../olt/scripts/src/core/contracts/index.ts";
import {
  ABSTRACT_PROFILES,
  formatHostDegradation,
  isAbstractProfile,
  isPerAgentModelSelectionSupported,
  resolveAgentProfile,
  resolveProfile,
  roleToProfile,
  type ProfileBindings,
} from "../../olt/scripts/src/roles/index.ts";

describe("Mind abstract profiles and host degradation", () => {
  test("maps canonical roles to correct abstract profiles per PLAN §10 / PHASE-4 §3.4", () => {
    expect(roleToProfile("mind")).toBe("deliberate");
    expect(roleToProfile("orchestrator")).toBe("deliberate");
    expect(roleToProfile("coordinator")).toBe("default");
    expect(roleToProfile("planner")).toBe("deliberate");
    expect(roleToProfile("implementer")).toBe("default");
    expect(roleToProfile("repairer")).toBe("default");
    expect(roleToProfile("sub-implementer")).toBe("default");
    expect(roleToProfile("validator")).toBe("adversarial");
    expect(roleToProfile("critic")).toBe("adversarial");
    expect(roleToProfile("completeness-critic")).toBe("adversarial");
    expect(roleToProfile("plan-validator")).toBe("adversarial");
    expect(roleToProfile("sub-validator")).toBe("adversarial");
    expect(roleToProfile("sub-investigator")).toBe("cheap_bulk");
    expect(roleToProfile("unknown-role")).toBeUndefined();
  });

  test("validates abstract profile names with isAbstractProfile", () => {
    expect(ABSTRACT_PROFILES).toEqual(["deliberate", "default", "adversarial", "cheap_bulk"]);
    for (const profile of ABSTRACT_PROFILES) {
      expect(isAbstractProfile(profile)).toBe(true);
    }
    expect(isAbstractProfile("claude")).toBe(false);
    expect(isAbstractProfile("gpt")).toBe(false);
    expect(isAbstractProfile("")).toBe(false);
    expect(isAbstractProfile(null)).toBe(false);
    expect(isAbstractProfile(undefined)).toBe(false);
  });

  test("resolves unbound profiles to unknown values without defaulting to hardcoded models", () => {
    const unboundDeliberate = resolveProfile("deliberate");
    expect(unboundDeliberate.bound).toBe(false);
    expect(unboundDeliberate.model).toBe("unknown");
    expect(unboundDeliberate.model_tier).toBe("unknown");
    expect(unboundDeliberate.thinking_level).toBe("unknown");
    expect(unboundDeliberate.effort).toBeUndefined();
    expect(unboundDeliberate.context_window).toBeUndefined();

    const emptyBindings: ProfileBindings = {};
    const unboundAdversarial = resolveProfile("adversarial", emptyBindings);
    expect(unboundAdversarial.bound).toBe(false);
    expect(unboundAdversarial.model).toBe("unknown");
    expect(unboundAdversarial.model_tier).toBe("unknown");
    expect(unboundAdversarial.thinking_level).toBe("unknown");
  });

  test("resolves bound profiles when bindings are provided by owner configuration", () => {
    const bindings: ProfileBindings = {
      adversarial: {
        thinking_level: "high",
        model_tier: "l",
        effort: "high",
      },
      cheap_bulk: {
        thinking_level: "low",
        model_tier: "xs",
        context_window: 32_000,
      },
    };

    const boundAdversarial = resolveProfile("adversarial", bindings);
    expect(boundAdversarial.bound).toBe(true);
    expect(boundAdversarial.thinking_level).toBe("high");
    expect(boundAdversarial.model_tier).toBe("l");
    expect(boundAdversarial.effort).toBe("high");
    expect(boundAdversarial.model).toBe("unknown");

    const boundCheap = resolveProfile("cheap_bulk", bindings);
    expect(boundCheap.bound).toBe(true);
    expect(boundCheap.thinking_level).toBe("low");
    expect(boundCheap.model_tier).toBe("xs");
    expect(boundCheap.context_window).toBe(32_000);
  });

  test("formats honest host degradation string when per-agent model selection is unavailable", () => {
    expect(formatHostDegradation("antigravity")).toBe(
      "per-agent model selection unavailable on antigravity",
    );
    expect(formatHostDegradation("cursor")).toBe("per-agent model selection unavailable on cursor");
    expect(formatHostDegradation("custom-host")).toBe(
      "per-agent model selection unavailable on custom-host",
    );
  });

  test("detects per-agent model selection support from host capabilities", () => {
    expect(isPerAgentModelSelectionSupported()).toBe(false);
    expect(
      isPerAgentModelSelectionSupported({
        native_resume: evidenced(true, "derived"),
      }),
    ).toBe(false);
    expect(
      isPerAgentModelSelectionSupported({
        per_agent_model_selection: evidenced(false, "derived"),
      }),
    ).toBe(false);
    expect(
      isPerAgentModelSelectionSupported({
        per_agent_model_selection: evidenced(true, "derived"),
      }),
    ).toBe(true);
  });

  test("degrades honestly when host does not support per-agent selection", () => {
    const bindings: ProfileBindings = {
      adversarial: {
        thinking_level: "high",
        model_tier: "l",
      },
    };

    const resolution = resolveAgentProfile(
      "validator",
      "antigravity",
      { native_workspace_isolation: evidenced(true, "derived") },
      bindings,
    );

    expect(resolution.profile).toBe("adversarial");
    expect(resolution.supportedOnHost).toBe(false);
    expect(resolution.limitation).toBe("per-agent model selection unavailable on antigravity");
    expect(resolution.model).toBeUndefined();
    expect(resolution.model_tier).toBeUndefined();
    expect(resolution.thinking_level).toBeUndefined();
    expect(resolution.telemetryRecords).toEqual({});
  });

  test("emits evidenced telemetry when host supports per-agent selection and bindings exist", () => {
    const bindings: ProfileBindings = {
      deliberate: {
        thinking_level: "high",
        model_tier: "l",
        context_window: 200_000,
      },
    };

    const resolution = resolveAgentProfile(
      "planner",
      "codex",
      { per_agent_model_selection: evidenced(true, "derived") },
      bindings,
    );

    expect(resolution.profile).toBe("deliberate");
    expect(resolution.supportedOnHost).toBe(true);
    expect(resolution.limitation).toBeUndefined();
    expect(resolution.thinking_level).toEqual(evidenced("high", "agent_reported"));
    expect(resolution.model_tier).toEqual(evidenced("l", "agent_reported"));
    expect(resolution.context_window).toEqual(evidenced(200_000, "agent_reported"));
    expect(resolution.telemetryRecords.thinking_level).toBeDefined();
    expect(resolution.telemetryRecords.model_tier).toBeDefined();
    expect(resolution.telemetryRecords.context_window).toBeDefined();
  });

  test("handles unknown roles gracefully in resolveAgentProfile", () => {
    const resolution = resolveAgentProfile("mystery-role", "antigravity");
    expect(resolution.profile).toBe("unknown");
    expect(resolution.supportedOnHost).toBe(false);
    expect(resolution.limitation).toBe("per-agent model selection unavailable on antigravity");
  });

  test("enforces 0 hardcoded vendor model names in profiles.ts source", () => {
    const profilesPath = join(import.meta.dir, "../../../olt/scripts/src/roles/profiles.ts");
    const content = readFileSync(profilesPath, "utf-8");

    const prohibitedVendorKeywords = [
      /claude-3/i,
      /claude-opus/i,
      /claude-sonnet/i,
      /claude-haiku/i,
      /gpt-4/i,
      /gpt-3/i,
      /gemini-1/i,
      /gemini-2/i,
      /gemini-pro/i,
      /gemini-flash/i,
      /o1-preview/i,
      /o1-mini/i,
      /o3-mini/i,
      /deepseek-r1/i,
      /deepseek-v3/i,
    ];

    for (const pattern of prohibitedVendorKeywords) {
      expect(pattern.test(content)).toBe(false);
    }
  });
});
