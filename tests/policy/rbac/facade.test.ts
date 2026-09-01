import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  compileEffectiveForbiddenPatterns,
  FORBIDDEN_SUBSHELL_AND_EVAL_PATTERNS,
  hasUnshieldedSubshellOrChaining,
  isTargetTestArgument,
  isUntargetedTestCommand,
  KNOWN_TEST_RUNNERS,
  STATIC_IMPLEMENTER_FORBIDDEN_PATTERNS,
  STATIC_SUPERVISOR_FORBIDDEN_PATTERNS,
  verifyCommandAuthorization,
} from "../../../olt/scripts/src/policy/index.ts";
import type { AgentMetadata } from "../../../olt/scripts/src/runtime/index.ts";
import type { RepoPolicy } from "../../../olt/scripts/src/policy/index.ts";
import { cleanupVirtualPolicyFS, setupVirtualPolicyFS } from "../fixture.ts";

describe("RBAC Engine Public Facade & Integration", () => {
  beforeEach(() => {
    setupVirtualPolicyFS();
  });

  afterEach(() => {
    cleanupVirtualPolicyFS();
  });

  const samplePolicy: RepoPolicy = {
    schema_version: 1,
    ecosystem: "bun",
    package_manager: "bun",
    test_runner: {
      default_command: "bun test",
      targeted_pattern: "bun test <path>",
      full_suite_command: "bun test",
    },
    typecheck_command: "bun run typecheck",
    lint_command: "bun run lint",
    allowed_commands: ["bun test", "git status"],
    forbidden_commands: ["git commit", "git push", "rm -rf /", "curl"],
  };

  const createActor = (role: string, canExec?: boolean, id = "actor-1"): AgentMetadata => ({
    agent_id: id,
    role,
    tier: 3,
    write_scope: ["src/foo.ts"],
    allowed_read_scope: [],
    can_execute_shell: canExec ?? true,
    spawned_at: new Date().toISOString(),
  });

  test("re-exports all expected constants and pattern lists", () => {
    expect(STATIC_SUPERVISOR_FORBIDDEN_PATTERNS.length).toBeGreaterThan(0);
    expect(STATIC_IMPLEMENTER_FORBIDDEN_PATTERNS.length).toBeGreaterThan(0);
    expect(FORBIDDEN_SUBSHELL_AND_EVAL_PATTERNS.length).toBeGreaterThan(0);
    expect(KNOWN_TEST_RUNNERS.length).toBeGreaterThan(0);
  });

  test("compiles effective patterns for roles correctly through facade", () => {
    const patterns = compileEffectiveForbiddenPatterns("validator", samplePolicy);
    expect(patterns.length).toBeGreaterThan(1);
    expect(patterns.some((p) => p.test("bun test"))).toBe(true);
    expect(patterns.some((p) => p.test("git status"))).toBe(false);

    const sup = compileEffectiveForbiddenPatterns("coordinator", samplePolicy);
    expect(sup.some((p) => p.test("bun test"))).toBe(true);

    const imp = compileEffectiveForbiddenPatterns("implementer", samplePolicy);
    expect(imp.some((p) => p.test("git reset --hard"))).toBe(true);
  });

  test("evaluates test targets and unbounded test commands through facade", () => {
    expect(isTargetTestArgument("tests/policy/foo.test.ts")).toBe(true);
    expect(isTargetTestArgument("-v")).toBe(false);
    expect(isUntargetedTestCommand("bun test")).toBe(true);
    expect(isUntargetedTestCommand("bun test tests/policy/foo.test.ts")).toBe(false);
  });

  test("detects unshielded subshells and command chaining through facade", () => {
    expect(hasUnshieldedSubshellOrChaining("bash", ["bash", "-c", "echo 1"]).detected).toBe(true);
    expect(hasUnshieldedSubshellOrChaining("git", ["git", "status"]).detected).toBe(false);
  });

  test("verifies authorization with fail-closed semantics for all key personas", () => {
    const unres = verifyCommandAuthorization(null, "git status", samplePolicy);
    expect(unres.authorized).toBe(false);
    expect(unres.error_code).toBe("PERMISSION_DENIED");

    const val = createActor("validator", true);
    const valRes = verifyCommandAuthorization(val, "git status", samplePolicy);
    expect(valRes.authorized).toBe(true);

    const valTestRes = verifyCommandAuthorization(val, "bun test", samplePolicy);
    expect(valTestRes.authorized).toBe(false);
    expect(valTestRes.error_code).toBe("SUPERVISOR_TEST_EXECUTION_FORBIDDEN");

    const sup = { role: "coordinator", can_execute_shell: true };
    const supRes = verifyCommandAuthorization(sup, "bun test", samplePolicy);
    expect(supRes.authorized).toBe(false);
    expect(supRes.error_code).toBe("SUPERVISOR_TEST_EXECUTION_FORBIDDEN");

    // Implementer targeted vs unbounded test
    const imp = createActor("implementer");
    const unbRes = verifyCommandAuthorization(imp, "bun test", samplePolicy);
    expect(unbRes.authorized).toBe(false);
    expect(unbRes.error_code).toBe("UNBOUNDED_TEST_RUNNER_FORBIDDEN");

    const tgtRes = verifyCommandAuthorization(imp, "bun test tests/a.test.ts", samplePolicy);
    expect(tgtRes.authorized).toBe(true);

    // Forbidden policy command
    const curlRes = verifyCommandAuthorization(imp, ["curl", "https://example.com"], samplePolicy);
    expect(curlRes.authorized).toBe(false);
    expect(curlRes.error_code).toBe("PERMISSION_DENIED");
  });
});
