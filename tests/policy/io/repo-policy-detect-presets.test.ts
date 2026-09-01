import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupVirtualPolicyFS, setupVirtualPolicyFS } from "../fixture.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  DEFAULT_PLANNING_POLICY,
  DEFAULT_REVIEW_PROTOCOL_POLICY,
  discoverToolchainPolicy,
  inspectRepoPolicy,
  loadRepoPolicy,
  parseRepoPolicy,
  validateRepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";

describe("Repo Policy Presets, Normalization & Schema Validation", () => {
  const scratchBase = "/virtual/policy/io/detect-presets";

  beforeEach(() => {
    setupVirtualPolicyFS();
  });

  afterEach(() => {
    cleanupVirtualPolicyFS();
  });

  test("validates and normalizes malformed policy objects and throws on invalid inputs", () => {
    expect(() => validateRepoPolicy(null)).toThrow(/must be an object/i);
    expect(() => validateRepoPolicy("string")).toThrow(/must be an object/i);
    expect(() => validateRepoPolicy([1, 2, 3])).toThrow(/must be an object/i);

    const empty = validateRepoPolicy({});
    expect(empty.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(empty.ecosystem).toBe("unknown");
    expect(empty.test_runner.default_command).toBe("bun test");
    expect(empty.read_scope_neighborhood_depth).toBe(2);
    expect(empty.review_protocol).toEqual(DEFAULT_REVIEW_PROTOCOL_POLICY);
    expect(empty.planning).toEqual(DEFAULT_PLANNING_POLICY);

    const custom = validateRepoPolicy({
      schema_version: 2,
      ecosystem: "python",
      package_manager: "poetry",
      test_runner: {
        default_command: "  pytest -v  ",
        targeted_pattern: "  pytest <path> -s  ",
        full_suite_command: "  pytest  ",
      },
      typecheck_command: "  mypy .  ",
      lint_command: "  ruff check .  ",
      allowed_commands: ["pytest", "  ", 123, "mypy"],
      forbidden_commands: ["git push", ""],
      read_scope_neighborhood_depth: -5,
      review_protocol: {
        max_adversarial_pushes: 0,
        cognitive_pushes: -2,
        escalate_on_exhausted_adversarial: false,
      },
      planning: {
        mandatory_brainstorming_rounds: -1,
        socratic_expansion_depth: -3,
        enforce_edge_case_matrix: false,
        min_tasks_per_complex_prompt: 0,
        max_files_per_task: 0,
        reject_shallow_umbrella_compression: false,
      },
    });

    expect(custom.schema_version).toBe(2);
    expect(custom.ecosystem).toBe("python");
    expect(custom.package_manager).toBe("poetry");
    expect(custom.test_runner.default_command).toBe("pytest -v");
    expect(custom.test_runner.targeted_pattern).toBe("pytest <path> -s");
    expect(custom.test_runner.full_suite_command).toBe("pytest");
    expect(custom.typecheck_command).toBe("mypy .");
    expect(custom.lint_command).toBe("ruff check .");
    expect(custom.allowed_commands).toEqual(["pytest", "mypy"]);
    expect(custom.forbidden_commands).toEqual(["git push"]);
    expect(custom.read_scope_neighborhood_depth).toBe(2);
    expect(custom.review_protocol?.max_adversarial_pushes).toBe(
      DEFAULT_REVIEW_PROTOCOL_POLICY.max_adversarial_pushes,
    );
    expect(custom.review_protocol?.cognitive_pushes).toBe(
      DEFAULT_REVIEW_PROTOCOL_POLICY.cognitive_pushes,
    );
    expect(custom.review_protocol?.escalate_on_exhausted_adversarial).toBe(false);
    expect(custom.planning?.mandatory_brainstorming_rounds).toBe(
      DEFAULT_PLANNING_POLICY.mandatory_brainstorming_rounds,
    );
    expect(custom.planning?.min_tasks_per_complex_prompt).toBe(
      DEFAULT_PLANNING_POLICY.min_tasks_per_complex_prompt,
    );
  });

  test("rejects unsupported top-level keys while retaining partial defaults for documented keys", () => {
    const partial = validateRepoPolicy({ forbidden_commands: ["git push"] });
    expect(partial.forbidden_commands).toEqual(["git push"]);
    expect(partial.test_runner.default_command).toBe("bun test");

    expect(() => validateRepoPolicy({ timeout_ms: 45_000 })).toThrow(/unknown.*timeout_ms/i);
    expect(() => validateRepoPolicy({ forbidden_commands: [], typo_policy_flag: true })).toThrow(
      /unknown.*typo_policy_flag/i,
    );

    const dir = join(scratchBase, "unknown-top-level-policy");
    const policyPath = join(dir, ".olt", "policy.json");
    mkdirSync(join(dir, ".olt"), { recursive: true });
    writeFileSync(policyPath, JSON.stringify({ timeout_ms: 45_000 }), "utf-8");
    try {
      loadRepoPolicy(dir);
      throw new Error("expected invalid custom policy to throw");
    } catch (error) {
      expect(error).toHaveProperty("code", "INTEGRITY");
      expect((error as Error).message).toContain(policyPath);
      expect((error as Error).message).toMatch(/unknown.*timeout_ms/i);
    }
  });

  test("authority parser rejects every present malformed field with an INTEGRITY field path and defaults omitted optionals", () => {
    const required = {
      schema_version: CURRENT_POLICY_SCHEMA_VERSION,
      ecosystem: "bun",
      test_runner: {
        default_command: "bun test",
        targeted_pattern: "bun test <path>",
        full_suite_command: "bun test",
      },
    };

    expect(parseRepoPolicy(required).planning).toEqual(DEFAULT_PLANNING_POLICY);
    expect(parseRepoPolicy(required).review_protocol).toEqual(DEFAULT_REVIEW_PROTOCOL_POLICY);

    const invalidPolicies: readonly [string, unknown][] = [
      ["$.schema_version", { ...required, schema_version: 2 }],
      ["$.ecosystem", { ...required, ecosystem: "BUN" }],
      [
        "$.test_runner.default_command",
        { ...required, test_runner: { ...required.test_runner, default_command: "" } },
      ],
      [
        "$.test_runner.unknown",
        { ...required, test_runner: { ...required.test_runner, unknown: true } },
      ],
      ["allowed_commands[1]", { ...required, allowed_commands: ["bun test", 1] }],
      ["allowed_commands[1]", { ...required, allowed_commands: ["curl", " curl "] }],
      [
        "$.forbidden_commands",
        { ...required, allowed_commands: ["curl"], forbidden_commands: ["curl"] },
      ],
      ["$.read_scope_neighborhood_depth", { ...required, read_scope_neighborhood_depth: 1.5 }],
      [
        "$.review_protocol.cognitive_pushes",
        { ...required, review_protocol: { cognitive_pushes: Number.NaN } },
      ],
      ["$.planning.unknown", { ...required, planning: { unknown: true } }],
    ];
    for (const [fieldPath, malformed] of invalidPolicies) {
      try {
        parseRepoPolicy(malformed);
        throw new Error(`expected ${fieldPath} to fail`);
      } catch (error) {
        expect(error).toHaveProperty("code", "INTEGRITY");
        expect(String((error as Error).message)).toContain(fieldPath);
      }
    }
  });

  test("discoverToolchainPolicy detects toolchain commands across repositories", () => {
    const dir = join(scratchBase, "discover-toolchain-test");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bun.lock"), "");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: {
          test: "bun test",
          typecheck: "tsc --noEmit",
          lint: "oxlint",
          build: "bun build",
        },
      }),
    );

    const res = discoverToolchainPolicy(dir);
    expect(res.toolchain).toBe("bun");
    expect(res.commands.test).toBe("bun test");
    expect(res.commands.typecheck).toBe("bun typecheck");
    expect(res.commands.lint).toBe("bun lint");
    expect(res.commands.build).toBe("bun run build");
  });

  test("inspectRepoPolicy falls back to auto_detected when policy file does not exist", () => {
    const dir = join(scratchBase, "nonexistent-policy-inspect-test");
    mkdirSync(dir, { recursive: true });
    const res = inspectRepoPolicy(dir);
    expect(res.status).toBe("auto_detected");
    expect(res.provenance).toBe("auto_detected");
    expect(res.policy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
  });
});
