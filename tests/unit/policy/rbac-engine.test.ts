import { describe, expect, test } from "bun:test";
import {
  compileEffectiveForbiddenPatterns,
  hasUnshieldedSubshellOrChaining,
  isTargetTestArgument,
  isUntargetedTestCommand,
  verifyCommandAuthorization,
} from "../../../olt/scripts/src/policy/rbac-engine.ts";
import {
  parseAuthorityRepoPolicy,
  type RepoPolicy,
} from "../../../olt/scripts/src/policy/repo-policy.ts";
import type { AgentMetadata } from "../../../olt/scripts/src/runtime/index.ts";

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

  describe("compileEffectiveForbiddenPatterns", () => {
    test("compiles catch-all for cognitive validators and caches pattern instances", () => {
      const cognitiveRoles = [
        "validator",
        "cognitive-validator",
        "cognitive_validator",
        "validator-ui-design",
        "critic",
        "completeness-critic",
        "completeness_critic",
        "planner",
        "plan-validator",
        "plan_validator",
        "sub-investigator",
        "sub_investigator",
      ];
      for (const role of cognitiveRoles) {
        const patterns = compileEffectiveForbiddenPatterns(role, samplePolicy);
        expect(patterns.length).toBe(1);
        expect(patterns[0]!.test("git status")).toBe(true);
        expect(patterns[0]!.test("anything")).toBe(true);
      }
      expect(compileEffectiveForbiddenPatterns("validator", samplePolicy)).toBe(
        compileEffectiveForbiddenPatterns("validator", samplePolicy),
      );
    });

    test("compiles supervisor, mechanic, and implementer rules with policy sync", () => {
      const supervisors = ["coordinator", "orchestrator", "mind", "meta-auditor", "mind-auditor"];
      for (const role of supervisors) {
        const sup = compileEffectiveForbiddenPatterns(role, samplePolicy);
        expect(sup.some((p) => p.test("git commit -m 't'"))).toBe(true);
        expect(sup.some((p) => p.test("bun test"))).toBe(true);
        expect(sup.some((p) => p.test("curl https://evil.com"))).toBe(true);
      }
      for (const role of ["mechanic-validator", "sub_validator"]) {
        const mech = compileEffectiveForbiddenPatterns(role, samplePolicy);
        expect(mech.some((p) => p.test("git commit"))).toBe(true);
        expect(mech.some((p) => p.test("write_to_file"))).toBe(true);
        expect(mech.some((p) => p.test("replace_file_content"))).toBe(true);
      }
      const imp = compileEffectiveForbiddenPatterns("implementer", samplePolicy);
      expect(imp.some((p) => p.test("git reset --hard"))).toBe(true);
      expect(imp.some((p) => p.test("git status"))).toBe(false);
    });
  });

  describe("isTargetTestArgument & isUntargetedTestCommand", () => {
    test("isTargetTestArgument identifies valid test files, targets, and non-target tokens", () => {
      const nonTargets = [
        "",
        "   ",
        "-v",
        "--",
        "--flag",
        "./...",
        "...",
        ".",
        "12345",
        "0",
        "true",
        "false",
        "all",
        "workspace",
        "run",
        "watch",
        "related",
        "bench",
        "coverage",
        "cov",
        "bail",
        "quiet",
        "silent",
        "verbose",
        "json",
        "tap",
        "junit",
        "html",
        "text",
        "lcov",
        "node",
        "bun",
        "browser",
        "jsdom",
        "happy-dom",
        "key=value",
        "!@#$%^&*",
      ];
      for (const token of nonTargets) expect(isTargetTestArgument(token)).toBe(false);

      const validTargets = [
        "config=path/to/test",
        "dir/test",
        "dir\\test",
        "foo.spec.js",
        "foo.tsx",
        "foo.jsx",
        "foo.rs",
        "foo.go",
        "foo.rb",
        "foo.cpp",
        "foo.c",
        "foo.h",
        "foo.kt",
        "foo.scala",
        "foo.cs",
        "foo.php",
        "foo.ex",
        "foo.exs",
        "test_feature",
        "unit_test",
        "test_suite.py",
        "UserTest.java",
        "MyTestFunc",
        "Namespace::TestClass",
      ];
      for (const token of validTargets) expect(isTargetTestArgument(token)).toBe(true);
    });

    test("detects bare and flagged un-targeted test runs across ecosystems", () => {
      for (const empty of ["", "   "]) expect(isUntargetedTestCommand(empty)).toBe(false);
      expect(isUntargetedTestCommand("", [])).toBe(false);
      expect(isUntargetedTestCommand("echo hello")).toBe(false);

      const runners = [
        "npm test",
        "bun test",
        "vitest",
        "pytest",
        "cargo test",
        "go test",
        "mvn test",
        "gradle test",
        "./gradlew test",
        "dotnet test",
        "mix test",
        "python -m pytest",
        "python3 -m pytest",
        "poetry run pytest",
        "pipenv run pytest",
        "pnpm test",
        "yarn test",
        "bunx vitest",
        "npx vitest",
        "npx jest",
        "bun test --bail",
        "pytest -v -s --cov",
        "cargo test --all --workspace",
        "vitest run --bail",
        "go test ./...",
        "jest -c jest.config.js",
        "pytest -o rootdir=/tmp",
        "bun test -t -v",
      ];
      for (const cmd of runners) expect(isUntargetedTestCommand(cmd)).toBe(true);

      const targeted = [
        "bun test tests/a.test.ts",
        "pytest tests/test_app.py",
        "cargo test my_test",
        "go test ./pkg/a_test.go",
        "dotnet test Tests/UnitTests.cs",
        "bunx vitest run src/test.ts",
        "jest -c jest.config.js src/test.ts",
        "cargo test unit_test_name",
        "cargo test SomeTest.java",
      ];
      for (const cmd of targeted) expect(isUntargetedTestCommand(cmd)).toBe(false);

      const custom: RepoPolicy = {
        ...samplePolicy,
        test_runner: {
          default_command: "c-run",
          targeted_pattern: "c-run <p>",
          full_suite_command: "c-run all",
        },
      };
      expect(isUntargetedTestCommand("c-run all", undefined, custom)).toBe(true);
      expect(isUntargetedTestCommand("c-run all src/a.test.ts", undefined, custom)).toBe(false);
      expect(isUntargetedTestCommand("other all", undefined, custom)).toBe(false);
    });
  });

  describe("subshell, evaluator, and ambiguous wrapper defenses", () => {
    test("hasUnshieldedSubshellOrChaining detects subshells, evaluators, and chaining", () => {
      const binaries = ["dash", "fish", "ksh", "csh", "tcsh", "sh.exe", "bash.exe", "zsh.exe"];
      for (const bin of binaries)
        expect(hasUnshieldedSubshellOrChaining(bin, [bin]).detected).toBe(true);

      const evaluators = [
        ["node.exe", "-e", "1"],
        ["bun.exe", "--eval", "1"],
        ["deno", "-e", "1"],
        ["node", "-e=console.log(1)"],
        ["bun", "--eval=console.log(1)"],
        ["python", "-c", "1"],
        ["python", "-c=1"],
        ["perl", "-c=1"],
        ["perl", "-e", "1"],
        ["ruby", "-e=1"],
        ["eval", "1"],
        ["exec", "script.sh"],
      ];
      for (const argv of evaluators)
        expect(hasUnshieldedSubshellOrChaining(argv[0]!, argv).detected).toBe(true);

      expect(hasUnshieldedSubshellOrChaining("ls", ["ls", "&"]).detected).toBe(true);
      expect(hasUnshieldedSubshellOrChaining("ls", ["ls", "||", "true"]).detected).toBe(true);
      expect(hasUnshieldedSubshellOrChaining("git", ["git", "status"]).detected).toBe(false);
      expect(hasUnshieldedSubshellOrChaining("eval", ["custom_token"]).detected).toBe(false);
    });

    test("blocks subshells, evaluators, and chaining with UNSHIELDED_COMMAND_DEFECT", () => {
      const actor = createActor("implementer");
      const defects = [
        "sh -c 'bun test'",
        "bash -c 'git push'",
        ["node", "-e", "process.exit(1)"],
        ["bun", "-e", "console.log(1)"],
        ["python3", "-c", "import os"],
        ["perl", "-e", "print 1"],
        ["ruby", "-e", "puts 1"],
        ["echo", "foo", "&&", "git", "push"],
        ["ls", "|", "grep", "foo"],
        ["git", "status", ";", "rm", "-rf", "/"],
        "eval 'console.log(1)'",
        "exec ./script.sh",
      ];
      for (const cmd of defects) {
        const res = verifyCommandAuthorization(actor, cmd, samplePolicy);
        expect(res.authorized).toBe(false);
        expect(res.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");
      }
    });

    test("blocks ambiguous wrappers and unsafe git options", () => {
      const actor = createActor("implementer");
      for (const wrapper of ["command", "nohup", "nice", "timeout", "xargs", "find"]) {
        const res = verifyCommandAuthorization(actor, [wrapper, "git", "push"], samplePolicy);
        expect(res.authorized).toBe(false);
        expect(res.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");
      }
      const gitDefects = [
        ["git", "-c", "alias.status=!git push", "status"],
        ["git", "unknown-extension", "status"],
        ["git", "diff", "--output=outside.patch"],
        ["git", "diff", "--output", "outside.patch"],
        ["git", "show", "--output=outside.patch", "HEAD"],
        ["git", "archive", "--output=archive.tar", "HEAD"],
      ];
      for (const cmd of gitDefects) {
        const res = verifyCommandAuthorization(actor, cmd, samplePolicy);
        expect(res.authorized).toBe(false);
        expect(res.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");
      }
    });

    test("allows safe read-only git operations and normalized absolute paths", () => {
      const actor = createActor("implementer");
      const safe = [
        ["git", "status"],
        ["git", "diff"],
        ["git", "diff", "HEAD"],
        ["git", "-C", "packages/olt", "status"],
        ["git", "show", "HEAD"],
        ["git", "log", "-p"],
        ["git", "grep", "commit", "--", "README.md"],
        ["git", "ls-files"],
        ["git", "rev-parse", "--show-toplevel"],
      ];
      for (const cmd of safe)
        expect(verifyCommandAuthorization(actor, cmd, samplePolicy).authorized).toBe(true);

      const normRes = verifyCommandAuthorization(
        actor,
        ["/usr/bin/env", "CI=1", "/usr/bin/bun", "test"],
        samplePolicy,
      );
      expect(normRes.error_code).toBe("UNBOUNDED_TEST_RUNNER_FORBIDDEN");
      const envRes = verifyCommandAuthorization(
        actor,
        ["/usr/bin/env", "-S", "git status"],
        samplePolicy,
      );
      expect(envRes.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");
    });
  });

  describe("role confinement, fail-closed snapshot, and unregistered actor rejection", () => {
    test("cognitive validators are hard-locked to 0 commands regardless of flags", () => {
      const validatorActors = [
        createActor("validator", false),
        createActor("validator", true),
        createActor("critic", true),
        createActor("completeness-critic", true),
        createActor("plan-validator", true),
        createActor("sub-investigator", true),
      ];
      for (const actor of validatorActors) {
        const res = verifyCommandAuthorization(actor, "git status", samplePolicy);
        expect(res.authorized).toBe(false);
        expect(res.error_code).toBe("COGNITIVE_VALIDATOR_COMMAND_FORBIDDEN");
        expect(res.message).toContain("Cognitive Validators are locked to 0 command execution");
      }
    });

    test("supervisors are forbidden from executing tests", () => {
      const supervisors = ["coordinator", "orchestrator", "mind", "meta-auditor", "mind-auditor"];
      const testCommands = [
        "bun test",
        "vitest",
        "npm test",
        "pytest",
        "cargo test",
        "run_all.spec.ts",
      ];
      for (const role of supervisors) {
        for (const cmd of testCommands) {
          const res = verifyCommandAuthorization(
            { role, can_execute_shell: true },
            cmd,
            samplePolicy,
          );
          expect(res.authorized).toBe(false);
          expect(res.error_code).toBe("SUPERVISOR_TEST_EXECUTION_FORBIDDEN");
        }
      }
    });

    test("implementers are restricted by policy snapshots and unbounded tests", () => {
      const imp = createActor("implementer");
      expect(verifyCommandAuthorization(imp, "git commit -m 'feat'", samplePolicy).error_code).toBe(
        "PERMISSION_DENIED",
      );
      expect(verifyCommandAuthorization(imp, "git push", samplePolicy).error_code).toBe(
        "PERMISSION_DENIED",
      );
      expect(verifyCommandAuthorization(imp, "bun test", samplePolicy).error_code).toBe(
        "UNBOUNDED_TEST_RUNNER_FORBIDDEN",
      );
      expect(
        verifyCommandAuthorization(imp, "bun test tests/unit/foo.test.ts", samplePolicy).authorized,
      ).toBe(true);
      expect(
        verifyCommandAuthorization(imp, ["curl", "https://example.test"], samplePolicy).error_code,
      ).toBe("PERMISSION_DENIED");
    });

    test("unregistered, unverified, or non-executable actors calling recover or commands fail closed with PERMISSION_DENIED", () => {
      const unresolvedActors: readonly (
        | { readonly role?: string; readonly agent_id?: string }
        | null
        | undefined
      )[] = [
        { role: "" },
        { role: "   " },
        { role: "unresolved" },
        { agent_id: "ghost" },
        null,
        undefined,
      ];

      for (const actor of unresolvedActors) {
        const res = verifyCommandAuthorization(actor, "recover", samplePolicy);
        expect(res.authorized).toBe(false);
        expect(res.error_code).toBe("PERMISSION_DENIED");
        expect(res.reason).toBe("Unresolved actor role");
        expect(res.message).toBe(
          "[PERMISSION_DENIED] Unresolved actor role is not authorized to execute commands.",
        );
      }

      const unverifiedActors: readonly {
        readonly role: string;
        readonly agent_id?: string;
        readonly can_execute_shell?: boolean;
      }[] = [
        { role: "unregistered", agent_id: "anon-1" },
        { role: "unknown_actor", agent_id: "unresolved_id" },
        { role: "anonymous" },
        { role: "intruder" },
        { role: "guest" },
        { role: "unregistered_worker", can_execute_shell: true },
      ];

      const recoverInvocations = [
        "recover",
        "bun harness.ts recover --run .olt/capsules/test-run",
        ["recover"],
        ["bun", "harness.ts", "recover"],
        ["bun", "harness.ts", "recover", "--run", ".olt/capsules/r-1", "--actor", "unregistered"],
        ["bun", "run", "recover"],
        ["node", "recover.js"],
      ];

      for (const actor of unverifiedActors) {
        for (const cmd of recoverInvocations) {
          const res = verifyCommandAuthorization(actor, cmd, samplePolicy);
          expect(res.authorized).toBe(false);
          expect(res.error_code).toBe("PERMISSION_DENIED");
          expect(res.message).toContain("[PERMISSION_DENIED]");
        }
        const diagnosticRes = verifyCommandAuthorization(actor, "git status", samplePolicy);
        expect(diagnosticRes.authorized).toBe(false);
        expect(diagnosticRes.error_code).toBe("PERMISSION_DENIED");
      }

      const explicitDisabled = createActor("worker", false);
      expect(verifyCommandAuthorization(explicitDisabled, "ls", samplePolicy).error_code).toBe(
        "PERMISSION_DENIED",
      );

      const malformed = { ...samplePolicy, forbidden_commands: "curl" } as unknown as RepoPolicy;
      expect(() =>
        verifyCommandAuthorization(
          createActor("implementer"),
          ["curl"],
          parseAuthorityRepoPolicy(malformed),
        ),
      ).toThrow(/forbidden_commands/i);
    });
  });
});
