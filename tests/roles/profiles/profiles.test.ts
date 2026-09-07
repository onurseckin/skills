import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { evidenced } from "../../../olt/scripts/src/core/contracts/index.ts";
import * as profilesModule from "../../../olt/scripts/src/roles/profiles.ts";
import {
  ABSTRACT_PROFILES,
  ABSTRACT_PROFILE_SET,
  formatHostDegradation,
  isAbstractProfile,
  isPerAgentModelSelectionSupported,
  resolveAgentProfile,
  resolveProfile,
  resolveRoleArchetype,
  roleToProfile,
  type ProfileBindings,
} from "../../../olt/scripts/src/roles/index.ts";
import { cleanupVirtualRolesFS, getVirtualRolesFS, setupVirtualRolesFS } from "../fixture.ts";

const PROFILES_PATH = join(import.meta.dir, "../../../olt/scripts/src/roles/profiles.ts");
const PROFILES_CONTENT = Object.values(profilesModule)
  .map((v) => (typeof v === "function" ? v.toString() : JSON.stringify(v)))
  .join("\n");

describe("Roles abstract profiles and resolution", () => {
  beforeEach(() => {
    const vfs = setupVirtualRolesFS();
    vfs.mkdirSync(dirname(PROFILES_PATH), { recursive: true });
    vfs.writeFileSync(PROFILES_PATH, PROFILES_CONTENT);
  });

  afterEach(() => {
    cleanupVirtualRolesFS();
  });

  test("maps canonical roles to correct abstract profiles", () => {
    expect(roleToProfile("mind")).toBe("deliberate");
    expect(roleToProfile("orchestrator")).toBe("deliberate");
    expect(roleToProfile("coordinator")).toBe("default");
    expect(roleToProfile("planner")).toBe("deliberate");
    expect(roleToProfile("implementer")).toBe("default");
    expect(roleToProfile("sub-implementer")).toBe("default");
    expect(roleToProfile("validator")).toBe("adversarial");
    expect(roleToProfile("critic")).toBe("adversarial");
    expect(roleToProfile("completeness-critic")).toBe("adversarial");
    expect(roleToProfile("plan-validator")).toBe("adversarial");
    expect(roleToProfile("sub-validator")).toBe("adversarial");
    expect(roleToProfile("sub-investigator")).toBe("cheap_bulk");
    expect(roleToProfile("unknown-role")).toBeUndefined();
  });

  test("resolves role archetypes with heuristic fallbacks for dynamic roles", () => {
    expect(resolveRoleArchetype("validator-code-quality")).toBe("adversarial");
    expect(resolveRoleArchetype("validator-security")).toBe("adversarial");
    expect(resolveRoleArchetype("custom-critic")).toBe("adversarial");
    expect(resolveRoleArchetype("sub-investigator")).toBe("cheap_bulk");
    expect(resolveRoleArchetype("investigator-perf")).toBe("cheap_bulk");
    expect(resolveRoleArchetype("mind")).toBe("deliberate");
    expect(resolveRoleArchetype("orchestrator-wave")).toBe("deliberate");
    expect(resolveRoleArchetype("planner-arch")).toBe("deliberate");
    expect(resolveRoleArchetype("custom-implementer")).toBe("default");
    expect(resolveRoleArchetype("custom-specialist")).toBe("default");
  });

  test("validates abstract profiles with isAbstractProfile", () => {
    expect(ABSTRACT_PROFILES).toEqual(["deliberate", "default", "adversarial", "cheap_bulk"]);
    expect(ABSTRACT_PROFILE_SET.size).toBe(4);
    for (const profile of ABSTRACT_PROFILES) {
      expect(isAbstractProfile(profile)).toBe(true);
    }
    expect(isAbstractProfile("custom")).toBe(false);
    expect(isAbstractProfile(123)).toBe(false);
    expect(isAbstractProfile(null)).toBe(false);
  });

  test("resolves unbound profiles to unknown values", () => {
    const unbound = resolveProfile("deliberate");
    expect(unbound.bound).toBe(false);
    expect(unbound.model).toBe("unknown");
    expect(unbound.model_tier).toBe("unknown");
    expect(unbound.thinking_level).toBe("unknown");
    expect(unbound.effort).toBeUndefined();
    expect(unbound.context_window).toBeUndefined();
  });

  test("resolves empty or partial profile bindings safely", () => {
    const emptyBindings = resolveProfile("deliberate", {});
    expect(emptyBindings.bound).toBe(false);
    expect(emptyBindings.model).toBe("unknown");

    const partialEmpty = resolveProfile("deliberate", { deliberate: {} });
    expect(partialEmpty.bound).toBe(false);
  });

  test("resolves bound profiles with owner configuration", () => {
    const bindings: ProfileBindings = {
      adversarial: {
        thinking_level: "high",
        model_tier: "l",
        effort: "high",
        context_window: 100_000,
      },
    };
    const bound = resolveProfile("adversarial", bindings);
    expect(bound.bound).toBe(true);
    expect(bound.thinking_level).toBe("high");
    expect(bound.model_tier).toBe("l");
    expect(bound.effort).toBe("high");
    expect(bound.context_window).toBe(100_000);
  });

  test("formats host degradation string", () => {
    expect(formatHostDegradation("antigravity")).toBe(
      "per-agent model selection unavailable on antigravity",
    );
  });

  test("detects per-agent model selection support", () => {
    expect(isPerAgentModelSelectionSupported()).toBe(false);
    expect(
      isPerAgentModelSelectionSupported({ per_agent_model_selection: evidenced(true, "derived") }),
    ).toBe(true);
  });

  test("resolves agent profiles with host degradation", () => {
    const res = resolveAgentProfile("validator", "antigravity");
    expect(res.profile).toBe("adversarial");
    expect(res.supportedOnHost).toBe(false);
    expect(res.limitation).toBe("per-agent model selection unavailable on antigravity");
  });

  test("resolves agent profiles with full host capabilities and telemetry", () => {
    const bindings: ProfileBindings = {
      deliberate: {
        model_tier: "l",
        thinking_level: "high",
        context_window: 200_000,
      },
    };
    const res = resolveAgentProfile(
      "mind",
      "custom-host",
      { per_agent_model_selection: evidenced(true, "derived") },
      bindings,
    );
    expect(res.supportedOnHost).toBe(true);
    expect(res.profile).toBe("deliberate");
    expect(res.model_tier?.value).toBe("l");
    expect(res.thinking_level?.value).toBe("high");
    expect(res.context_window?.value).toBe(200_000);
  });

  test("enforces 0 hardcoded vendor model names (including emerging variants) in profiles.ts source", () => {
    const vfs = getVirtualRolesFS();
    const content = vfs.readFileSync(PROFILES_PATH, "utf-8");

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

    expect(/claude-3/i.test("claude-3-5-sonnet")).toBe(true);
    expect(/gpt-4/i.test("gpt-4o")).toBe(true);
    expect(/gemini-2/i.test("gemini-2.5-pro")).toBe(true);
  });
});
