import { describe, expect, test } from "bun:test";
import {
  compileEffectiveForbiddenPatterns,
  hasUnshieldedSubshellOrChaining,
  isUntargetedTestCommand,
  verifyCommandAuthorization,
} from "../../../olt/scripts/src/policy/rbac-engine.ts";
import type { RepoPolicy } from "../../../olt/scripts/src/policy/repo-policy.ts";
import type { AgentMetadata } from "../../../olt/scripts/src/runtime/agent-metadata.ts";

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
    test("blocks coordinator from running test commands", () => {
      const coordinatorActor = {
        agent_id: "coord-1",
        role: "coordinator",
        tier: 2,
        write_scope: [],
        allowed_read_scope: [],
        can_execute_shell: true,
        spawned_at: new Date().toISOString(),
      };

      const result = verifyCommandAuthorization(coordinatorActor, "bun test", {
        test_runner: { targeted_pattern: "bun test <path>" },
      } as RepoPolicy);

      expect(result.authorized).toBe(false);
      expect(result.error_code).toBe("SUPERVISOR_TEST_EXECUTION_FORBIDDEN");
    });

    test("enforces immutable can_execute_shell: false on validator even if spoofed to true", () => {
      const spoofedValidatorActor = {
        agent_id: "val-spoofed",
        role: "validator",
        tier: 3,
        can_execute_shell: true, // Attempted spoof
      };

      const result = verifyCommandAuthorization(spoofedValidatorActor, "ls -la", samplePolicy);
      expect(result.authorized).toBe(false);
      expect(result.error_code).toBe("COGNITIVE_VALIDATOR_COMMAND_FORBIDDEN");
      expect(result.message).toContain("Cognitive Validators are locked to 0 command execution");
    });

    test("blocks subshell and evaluator invocations with UNSHIELDED_COMMAND_DEFECT", () => {
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
      expect(resSh.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");

      const resBash = verifyCommandAuthorization(
        implementerActor,
        "bash -c 'git push'",
        samplePolicy,
      );
      expect(resBash.authorized).toBe(false);
      expect(resBash.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");

      const resNode = verifyCommandAuthorization(
        implementerActor,
        ["node", "-e", "process.exit(1)"],
        samplePolicy,
      );
      expect(resNode.authorized).toBe(false);
      expect(resNode.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");

      const resBun = verifyCommandAuthorization(
        implementerActor,
        ["bun", "-e", "console.log(1)"],
        samplePolicy,
      );
      expect(resBun.authorized).toBe(false);
      expect(resBun.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");

      const resPy = verifyCommandAuthorization(
        implementerActor,
        ["python3", "-c", "import os"],
        samplePolicy,
      );
      expect(resPy.authorized).toBe(false);
      expect(resPy.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");
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
      expect(resAnd.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");

      const resPipe = verifyCommandAuthorization(
        implementerActor,
        ["ls", "|", "grep", "foo"],
        samplePolicy,
      );
      expect(resPipe.authorized).toBe(false);
      expect(resPipe.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");

      const resSemi = verifyCommandAuthorization(
        implementerActor,
        ["git", "status", ";", "rm", "-rf", "/"],
        samplePolicy,
      );
      expect(resSemi.authorized).toBe(false);
      expect(resSemi.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");
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
      expect(result.error_code).toBe("COGNITIVE_VALIDATOR_COMMAND_FORBIDDEN");
      expect(result.message).toContain("Cognitive Validators are locked to 0 command execution");
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
      expect(result.error_code).toBe("UNBOUNDED_TEST_RUNNER_FORBIDDEN");
      expect(result.message).toContain("[UNBOUNDED_TEST_RUNNER_FORBIDDEN]");
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

    test("blocks non-executable roles with explicit can_execute_shell: false", () => {
      const nonExecActor = {
        role: "worker",
        can_execute_shell: false,
      };
      const result = verifyCommandAuthorization(nonExecActor, "ls", samplePolicy);
      expect(result.authorized).toBe(false);
      expect(result.error_code).toBe("PERMISSION_DENIED");
      expect(result.message).toContain("can_execute_shell: false");
    });

    test("blocks direct eval and exec tokens", () => {
      const actor: AgentMetadata = {
        agent_id: "imp-1",
        role: "implementer",
        tier: 3,
        write_scope: ["src/foo.ts"],
        allowed_read_scope: [],
        can_execute_shell: true,
        spawned_at: new Date().toISOString(),
      };
      const resEval = verifyCommandAuthorization(actor, "eval 'console.log(1)'", samplePolicy);
      expect(resEval.authorized).toBe(false);
      expect(resEval.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");

      const resExec = verifyCommandAuthorization(actor, "exec ./script.sh", samplePolicy);
      expect(resExec.authorized).toBe(false);
      expect(resExec.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");
    });

    test("compiles forbidden patterns for mechanic-validator and sub-validator", () => {
      const mechanicPatterns = compileEffectiveForbiddenPatterns(
        "mechanic-validator",
        samplePolicy,
      );
      expect(mechanicPatterns.some((p) => p.test("git commit -m 'test'"))).toBe(true);
      expect(mechanicPatterns.some((p) => p.test("write_to_file"))).toBe(true);
      expect(mechanicPatterns.some((p) => p.test("replace_file"))).toBe(true);

      const subValidatorPatterns = compileEffectiveForbiddenPatterns("sub_validator", samplePolicy);
      expect(subValidatorPatterns.some((p) => p.test("git reset"))).toBe(true);
    });

    test("detects dynamic full_suite_command from custom repo policy in isUntargetedTestCommand", () => {
      const customPolicy: RepoPolicy = {
        schema_version: 1,
        ecosystem: "unknown",
        test_runner: {
          default_command: "custom-runner test",
          targeted_pattern: "custom-runner test <path>",
          full_suite_command: "custom-runner test-all",
        },
      };

      expect(isUntargetedTestCommand("custom-runner test-all", undefined, customPolicy)).toBe(true);
      expect(
        isUntargetedTestCommand("custom-runner test-all src/test.ts", undefined, customPolicy),
      ).toBe(false);
    });

    test("detects subshell regex patterns such as perl/ruby inline evaluators", () => {
      const actor: AgentMetadata = {
        agent_id: "imp-1",
        role: "implementer",
        tier: 3,
        write_scope: ["src/foo.ts"],
        allowed_read_scope: [],
        can_execute_shell: true,
        spawned_at: new Date().toISOString(),
      };
      const resPerl = verifyCommandAuthorization(actor, "perl -e 'print 1;'", samplePolicy);
      expect(resPerl.authorized).toBe(false);
      expect(resPerl.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");

      const resRuby = verifyCommandAuthorization(actor, "ruby -e 'puts 1'", samplePolicy);
      expect(resRuby.authorized).toBe(false);
      expect(resRuby.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");
    });

    test("handles flags with values and diverse test identifiers in isUntargetedTestCommand", () => {
      expect(isUntargetedTestCommand("jest -c jest.config.js")).toBe(true);
      expect(isUntargetedTestCommand("pytest -o rootdir=/tmp")).toBe(true);
      expect(isUntargetedTestCommand("jest -c jest.config.js src/test.ts")).toBe(false);
      expect(isUntargetedTestCommand("pytest -o rootdir=/tmp test_app")).toBe(false);
      expect(isUntargetedTestCommand("cargo test unit_test_name")).toBe(false);
      expect(isUntargetedTestCommand("cargo test SomeTest.java")).toBe(false);
    });

    test("hasUnshieldedSubshellOrChaining matches pattern when custom argv is provided", () => {
      const match = hasUnshieldedSubshellOrChaining("eval something", ["custom_token"]);
      expect(match.detected).toBe(true);
      expect(match.reason).toContain("evaluator pattern");
    });
  });
});
