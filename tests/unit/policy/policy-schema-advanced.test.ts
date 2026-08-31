import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { parseRepoPolicy } from "../../../olt/scripts/src/policy/index.ts";
import { canonicalHosts, canonicalPolicy } from "./policy-schema-core.test.ts";

function setField(obj: Record<string, unknown>, path: readonly string[], val: unknown): void {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (key !== undefined) {
      const next = cur[key];
      if (next && typeof next === "object") {
        cur = next as Record<string, unknown>;
      }
    }
  }
  const lastKey = path[path.length - 1];
  if (lastKey !== undefined) {
    cur[lastKey] = val;
  }
}

describe("Policy Schema Advanced - Host Profiles & Persona Enums", () => {
  test("rejects invalid or missing host profiles in agent configuration", () => {
    const raw = canonicalPolicy();
    const agents = raw["agents"] as Record<string, Record<string, unknown>>;
    const ms = agents["mind_supervisor"] as Record<string, unknown>;
    ms["hosts"] = { ...canonicalHosts(), unknown_host: { model: "m", model_tier: "high" } };
    expect(() => parseRepoPolicy(raw)).toThrow(HarnessError);

    const rawMissing = canonicalPolicy();
    setField(rawMissing, ["agents", "mind_supervisor", "hosts"], { antigravity: { model: "m", model_tier: "high" } });
    expect(() => parseRepoPolicy(rawMissing)).toThrow(HarnessError);
  });

  test("rejects invalid model_tier, thinking_effort, and persona roles", () => {
    const rawTier = canonicalPolicy();
    setField(rawTier, ["agents", "mind_supervisor", "hosts", "antigravity", "model_tier"], "ultra_tier");
    expect(() => parseRepoPolicy(rawTier)).toThrow(HarnessError);

    const rawEffort = canonicalPolicy();
    setField(rawEffort, ["agents", "mind_supervisor", "hosts", "antigravity", "thinking_effort"], "extreme");
    expect(() => parseRepoPolicy(rawEffort)).toThrow(HarnessError);

    const rawPersona = canonicalPolicy();
    setField(rawPersona, ["docker_environment", "test_user_personas", "guest", "role"], "superadmin");
    expect(() => parseRepoPolicy(rawPersona)).toThrow(HarnessError);
  });

  test("rejects invalid cookie same_site values", () => {
    const raw = canonicalPolicy();
    setField(raw, ["docker_environment", "session_cookie_templates", "session_id", "same_site"], "Loose");
    expect(() => parseRepoPolicy(raw)).toThrow(HarnessError);
  });
});


describe("Policy Schema Advanced - Numeric Bounds, Types & Command Conflicts", () => {
  test("rejects negative quotas and invalid quota ranges", () => {
    const raw = canonicalPolicy();
    setField(raw, ["agents", "validator_code_quality", "quotas", "mandatory_cognitive_pushbacks"], -1);
    expect(() => parseRepoPolicy(raw)).toThrow(HarnessError);

    const rawOver = canonicalPolicy();
    setField(rawOver, ["agents", "validator_code_quality", "quotas", "mandatory_cognitive_pushbacks"], 101);
    expect(() => parseRepoPolicy(rawOver)).toThrow(HarnessError);
  });

  test("rejects negative or fractional neighborhood depths and timeouts", () => {
    expect(() =>
      parseRepoPolicy({ ...canonicalPolicy(), read_scope_neighborhood_depth: -5 }),
    ).toThrow(HarnessError);
    expect(() =>
      parseRepoPolicy({ ...canonicalPolicy(), read_scope_neighborhood_depth: 3.14 }),
    ).toThrow(HarnessError);
    const rawTimeout = canonicalPolicy();
    setField(rawTimeout, ["test_runner", "timeout_ms"], -100);
    expect(() => parseRepoPolicy(rawTimeout)).toThrow(HarnessError);
  });

  test("rejects string representation where boolean is expected", () => {
    const raw = canonicalPolicy();
    setField(raw, ["agents", "mind_supervisor", "rbac", "can_execute_shell"], "false");
    expect(() => parseRepoPolicy(raw)).toThrow(HarnessError);
  });

  test("rejects overlapping allowed_commands and forbidden_commands", () => {
    const raw = {
      ...canonicalPolicy(),
      allowed_commands: ["bun test", "git commit", "ls"],
      forbidden_commands: ["git commit", "git push"],
    };
    expect(() => parseRepoPolicy(raw)).toThrow(HarnessError);
    try {
      parseRepoPolicy(raw);
    } catch (err) {
      expect((err as HarnessError).code).toBe("INTEGRITY");
      expect((err as Error).message).toContain("git commit");
    }
  });

  test("rejects duplicate command definitions within allowed_commands", () => {
    const raw = {
      ...canonicalPolicy(),
      allowed_commands: ["bun test", "bun test"],
    };
    expect(() => parseRepoPolicy(raw)).toThrow(HarnessError);
  });

  test("validates docker containers array ports and required fields", () => {
    const rawNoPorts = canonicalPolicy();
    setField(rawNoPorts, ["docker_environment", "containers", "web_app", "ports"], "3000:3000");
    expect(() => parseRepoPolicy(rawNoPorts)).toThrow(HarnessError);

    const rawEmptyPort = canonicalPolicy();
    setField(rawEmptyPort, ["docker_environment", "containers", "web_app", "ports"], [""]);
    expect(() => parseRepoPolicy(rawEmptyPort)).toThrow(HarnessError);
  });
});


describe("Policy Schema Advanced - Lifecycle Hooks", () => {
  test("parses valid lifecycle hooks configuration with all event types", () => {
    const raw = {
      ...canonicalPolicy(),
      hooks: {
        on_phase_completion: ["bun test", "git status"],
        on_release_push: ["echo releasing"],
        on_task_completion: ["bun run typecheck"],
        on_wave_completion: ["echo wave done"],
        on_error: ["echo error occurred"],
      },
    };
    const policy = parseRepoPolicy(raw);
    expect(policy.hooks).toBeDefined();
    expect(policy.hooks?.on_phase_completion).toEqual(["bun test", "git status"]);
    expect(policy.hooks?.on_release_push).toEqual(["echo releasing"]);
    expect(policy.hooks?.on_task_completion).toEqual(["bun run typecheck"]);
    expect(policy.hooks?.on_wave_completion).toEqual(["echo wave done"]);
    expect(policy.hooks?.on_error).toEqual(["echo error occurred"]);
  });

  test("parses partial lifecycle hooks configuration", () => {
    const raw = {
      ...canonicalPolicy(),
      hooks: {
        on_phase_completion: ["bun test"],
      },
    };
    const policy = parseRepoPolicy(raw);
    expect(policy.hooks).toBeDefined();
    expect(policy.hooks?.on_phase_completion).toEqual(["bun test"]);
    expect(policy.hooks?.on_release_push).toBeUndefined();
  });

  test("rejects unknown keys in hooks object", () => {
    const raw = {
      ...canonicalPolicy(),
      hooks: {
        on_invalid_event: ["echo invalid"],
      },
    };
    expect(() => parseRepoPolicy(raw)).toThrow(HarnessError);
  });

  test("rejects non-object hooks configuration", () => {
    const raw = {
      ...canonicalPolicy(),
      hooks: "invalid",
    };
    expect(() => parseRepoPolicy(raw)).toThrow(HarnessError);
  });

  test("rejects non-array hook commands", () => {
    const raw = {
      ...canonicalPolicy(),
      hooks: {
        on_phase_completion: "bun test",
      },
    };
    expect(() => parseRepoPolicy(raw)).toThrow(HarnessError);
  });

  test("rejects hook commands with empty strings or non-string elements", () => {
    const rawEmpty = {
      ...canonicalPolicy(),
      hooks: {
        on_error: [""],
      },
    };
    expect(() => parseRepoPolicy(rawEmpty)).toThrow(HarnessError);

    const rawSpaces = {
      ...canonicalPolicy(),
      hooks: {
        on_error: ["   "],
      },
    };
    expect(() => parseRepoPolicy(rawSpaces)).toThrow(HarnessError);

    const rawNonString = {
      ...canonicalPolicy(),
      hooks: {
        on_error: [123],
      },
    };
    expect(() => parseRepoPolicy(rawNonString)).toThrow(HarnessError);
  });

  test("validates host temperature bounds and default test_runner fallback", () => {
    const rawValidTemp = canonicalPolicy();
    setField(rawValidTemp, ["agents", "mind_supervisor", "hosts", "antigravity", "temperature"], 0.7);
    const parsed = parseRepoPolicy(rawValidTemp);
    expect(parsed.agents?.["mind_supervisor"]?.hosts["antigravity"]?.temperature).toBe(0.7);

    const rawHighTemp = canonicalPolicy();
    setField(rawHighTemp, ["agents", "mind_supervisor", "hosts", "antigravity", "temperature"], 2.5);
    expect(() => parseRepoPolicy(rawHighTemp)).toThrow(HarnessError);

    const rawLowTemp = canonicalPolicy();
    setField(rawLowTemp, ["agents", "mind_supervisor", "hosts", "antigravity", "temperature"], -0.5);
    expect(() => parseRepoPolicy(rawLowTemp)).toThrow(HarnessError);

    // Omitted test_runner
    const rawNoTestRunner = canonicalPolicy();
    delete (rawNoTestRunner as Record<string, unknown>)["test_runner"];
    const parsedNoTestRunner = parseRepoPolicy(rawNoTestRunner);
    expect(parsedNoTestRunner.test_runner.default_command).toBe("bun test");
  });
});
