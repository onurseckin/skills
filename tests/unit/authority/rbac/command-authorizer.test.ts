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

  test("captures stderr output during command execution", async () => {
    const result = await executeShieldedCommand(
      "implementer-1",
      ["bun", "-e", "console.error('critical stderr test output'); process.exit(0);"],
      { actorRole: "implementer" },
    );
    expect(result.authorized).toBe(true);
    expect(result.success).toBe(true);
    expect(result.stderr).toContain("critical stderr test output");
  });

  test("handles process error event when binary cannot be spawned", async () => {
    const result = await executeShieldedCommand(
      "implementer-1",
      ["non_existent_binary_xyz_123456789"],
      { actorRole: "implementer" },
    );
    expect(result.authorized).toBe(true);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  test("infers actor role from various actorId patterns and falls back to implementer", async () => {
    // Actor ID with unmatched name falls back to implementer
    const resFallback = await executeShieldedCommand(
      "custom-agent-name",
      ["echo", "hi"],
      { env: { FOO: "BAR" }, cwd: process.cwd() },
    );
    expect(resFallback.authorized).toBe(true);

    // Inferred coordinator role blocked from file mutations
    const resCoord = await executeShieldedCommand(
      "coordinator-alpha",
      ["rm", "file.txt"],
    );
    expect(resCoord.authorized).toBe(false);
    expect(resCoord.reason).toBe("ROLE_BOUNDARY_DEVIATION");

    // Inferred orchestrator role blocked from test runs
    const resOrch = await executeShieldedCommand(
      "orch_sub_orchestrator",
      ["bun", "test", "foo.test.ts"],
    );
    expect(resOrch.authorized).toBe(false);
    expect(resOrch.reason).toBe("SUPERVISOR_ZERO_TEST_RUNS");

    // Inferred mind role
    const resMind = await executeShieldedCommand(
      "mind-lead",
      ["touch", "foo.ts"],
    );
    expect(resMind.authorized).toBe(false);

    // Inferred critic role
    const resCritic = await executeShieldedCommand(
      "sub-critic-1",
      ["bun", "test", "foo.test.ts"],
    );
    expect(resCritic.authorized).toBe(false);

    // Inferred worker role allowed file-scoped test
    const resWorker = await executeShieldedCommand(
      "worker_node_1",
      ["echo", "ok"],
    );
    expect(resWorker.authorized).toBe(true);
  });

  test("covers all test runner CLI patterns and variants", () => {
    // npm t, pnpm t, yarn t
    expect(verifyCommandAuthorization("implementer", ["npm", "t"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("implementer", ["pnpm", "t"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("implementer", ["yarn", "t"]).authorized).toBe(false);

    // bun run test (whole suite)
    expect(verifyCommandAuthorization("implementer", ["bun", "run", "test"]).authorized).toBe(false);

    // bun run test with specific test file (scoped)
    expect(verifyCommandAuthorization("implementer", ["bun", "run", "test", "foo.test.ts"]).authorized).toBe(true);

    // Test runner commands for validator (isAnyTestRun)
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
    expect(verifyCommandAuthorization("validator", ["cargo", "run", "test"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["bun", "run", "test"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["bun-test"]).authorized).toBe(false);

    // bun run test for implementer
    expect(verifyCommandAuthorization("implementer", ["bun", "run", "test"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("implementer", ["bun", "run", "test", "foo.test.ts"]).authorized).toBe(true);

    // npm commands that are not whole suite tests
    expect(verifyCommandAuthorization("implementer", ["npm", "run", "build"]).authorized).toBe(true);
    expect(verifyCommandAuthorization("implementer", ["npm", "install"]).authorized).toBe(true);
    expect(verifyCommandAuthorization("implementer", ["pnpm", "run", "build"]).authorized).toBe(true);
    expect(verifyCommandAuthorization("implementer", ["yarn", "build"]).authorized).toBe(true);

    // sed mutation commands (covers arg === -i, startsWith -i, startsWith --in-place)
    expect(verifyCommandAuthorization("validator", ["sed", "-i", "s/a/b/", "file.txt"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["sed", "-i.bak", "s/a/b/", "file.txt"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("validator", ["sed", "--in-place", "s/a/b/", "file.txt"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("implementer", ["sed", "-i", "s/a/b/", "file.txt"]).authorized).toBe(true);

    // bun-test with test file argument
    expect(verifyCommandAuthorization("implementer", ["bun-test", "tests/unit/foo.test.ts"]).authorized).toBe(true);

    // Custom runner with test file argument for validator
    expect(verifyCommandAuthorization("validator", ["custom-runner", "tests/unit/foo.test.ts"]).authorized).toBe(false);

    // Git clean variants
    expect(verifyCommandAuthorization("implementer", ["git", "clean", "-xdf"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("implementer", ["git", "clean", "-n"]).authorized).toBe(true);
    expect(verifyCommandAuthorization("implementer", ["git", "clean"]).authorized).toBe(true);

    // various file mutation commands for validator
    const muts = ["touch", "mv", "cp", "mkdir", "tee", "truncate", "patch", "chmod", "chown", "notebookedit", "apply_diff", "edit_file", "apply_patch"];
    for (const m of muts) {
      expect(verifyCommandAuthorization("validator", [m, "arg"]).authorized).toBe(false);
    }
  });
});

