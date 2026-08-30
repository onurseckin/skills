import { describe, expect, test } from "bun:test";
import {
  compileEffectiveForbiddenPatterns,
  isTargetTestArgument,
  isUntargetedTestCommand,
} from "../../../../olt/scripts/src/policy/rbac/index.ts";
import type { RepoPolicy } from "../../../../olt/scripts/src/policy/index.ts";
import { samplePolicy } from "./fixtures.ts";

describe("RBAC Pattern Compiler & Test Runner Detection", () => {
  describe("compileEffectiveForbiddenPatterns", () => {
    test("compiles supervisor patterns for cognitive validators and caches pattern instances", () => {
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
        expect(patterns.length).toBeGreaterThan(1);
        expect(patterns.some((p) => p.test("git commit -m 'msg'"))).toBe(true);
        expect(patterns.some((p) => p.test("bun test"))).toBe(true);
        expect(patterns.some((p) => p.test("git status"))).toBe(false);
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
});
