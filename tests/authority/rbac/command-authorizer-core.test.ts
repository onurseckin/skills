import { describe, expect, test } from "bun:test";
import { verifyCommandAuthorization } from "../../../olt/scripts/src/authority/rbac/index.ts";

describe("Authority RBAC - Command Authorizer Core Verification", () => {
  test("rejects empty command list", () => {
    const result = verifyCommandAuthorization("implementer", []);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("EMPTY_COMMAND");
  });

  test("enforces zero test runs and zero code edits for supervisory and validator roles while allowing permitted CLI commands", () => {
    const supervisoryAndValidatorRoles = [
      "mind",
      "mind-supervisor",
      "mind-auditor",
      "skill-auditor",
      "orchestrator",
      "coordinator",
      "autonomic-watchdog",
      "validator",
      "critic",
      "cognitive-validator",
      "cognitive_validator",
      "completeness-critic",
      "ui-validator",
      "sub-validator",
      "plan-validator",
    ];

    for (const role of supervisoryAndValidatorRoles) {
      const resTest = verifyCommandAuthorization(role, [
        "bun",
        "test",
        "tests/authority/rbac/a.test.ts",
      ]);
      expect(resTest.authorized).toBe(false);
      expect(resTest.reason).toBe("SUPERVISOR_ZERO_TEST_RUNS");

      const resCodeEdit = verifyCommandAuthorization(role, ["rm", "-rf", "src/app.ts"]);
      expect(resCodeEdit.authorized).toBe(false);
      expect(resCodeEdit.reason).toBe(
        role === "coordinator" ? "ROLE_BOUNDARY_DEVIATION" : "SUPERVISOR_ZERO_CODE_EDITS",
      );

      const resWriteTool = verifyCommandAuthorization(role, ["write_to_file", "foo.ts"]);
      expect(resWriteTool.authorized).toBe(false);
      expect(resWriteTool.reason).toBe(
        role === "coordinator" ? "ROLE_BOUNDARY_DEVIATION" : "SUPERVISOR_ZERO_CODE_EDITS",
      );

      const resStatus = verifyCommandAuthorization(role, ["git", "status"]);
      expect(resStatus.authorized).toBe(true);
      expect(resStatus.reason).toBeUndefined();

      const resDiff = verifyCommandAuthorization(role, ["git", "diff"]);
      expect(resDiff.authorized).toBe(true);

      const resHarness = verifyCommandAuthorization(role, ["bun", "harness.ts", "task:check"]);
      expect(resHarness.authorized).toBe(true);
    }
  });

  test("denies whole-suite test runs", () => {
    const wholeSuiteCommands: readonly string[][] = [
      ["bun", "test"],
      ["bun", "test", "--bail"],
      ["bun", "test", "--coverage"],
      ["bun-test"],
      ["npm", "test"],
      ["npm", "run", "test"],
      ["pnpm", "test"],
      ["yarn", "test"],
      ["vitest"],
      ["npx", "vitest"],
      ["jest"],
      ["npx", "jest"],
    ];

    for (const cmd of wholeSuiteCommands) {
      const res = verifyCommandAuthorization("implementer", cmd);
      expect(res.authorized).toBe(false);
      expect(res.reason).toBe("WHOLE_SUITE_TEST_RUN_DENIED");
    }
  });

  test("authorizes file-scoped test commands for implementer", () => {
    const scopedCommands: readonly string[][] = [
      ["bun", "test", "tests/authority/rbac/auth.test.ts"],
      ["bun", "test", "tests/authority/tokens/flow.spec.ts"],
      ["bun", "test", "tests/authority/session/rbac.test.js"],
      ["bun", "test", "--timeout", "5000", "tests/authority/grants/guard.test.ts"],
    ];

    for (const cmd of scopedCommands) {
      const res = verifyCommandAuthorization("implementer", cmd);
      expect(res.authorized).toBe(true);
      expect(res.reason).toBeUndefined();
    }
  });

  test("denies unauthorized git mutations", () => {
    const dangerousGitCommands: readonly string[][] = [
      ["git", "checkout", "main"],
      ["git", "checkout", "-b", "new-branch"],
      ["git", "reset", "--hard", "HEAD~1"],
      ["git", "reset", "HEAD"],
      ["git", "push", "origin", "main", "--force"],
      ["git", "push", "origin", "main", "-f"],
      ["git", "push", "origin", "main", "--force-with-lease"],
      ["git", "clean", "-f"],
      ["git", "clean", "-fd"],
      ["git", "clean", "-fx"],
      ["git", "clean", "--force"],
    ];

    for (const cmd of dangerousGitCommands) {
      const res = verifyCommandAuthorization("implementer", cmd);
      expect(res.authorized).toBe(false);
      expect(res.reason).toBe("UNAUTHORIZED_GIT_MUTATION");
    }
  });

  test("authorizes safe git queries and CLI tools for implementer", () => {
    const safeCommands: readonly string[][] = [
      ["git", "status"],
      ["git", "diff", "--stat"],
      ["bun", "harness.ts", "task:check", "--run", "run-1", "--task", "task-1"],
      ["node", "-e", "console.log(1)"],
    ];

    for (const cmd of safeCommands) {
      const res = verifyCommandAuthorization("implementer", cmd);
      expect(res.authorized).toBe(true);
      expect(res.reason).toBeUndefined();
    }
  });

  test("covers all test runner CLI patterns and variants", () => {
    expect(verifyCommandAuthorization("implementer", ["npm", "t"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("implementer", ["pnpm", "t"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("implementer", ["yarn", "t"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("implementer", ["bun", "run", "test"]).authorized).toBe(
      false,
    );
    expect(
      verifyCommandAuthorization("implementer", ["bun", "run", "test", "foo.test.ts"]).authorized,
    ).toBe(true);

    expect(verifyCommandAuthorization("validator", ["pytest"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["npx", "pytest"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["npx", "vitest"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["npx", "jest"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["npm", "t"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["npm", "run", "test"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["pnpm", "t"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["pnpm", "run", "test"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["yarn", "t"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["yarn", "run", "test"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["cargo", "test"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["cargo", "t"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["cargo", "run", "test"]).authorized).toBe(
      false,
    );
    expect(verifyCommandAuthorization("validator", ["bun", "run", "test"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["bun-test"]).authorized).toBe(false);

    expect(verifyCommandAuthorization("implementer", ["npm", "run", "build"]).authorized).toBe(
      true,
    );
    expect(verifyCommandAuthorization("implementer", ["npm", "install"]).authorized).toBe(true);
    expect(verifyCommandAuthorization("implementer", ["pnpm", "run", "build"]).authorized).toBe(
      true,
    );
    expect(verifyCommandAuthorization("implementer", ["yarn", "build"]).authorized).toBe(true);

    expect(
      verifyCommandAuthorization("validator", ["sed", "-i", "s/a/b/", "file.txt"]).authorized,
    ).toBe(false);
    expect(
      verifyCommandAuthorization("validator", ["sed", "-i.bak", "s/a/b/", "file.txt"]).authorized,
    ).toBe(false);
    expect(
      verifyCommandAuthorization("validator", ["sed", "--in-place", "s/a/b/", "file.txt"])
        .authorized,
    ).toBe(false);
    expect(
      verifyCommandAuthorization("implementer", ["sed", "-i", "s/a/b/", "file.txt"]).authorized,
    ).toBe(true);

    expect(
      verifyCommandAuthorization("implementer", ["bun-test", "tests/authority/rbac/foo.test.ts"])
        .authorized,
    ).toBe(true);
    expect(
      verifyCommandAuthorization("validator", ["custom-runner", "tests/authority/rbac/foo.test.ts"])
        .authorized,
    ).toBe(false);

    expect(verifyCommandAuthorization("implementer", ["git", "clean", "-xdf"]).authorized).toBe(
      false,
    );
    expect(verifyCommandAuthorization("implementer", ["git", "clean", "-n"]).authorized).toBe(true);
    expect(verifyCommandAuthorization("implementer", ["git", "clean"]).authorized).toBe(true);

    const muts = [
      "touch",
      "mv",
      "cp",
      "mkdir",
      "tee",
      "truncate",
      "patch",
      "chmod",
      "chown",
      "notebookedit",
      "apply_diff",
      "edit_file",
      "apply_patch",
    ];
    for (const m of muts) {
      expect(verifyCommandAuthorization("validator", [m, "arg"]).authorized).toBe(false);
    }
  });
});
