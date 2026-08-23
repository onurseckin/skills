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

    test("compiles implementer rules restricting git operations and policy forbidden commands", () => {
      const implementerPatterns = compileEffectiveForbiddenPatterns("implementer", samplePolicy);
      // Forbids git commit and push
      expect(implementerPatterns.some((p) => p.test("git commit -m 'feat'"))).toBe(true);
      expect(implementerPatterns.some((p) => p.test("git push"))).toBe(true);
      expect(implementerPatterns.some((p) => p.test("git reset --hard"))).toBe(true);
      expect(implementerPatterns.some((p) => p.test("rm -rf /"))).toBe(true);

      // Does NOT match diagnostic reads
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

    test("detects un-targeted test commands with flags and flag values (leakage prevention)", () => {
      expect(isUntargetedTestCommand("bun test --bail")).toBe(true);
      expect(isUntargetedTestCommand("bun test -b -v")).toBe(true);
      expect(isUntargetedTestCommand("bun test --seed 1234")).toBe(true);
      expect(isUntargetedTestCommand("bun test --max-concurrency 4")).toBe(true);
      expect(isUntargetedTestCommand("npm test --")).toBe(true);
      expect(isUntargetedTestCommand("npm test -- --bail")).toBe(true);
      expect(isUntargetedTestCommand("pytest -v -s --cov")).toBe(true);
      expect(isUntargetedTestCommand("pytest --override-ini foo=bar")).toBe(true);
      expect(isUntargetedTestCommand("cargo test --all --workspace")).toBe(true);
      expect(isUntargetedTestCommand("vitest run")).toBe(true);
      expect(isUntargetedTestCommand("vitest run --bail")).toBe(true);
    });

    test("detects multi-language un-targeted test commands", () => {
      expect(isUntargetedTestCommand("go test")).toBe(true);
      expect(isUntargetedTestCommand("go test -v")).toBe(true);
      expect(isUntargetedTestCommand("go test ./...")).toBe(true);
      expect(isUntargetedTestCommand("mvn test")).toBe(true);
      expect(isUntargetedTestCommand("gradle test")).toBe(true);
      expect(isUntargetedTestCommand("./gradlew test")).toBe(true);
      expect(isUntargetedTestCommand("dotnet test")).toBe(true);
      expect(isUntargetedTestCommand("mix test")).toBe(true);
    });

    test("returns false for targeted test commands", () => {
      expect(isUntargetedTestCommand("bun test tests/unit/foo.test.ts")).toBe(false);
      expect(isUntargetedTestCommand("bun test --bail tests/unit/foo.test.ts")).toBe(false);
      expect(isUntargetedTestCommand("npm test -- tests/unit/foo.test.ts")).toBe(false);
      expect(isUntargetedTestCommand("pytest tests/unit/test_app.py")).toBe(false);
      expect(isUntargetedTestCommand("cargo test -- tests/unit/test_app.rs")).toBe(false);
      expect(isUntargetedTestCommand("cargo test test_something")).toBe(false);
      expect(isUntargetedTestCommand("vitest run src/foo.spec.ts")).toBe(false);
      expect(isUntargetedTestCommand("go test ./pkg/auth/auth_test.go")).toBe(false);
      expect(isUntargetedTestCommand("dotnet test Tests/UnitTests.cs")).toBe(false);
    });
  });

  describe("verifyCommandAuthorization", () => {
    test("enforces immutable can_execute_shell: false on validator even if spoofed to true", () => {
      const spoofedValidatorActor = {
        agent_id: "val-spoofed",
        role: "validator",
        tier: 3,
        can_execute_shell: true, // Attempted spoof
      };

      const result = verifyCommandAuthorization(spoofedValidatorActor, "ls -la", samplePolicy);
      expect(result.authorized).toBe(false);
      expect(result.error_code).toBe("PERMISSION_DENIED");
      expect(result.message).toContain(
        "Cognitive Validators are strictly prohibited from running commands",
      );
    });

    test("blocks subshell and evaluator invocations with UNSHIELDED_COMMAND_BLUNDER", () => {
      const implementerActor: AgentMetadata = {
        agent_id: "imp-1",
        role: "implementer",
        tier: 3,
        write_scope: ["src/foo.ts"],
        allowed_read_scope: [],
        can_execute_shell: true,
        spawned_at: new Date().toISOString(),
      };

      const resSh = verifyCommandAuthorization(implementerActor, "sh -c 'bun test'", samplePolicy);
      expect(resSh.authorized).toBe(false);
      expect(resSh.error_code).toBe("UNSHIELDED_COMMAND_BLUNDER");

      const resBash = verifyCommandAuthorization(
        implementerActor,
        "bash -c 'git push'",
        samplePolicy,
      );
      expect(resBash.authorized).toBe(false);
      expect(resBash.error_code).toBe("UNSHIELDED_COMMAND_BLUNDER");

      const resNode = verifyCommandAuthorization(
        implementerActor,
        ["node", "-e", "process.exit(1)"],
        samplePolicy,
      );
      expect(resNode.authorized).toBe(false);
      expect(resNode.error_code).toBe("UNSHIELDED_COMMAND_BLUNDER");

      const resBun = verifyCommandAuthorization(
        implementerActor,
        ["bun", "-e", "console.log(1)"],
        samplePolicy,
      );
      expect(resBun.authorized).toBe(false);
      expect(resBun.error_code).toBe("UNSHIELDED_COMMAND_BLUNDER");

      const resPy = verifyCommandAuthorization(
        implementerActor,
        ["python3", "-c", "import os"],
        samplePolicy,
      );
      expect(resPy.authorized).toBe(false);
      expect(resPy.error_code).toBe("UNSHIELDED_COMMAND_BLUNDER");
    });

    test("blocks unshielded command chaining operators in argv", () => {
      const implementerActor: AgentMetadata = {
        agent_id: "imp-1",
        role: "implementer",
        tier: 3,
        write_scope: ["src/foo.ts"],
        allowed_read_scope: [],
        can_execute_shell: true,
        spawned_at: new Date().toISOString(),
      };

      const resAnd = verifyCommandAuthorization(
        implementerActor,
        ["echo", "foo", "&&", "git", "push"],
        samplePolicy,
      );
      expect(resAnd.authorized).toBe(false);
      expect(resAnd.error_code).toBe("UNSHIELDED_COMMAND_BLUNDER");

      const resPipe = verifyCommandAuthorization(
        implementerActor,
        ["ls", "|", "grep", "foo"],
        samplePolicy,
      );
      expect(resPipe.authorized).toBe(false);
      expect(resPipe.error_code).toBe("UNSHIELDED_COMMAND_BLUNDER");

      const resSemi = verifyCommandAuthorization(
        implementerActor,
        ["git", "status", ";", "rm", "-rf", "/"],
        samplePolicy,
      );
      expect(resSemi.authorized).toBe(false);
      expect(resSemi.error_code).toBe("UNSHIELDED_COMMAND_BLUNDER");
    });

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
