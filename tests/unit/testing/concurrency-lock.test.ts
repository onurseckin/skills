import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { testSummaryCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/test-summary.ts";
import {
  acquireFullSuiteTestLock,
  createTestSummaryRecord,
  formatTestSummaryMarkdown,
  getLatestTestSummary,
  guardTestExecution,
  isFullSuiteTestCommand,
  isProcessAlive,
  isTestFilePath,
  readLockPayload,
  resolveLockPath,
  saveTestSummary,
  type TestSummaryRecord,
} from "../../../orchestrating-long-tasks/scripts/src/testing/concurrency-lock.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("isTestFilePath", () => {
  test("identifies test and spec file paths correctly", () => {
    expect(isTestFilePath("tests/unit/agents/grants.test.ts")).toBe(true);
    expect(isTestFilePath("tests/unit/testing/concurrency-lock.test.ts")).toBe(true);
    expect(isTestFilePath("src/component.spec.ts")).toBe(true);
    expect(isTestFilePath("src/component.test.js")).toBe(true);
    expect(isTestFilePath("tests/unit/foo.test.tsx")).toBe(true);
    expect(isTestFilePath("tests/unit/foo.spec.jsx")).toBe(true);
    expect(isTestFilePath("tests\\unit\\windows.test.ts")).toBe(true);

    expect(isTestFilePath("tests")).toBe(false);
    expect(isTestFilePath("tests/")).toBe(false);
    expect(isTestFilePath("tests/unit")).toBe(false);
    expect(isTestFilePath("src/index.ts")).toBe(false);
    expect(isTestFilePath("README.md")).toBe(false);
  });
});

describe("isFullSuiteTestCommand", () => {
  test("identifies full suite test commands as true", () => {
    expect(isFullSuiteTestCommand("bun test")).toBe(true);
    expect(isFullSuiteTestCommand(["bun", "test"])).toBe(true);
    expect(isFullSuiteTestCommand("bun test --coverage")).toBe(true);
    expect(isFullSuiteTestCommand(["bun", "test", "--coverage", "--bail"])).toBe(true);
    expect(isFullSuiteTestCommand("bun test tests")).toBe(true);
    expect(isFullSuiteTestCommand("bun test tests/")).toBe(true);
    expect(isFullSuiteTestCommand("bun test tests/unit")).toBe(true);
    expect(isFullSuiteTestCommand("bun run test")).toBe(true);
    expect(isFullSuiteTestCommand("npm test")).toBe(true);
    expect(isFullSuiteTestCommand("npm run test")).toBe(true);
    expect(isFullSuiteTestCommand("pnpm test")).toBe(true);
    expect(isFullSuiteTestCommand("yarn test")).toBe(true);
    expect(isFullSuiteTestCommand("vitest")).toBe(true);
    expect(isFullSuiteTestCommand("jest")).toBe(true);
    expect(isFullSuiteTestCommand("test")).toBe(true);
  });

  test("identifies scoped single-file test commands as false (never full suite)", () => {
    expect(isFullSuiteTestCommand("bun test tests/unit/agents/grants.test.ts")).toBe(false);
    expect(
      isFullSuiteTestCommand(["bun", "test", "tests/unit/testing/concurrency-lock.test.ts"]),
    ).toBe(false);
    expect(
      isFullSuiteTestCommand("bun test --coverage tests/unit/cli/coverage-check.test.ts"),
    ).toBe(false);
    expect(isFullSuiteTestCommand("bun test ./tests/unit/foo.spec.ts")).toBe(false);
    expect(isFullSuiteTestCommand("bun test --bail tests/unit/bar.test.js")).toBe(false);
  });

  test("identifies non-test commands as false", () => {
    expect(isFullSuiteTestCommand("bun run build")).toBe(false);
    expect(isFullSuiteTestCommand(["git", "status"])).toBe(false);
    expect(isFullSuiteTestCommand("echo hello")).toBe(false);
    expect(isFullSuiteTestCommand("")).toBe(false);
    expect(isFullSuiteTestCommand([])).toBe(false);
  });
});

describe("isProcessAlive", () => {
  test("returns true for current process PID", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("returns false for non-existent dead PID", () => {
    expect(isProcessAlive(99999999)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
  });
});

describe("acquireFullSuiteTestLock & Release", () => {
  test("successfully acquires and releases full-suite lock in runDir", async () => {
    const runDir = scratchRoot(import.meta.path, "lock-acquire-release");
    const lockResult = await acquireFullSuiteTestLock({
      runDir,
      agentId: "test-agent-1",
      command: "bun test",
    });

    expect(lockResult.acquired).toBe(true);
    expect(lockResult.lockPath).toBeDefined();
    expect(existsSync(lockResult.lockPath!)).toBe(true);

    const payload = readLockPayload(lockResult.lockPath!);
    expect(payload).not.toBeNull();
    expect(payload!.pid).toBe(process.pid);
    expect(payload!.agent_id).toBe("test-agent-1");
    expect(payload!.command).toBe("bun test");

    await lockResult.release();
    expect(existsSync(lockResult.lockPath!)).toBe(false);
  });

  test("rejects concurrent lock acquisition when actively held", async () => {
    const runDir = scratchRoot(import.meta.path, "lock-concurrent-rejection");
    const lock1 = await acquireFullSuiteTestLock({
      runDir,
      agentId: "agent-holding",
    });

    expect(lock1.acquired).toBe(true);

    // Second lock attempt with timeout 0 should immediately fail
    const lock2 = await acquireFullSuiteTestLock({
      runDir,
      agentId: "agent-blocked",
      timeoutMs: 0,
    });

    expect(lock2.acquired).toBe(false);
    expect(lock2.reason).toContain("Full-suite test lock held by active PID");

    await lock1.release();
  });

  test("acquires lock after waiting if prior lock releases before timeout", async () => {
    const runDir = scratchRoot(import.meta.path, "lock-timeout-retry");
    const lock1 = await acquireFullSuiteTestLock({
      runDir,
      agentId: "agent-first",
    });

    expect(lock1.acquired).toBe(true);

    // Release after 30ms in background
    setTimeout(async () => {
      await lock1.release();
    }, 30);

    const lock2 = await acquireFullSuiteTestLock({
      runDir,
      agentId: "agent-second",
      timeoutMs: 500,
      retryIntervalMs: 15,
    });

    expect(lock2.acquired).toBe(true);
    await lock2.release();
  });
});

describe("Stale Lock Recovery", () => {
  test("recovers stale lock if PID is dead", async () => {
    const runDir = scratchRoot(import.meta.path, "stale-dead-pid");
    const lockPath = resolveLockPath(runDir);
    mkdirSync(dirname(lockPath), { recursive: true });

    // Write a stale lock pointing to non-existent PID
    const deadPayload = {
      pid: 99999999,
      agent_id: "dead-agent",
      acquired_at_utc: new Date(Date.now() - 60000).toISOString(),
      acquired_at_ms: Date.now() - 60000,
      hostname: "test-host",
    };
    writeFileSync(lockPath, JSON.stringify(deadPayload, null, 2), "utf8");

    const lockResult = await acquireFullSuiteTestLock({
      runDir,
      agentId: "recovering-agent",
    });

    expect(lockResult.acquired).toBe(true);
    const newPayload = readLockPayload(lockPath);
    expect(newPayload!.agent_id).toBe("recovering-agent");
    expect(newPayload!.pid).toBe(process.pid);

    await lockResult.release();
  });

  test("recovers corrupted / empty lock file", async () => {
    const runDir = scratchRoot(import.meta.path, "stale-corrupted");
    const lockPath = resolveLockPath(runDir);
    mkdirSync(dirname(lockPath), { recursive: true });

    // Write invalid JSON
    writeFileSync(lockPath, "{ corrupt json ...", "utf8");

    const lockResult = await acquireFullSuiteTestLock({
      runDir,
      agentId: "recovering-agent-2",
    });

    expect(lockResult.acquired).toBe(true);
    expect(existsSync(lockPath)).toBe(true);

    await lockResult.release();
  });
});

describe("Scoped Single-File Bypass (guardTestExecution)", () => {
  test("allows scoped single-file test to bypass active full-suite lock", async () => {
    const runDir = scratchRoot(import.meta.path, "scoped-bypass");
    const fullLock = await acquireFullSuiteTestLock({
      runDir,
      agentId: "full-suite-agent",
    });

    expect(fullLock.acquired).toBe(true);

    // Scoped test command should execute without blocking
    let executedAction = false;
    const scopedResult = await guardTestExecution(
      "bun test tests/unit/agents/grants.test.ts",
      () => {
        executedAction = true;
        return 42;
      },
      { runDir },
    );

    expect(scopedResult.executed).toBe(true);
    expect(scopedResult.result).toBe(42);
    expect(scopedResult.bypassedLock).toBe(true);
    expect(executedAction).toBe(true);

    await fullLock.release();
  });

  test("blocks full-suite test when lock cannot be acquired", async () => {
    const runDir = scratchRoot(import.meta.path, "full-blocked");
    const fullLock = await acquireFullSuiteTestLock({
      runDir,
      agentId: "full-suite-agent",
    });

    expect(fullLock.acquired).toBe(true);

    let executedAction = false;
    const guardedResult = await guardTestExecution(
      "bun test",
      () => {
        executedAction = true;
        return "should not run";
      },
      { runDir, timeoutMs: 0 },
    );

    expect(guardedResult.executed).toBe(false);
    expect(guardedResult.bypassedLock).toBe(false);
    expect(guardedResult.reason).toContain("Full-suite test lock held by active PID");
    expect(executedAction).toBe(false);

    await fullLock.release();
  });
});

describe("Test Summary Memoization", () => {
  test("saves and retrieves test summary records", async () => {
    const runDir = scratchRoot(import.meta.path, "summary-memoization");

    const initial = await getLatestTestSummary({ runDir });
    expect(initial).toBeNull();

    const summary: TestSummaryRecord = createTestSummaryRecord({
      passed_count: 50,
      failed_count: 0,
      skipped_count: 3,
      duration_ms: 1250,
      coverage_percentage: 97.5,
      test_files_count: 12,
      scope: "full",
      agent_id: "agent-coordinator",
    });

    const savedPath = await saveTestSummary(summary, { runDir });
    expect(existsSync(savedPath)).toBe(true);

    const latest = await getLatestTestSummary({ runDir });
    expect(latest).not.toBeNull();
    expect(latest!.passed_count).toBe(50);
    expect(latest!.failed_count).toBe(0);
    expect(latest!.skipped_count).toBe(3);
    expect(latest!.duration_ms).toBe(1250);
    expect(latest!.coverage_percentage).toBe(97.5);
    expect(latest!.test_files_count).toBe(12);
    expect(latest!.scope).toBe("full");
    expect(latest!.agent_id).toBe("agent-coordinator");
  });

  test("formats test summary markdown with correct status badges", () => {
    const passingSummary = createTestSummaryRecord({
      passed_count: 10,
      failed_count: 0,
      duration_ms: 100,
      coverage_percentage: 95.0,
      scope: "full",
    });
    const passingMd = formatTestSummaryMarkdown(passingSummary);
    expect(passingMd).toContain("✅ PASSED");
    expect(passingMd).toContain("95.0%");

    const failingSummary = createTestSummaryRecord({
      passed_count: 8,
      failed_count: 2,
      duration_ms: 150,
      coverage_percentage: 88.0,
      scope: "scoped",
    });
    const failingMd = formatTestSummaryMarkdown(failingSummary);
    expect(failingMd).toContain("❌ FAILED");
    expect(failingMd).toContain("- **Failed**: 2");
  });
});

describe("CLI Command: test:summary", () => {
  test("returns empty status when no test summary exists", async () => {
    const runDir = scratchRoot(import.meta.path, "cli-test-summary-empty");
    const result = await testSummaryCommand({ run: runDir });

    expect(result.found).toBe(false);
    expect(result.summary).toBeNull();
    expect(String(result.markdown)).toContain("No test summary records found");
  });

  test("records and saves summary when passed and failed flags are provided", async () => {
    const runDir = scratchRoot(import.meta.path, "cli-test-summary-save");
    const result = await testSummaryCommand({
      run: runDir,
      passed: "25",
      failed: "0",
      skipped: "1",
      duration: "450",
      coverage: "98.2",
      commit: "abcdef123456",
      files: "5",
      scope: "scoped",
      agent: "implementer-p42",
    });

    expect(result.saved).toBe(true);
    expect(result.passed_count).toBe(25);
    expect(result.failed_count).toBe(0);
    expect(result.skipped_count).toBe(1);
    expect(result.duration_ms).toBe(450);
    expect(result.coverage_percentage).toBe(98.2);
    expect(result.scope).toBe("scoped");
    expect(String(result.markdown)).toContain("✅ PASSED");

    // Query it back
    const queryResult = await testSummaryCommand({ run: runDir });
    expect(queryResult.found).toBe(true);
    expect(queryResult.passed_count).toBe(25);
    expect(queryResult.failed_count).toBe(0);
  });

  test("executes via CLI execute dispatcher", async () => {
    const runDir = scratchRoot(import.meta.path, "cli-execute-integration");
    const execResult = await execute([
      "test:summary",
      "--run",
      runDir,
      "--passed",
      "30",
      "--failed",
      "0",
      "--duration",
      "320",
    ]);

    expect(execResult.saved).toBe(true);
    expect(execResult.passed_count).toBe(30);

    const viewResult = await execute(["test:summary", "--run", runDir]);
    expect(viewResult.found).toBe(true);
    expect(viewResult.passed_count).toBe(30);
  });
});
