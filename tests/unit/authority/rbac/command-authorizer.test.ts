import { describe, expect, test } from "bun:test";
import {
  executeShieldedCommand,
  verifyCommandAuthorization,
} from "../../../../olt/scripts/src/authority/rbac/index.ts";

describe("verifyCommandAuthorization", () => {
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
      const resTest = verifyCommandAuthorization(role, ["bun", "test", "tests/unit/a.test.ts"]);
      expect(resTest.authorized).toBe(false);
      expect(resTest.reason).toBe("SUPERVISOR_ZERO_TEST_RUNS");

      const resCodeEdit = verifyCommandAuthorization(role, ["rm", "-rf", "src/app.ts"]);
      expect(resCodeEdit.authorized).toBe(false);
      expect(resCodeEdit.reason).toBe("SUPERVISOR_ZERO_CODE_EDITS");

      const resWriteTool = verifyCommandAuthorization(role, ["write_to_file", "foo.ts"]);
      expect(resWriteTool.authorized).toBe(false);
      expect(resWriteTool.reason).toBe("SUPERVISOR_ZERO_CODE_EDITS");

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
      ["bun", "test", "tests/unit/auth.test.ts"],
      ["bun", "test", "tests/e2e/flow.spec.ts"],
      ["bun", "test", "tests/unit/rbac.test.js"],
      ["bun", "test", "--timeout", "5000", "tests/unit/guard.test.ts"],
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
});

describe("executeShieldedCommand", () => {
  test("denies file mutation commands for supervisor/validator without execution", async () => {
    const result = await executeShieldedCommand("validator-1", ["rm", "-rf", "src/core"], {
      actorRole: "validator",
    });
    expect(result.success).toBe(false);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("SUPERVISOR_ZERO_CODE_EDITS");
    expect(result.exitCode).toBe(1);
  });

  test("denies whole-suite test execution under shielded shell", async () => {
    const result = await executeShieldedCommand("implementer-1", ["bun", "test"], {
      actorRole: "implementer",
    });
    expect(result.success).toBe(false);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("WHOLE_SUITE_TEST_RUN_DENIED");
  });

  test("executes authorized file-scoped command successfully", async () => {
    const result = await executeShieldedCommand(
      "implementer-1",
      ["bun", "-e", "console.log('shielded-execution-pass')"],
      { actorRole: "implementer" },
    );
    expect(result.authorized).toBe(true);
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("shielded-execution-pass");
  });

  test("allows permitted CLI command execution for validator under shielded shell", async () => {
    const result = await executeShieldedCommand(
      "validator_task-1_sub",
      ["node", "-e", "console.log('validator-read-pass')"],
      { actorRole: "validator" },
    );
    expect(result.authorized).toBe(true);
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("validator-read-pass");
  });

  test("captures error and exit code on command failure", async () => {
    const result = await executeShieldedCommand("worker-1", ["bun", "-e", "process.exit(42)"], {
      actorRole: "worker",
    });
    expect(result.authorized).toBe(true);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(42);
  });
});
