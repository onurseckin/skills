import { describe, expect, test } from "bun:test";
import {
  compileEffectiveForbiddenPatterns,
  isUntargetedTestCommand,
  verifyCommandAuthorization,
} from "../../../orchestrating-long-tasks/scripts/src/policy/rbac-engine.ts";
import type { RepoPolicy } from "../../../orchestrating-long-tasks/scripts/src/policy/repo-policy.ts";
import type { AgentMetadata } from "../../../orchestrating-long-tasks/scripts/src/runtime/agent-metadata.ts";

describe("RBAC Engine & Hybrid Deny-List", () => {
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
    forbidden_commands: ["git commit", "git push", "rm -rf /"],
  };

  describe("compileEffectiveForbiddenPatterns", () => {
    test("compiles catch-all pattern for cognitive validator roles (0 commands allowed)", () => {
      const validatorPatterns = compileEffectiveForbiddenPatterns("validator", samplePolicy);
      expect(validatorPatterns.length).toBe(1);
      expect(validatorPatterns[0]!.test("git status")).toBe(true);
      expect(validatorPatterns[0]!.test("bun test tests/unit/foo.test.ts")).toBe(true);
      expect(validatorPatterns[0]!.test("ls")).toBe(true);

      const uiValidatorPatterns = compileEffectiveForbiddenPatterns(
        "validator-ui-design",
        samplePolicy,
      );
      expect(uiValidatorPatterns[0]!.test("anything")).toBe(true);

      const criticPatterns = compileEffectiveForbiddenPatterns("completeness-critic", samplePolicy);
      expect(criticPatterns[0]!.test("anything")).toBe(true);
    });

    test("compiles static and dynamic rules for supervisors", () => {
      const supervisorPatterns = compileEffectiveForbiddenPatterns("coordinator", samplePolicy);
      // Forbids git mutations
      const matchesGitCommit = supervisorPatterns.some((p) => p.test("git commit -m 'test'"));
      const matchesGitPush = supervisorPatterns.some((p) => p.test("git push origin main"));
      const matchesFullTest = supervisorPatterns.some((p) => p.test("bun test"));

      expect(matchesGitCommit).toBe(true);
      expect(matchesGitPush).toBe(true);
      expect(matchesFullTest).toBe(true);
    });

    test("compiles implementer rules restricting un-targeted test runs and git operations", () => {
      const implementerPatterns = compileEffectiveForbiddenPatterns("implementer", samplePolicy);
      // Forbids bare un-targeted test runs
      expect(implementerPatterns.some((p) => p.test("bun test"))).toBe(true);
      expect(implementerPatterns.some((p) => p.test("npm test"))).toBe(true);
      expect(implementerPatterns.some((p) => p.test("pytest"))).toBe(true);
      expect(implementerPatterns.some((p) => p.test("cargo test"))).toBe(true);

      // Forbids git commit and push
      expect(implementerPatterns.some((p) => p.test("git commit -m 'feat'"))).toBe(true);
      expect(implementerPatterns.some((p) => p.test("git push"))).toBe(true);

      // Does NOT match targeted test runs
      expect(implementerPatterns.some((p) => p.test("bun test tests/unit/auth.test.ts"))).toBe(
        false,
      );
      expect(implementerPatterns.some((p) => p.test("git status"))).toBe(false);
      expect(implementerPatterns.some((p) => p.test("git diff"))).toBe(false);
    });
  });

  describe("isUntargetedTestCommand", () => {
    test("detects bare un-targeted test commands", () => {
      expect(isUntargetedTestCommand("npm test")).toBe(true);
      expect(isUntargetedTestCommand("bun test")).toBe(true);
      expect(isUntargetedTestCommand("vitest")).toBe(true);
      expect(isUntargetedTestCommand("pytest")).toBe(true);
      expect(isUntargetedTestCommand("cargo test")).toBe(true);
    });

    test("returns false for targeted test commands", () => {
      expect(isUntargetedTestCommand("bun test tests/unit/foo.test.ts")).toBe(false);
      expect(isUntargetedTestCommand("npm test -- tests/unit/foo.test.ts")).toBe(false);
      expect(isUntargetedTestCommand("pytest tests/unit/test_app.py")).toBe(false);
    });
  });

  describe("verifyCommandAuthorization", () => {
    test("blocks cognitive validator from running any shell command", () => {
      const validatorActor: AgentMetadata = {
        agent_id: "val-1",
        role: "validator",
        tier: 3,
        write_scope: [],
        allowed_read_scope: [],
        can_execute_shell: false,
        spawned_at: new Date().toISOString(),
      };

      const result = verifyCommandAuthorization(validatorActor, "git status", samplePolicy);
      expect(result.authorized).toBe(false);
      expect(result.error_code).toBe("PERMISSION_DENIED");
      expect(result.message).toContain("[PERMISSION_DENIED]");
      expect(result.message).toContain(
        "Cognitive Validators are strictly prohibited from running commands",
      );
    });

    test("blocks implementer from running un-targeted full test suite", () => {
      const implementerActor: AgentMetadata = {
        agent_id: "imp-1",
        role: "implementer",
        tier: 3,
        write_scope: ["src/foo.ts"],
        allowed_read_scope: [],
        can_execute_shell: true,
        spawned_at: new Date().toISOString(),
      };

      const result = verifyCommandAuthorization(implementerActor, "bun test", samplePolicy);
      expect(result.authorized).toBe(false);
      expect(result.error_code).toBe("INVALID_SCOPE");
      expect(result.message).toContain("[INVALID_SCOPE]");
      expect(result.message).toContain("Un-targeted whole-repo test run detected: 'bun test'");
    });

    test("authorizes implementer running targeted unit test", () => {
      const implementerActor: AgentMetadata = {
        agent_id: "imp-1",
        role: "implementer",
        tier: 3,
        write_scope: ["src/foo.ts"],
        allowed_read_scope: [],
        can_execute_shell: true,
        spawned_at: new Date().toISOString(),
      };

      const result = verifyCommandAuthorization(
        implementerActor,
        "bun test tests/unit/foo.test.ts",
        samplePolicy,
      );
      expect(result.authorized).toBe(true);
    });

    test("blocks implementer from git mutations", () => {
      const implementerActor: AgentMetadata = {
        agent_id: "imp-1",
        role: "implementer",
        tier: 3,
        write_scope: ["src/foo.ts"],
        allowed_read_scope: [],
        can_execute_shell: true,
        spawned_at: new Date().toISOString(),
      };

      const result = verifyCommandAuthorization(
        implementerActor,
        "git commit -m 'feat: update'",
        samplePolicy,
      );
      expect(result.authorized).toBe(false);
      expect(result.error_code).toBe("PERMISSION_DENIED");
    });

    test("authorizes implementer reading git status and diagnostics", () => {
      const implementerActor: AgentMetadata = {
        agent_id: "imp-1",
        role: "implementer",
        tier: 3,
        write_scope: ["src/foo.ts"],
        allowed_read_scope: [],
        can_execute_shell: true,
        spawned_at: new Date().toISOString(),
      };

      const resultStatus = verifyCommandAuthorization(implementerActor, "git status", samplePolicy);
      expect(resultStatus.authorized).toBe(true);

      const resultDiff = verifyCommandAuthorization(implementerActor, "git diff", samplePolicy);
      expect(resultDiff.authorized).toBe(true);

      const resultLs = verifyCommandAuthorization(implementerActor, "ls -la", samplePolicy);
      expect(resultLs.authorized).toBe(true);
    });
  });
});
