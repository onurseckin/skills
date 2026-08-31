import { beforeEach, describe, expect, test } from "bun:test";
import { testSummaryCommand } from "../../../olt/scripts/src/cli/commands/test-summary.ts";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
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
  resetConcurrencyLockStore,
  resolveLockPath,
  saveTestSummary,
  setInMemoryLockPayload,
  type TestSummaryRecord,
} from "../../../olt/scripts/src/testing/concurrency-lock.ts";

describe("concurrency-lock (in-memory zero-disk)", () => {
  beforeEach(() => {
    resetConcurrencyLockStore();
  });

  describe("isTestFilePath", () => {
    test("identifies test/spec file paths and rejects non-tests", () => {
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

    test("identifies scoped single-file test commands as false", () => {
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
    test("returns true for current PID and false for dead PIDs", () => {
      expect(isProcessAlive(process.pid)).toBe(true);
      expect(isProcessAlive(99999999)).toBe(false);
      expect(isProcessAlive(-1)).toBe(false);
      expect(isProcessAlive(0)).toBe(false);
    });
  });

  describe("acquireFullSuiteTestLock & Release", () => {
    test("successfully acquires and releases in-memory lock", async () => {
      const runDir = "/virtual/test-locks/run-1";
      const lockResult = await acquireFullSuiteTestLock({
        runDir,
        agentId: "test-agent-1",
        command: "bun test",
      });
      expect(lockResult.acquired).toBe(true);
      expect(lockResult.lockPath).toBeDefined();

      const payload = readLockPayload(lockResult.lockPath!);
      expect(payload).not.toBeNull();
      expect(payload!.pid).toBe(process.pid);
      expect(payload!.agent_id).toBe("test-agent-1");
      expect(payload!.command).toBe("bun test");

      await lockResult.release();
      expect(readLockPayload(lockResult.lockPath!)).toBeNull();
    });

    test("rejects concurrent lock acquisition when actively held", async () => {
      const runDir = "/virtual/test-locks/run-2";
      const lock1 = await acquireFullSuiteTestLock({ runDir, agentId: "agent-holding" });
      expect(lock1.acquired).toBe(true);

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
      const runDir = "/virtual/test-locks/run-3";
      const lock1 = await acquireFullSuiteTestLock({ runDir, agentId: "agent-first" });
      expect(lock1.acquired).toBe(true);

      setTimeout(async () => {
        await lock1.release();
      }, 20);

      const lock2 = await acquireFullSuiteTestLock({
        runDir,
        agentId: "agent-second",
        timeoutMs: 400,
        retryIntervalMs: 10,
      });
      expect(lock2.acquired).toBe(true);
      await lock2.release();
    });
  });

  describe("Stale Lock Recovery", () => {
    test("recovers stale lock if PID is dead", async () => {
      const runDir = "/virtual/test-locks/run-stale-dead";
      const lockPath = resolveLockPath(runDir);
      setInMemoryLockPayload(lockPath, {
        pid: 99999999,
        agent_id: "dead-agent",
        acquired_at_utc: new Date().toISOString(),
        acquired_at_ms: Date.now() - 60000,
        hostname: "test-host",
      });

      const lockResult = await acquireFullSuiteTestLock({ runDir, agentId: "recovering-agent" });
      expect(lockResult.acquired).toBe(true);
      const newPayload = readLockPayload(lockPath);
      expect(newPayload!.agent_id).toBe("recovering-agent");
      expect(newPayload!.pid).toBe(process.pid);
      await lockResult.release();
    });

    test("recovers corrupted lock", async () => {
      const runDir = "/virtual/test-locks/run-stale-corrupt";
      const lockPath = resolveLockPath(runDir);
      setInMemoryLockPayload(lockPath, "corrupt");

      const lockResult = await acquireFullSuiteTestLock({ runDir, agentId: "recovering-agent-2" });
      expect(lockResult.acquired).toBe(true);
      await lockResult.release();
    });
  });

  describe("Scoped Single-File Bypass (guardTestExecution)", () => {
    test("allows scoped single-file test to bypass active full-suite lock", async () => {
      const runDir = "/virtual/test-locks/run-guard-bypass";
      const fullLock = await acquireFullSuiteTestLock({ runDir, agentId: "full-suite-agent" });
      expect(fullLock.acquired).toBe(true);

      let executed = false;
      const scopedResult = await guardTestExecution(
        "bun test tests/unit/agents/grants.test.ts",
        () => {
          executed = true;
          return 42;
        },
        { runDir },
      );
      expect(scopedResult.executed).toBe(true);
      expect(scopedResult.result).toBe(42);
      expect(scopedResult.bypassedLock).toBe(true);
      expect(executed).toBe(true);
      await fullLock.release();
    });

    test("blocks full-suite test when lock cannot be acquired", async () => {
      const runDir = "/virtual/test-locks/run-guard-blocked";
      const fullLock = await acquireFullSuiteTestLock({ runDir, agentId: "full-suite-agent" });
      expect(fullLock.acquired).toBe(true);

      let executed = false;
      const guardedResult = await guardTestExecution(
        "bun test",
        () => {
          executed = true;
          return "should not run";
        },
        { runDir, timeoutMs: 0 },
      );
      expect(guardedResult.executed).toBe(false);
      expect(guardedResult.bypassedLock).toBe(false);
      expect(guardedResult.reason).toContain("Full-suite test lock held by active PID");
      expect(executed).toBe(false);
      await fullLock.release();
    });
  });

  describe("Test Summary Memoization", () => {
    test("saves and retrieves test summary records in memory", async () => {
      const runDir = "/virtual/test-summaries/run-memo";
      expect(await getLatestTestSummary({ runDir })).toBeNull();

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
      expect(savedPath).toContain("summary-");

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
      const passing = createTestSummaryRecord({
        passed_count: 10,
        failed_count: 0,
        duration_ms: 100,
        coverage_percentage: 95.0,
        scope: "full",
      });
      const passMd = formatTestSummaryMarkdown(passing);
      expect(passMd).toContain("✅ PASSED");
      expect(passMd).toContain("95.0%");

      const failing = createTestSummaryRecord({
        passed_count: 8,
        failed_count: 2,
        duration_ms: 150,
        coverage_percentage: 88.0,
        scope: "scoped",
      });
      const failMd = formatTestSummaryMarkdown(failing);
      expect(failMd).toContain("❌ FAILED");
      expect(failMd).toContain("- **Failed**: 2");
    });
  });

  describe("CLI Command: test:summary", () => {
    test("returns empty status when no test summary exists", async () => {
      const runDir = "/virtual/test-summaries/empty";
      const result = await testSummaryCommand({ run: runDir });
      expect(result.found).toBe(false);
      expect(result.summary).toBeNull();
      expect(String(result.markdown)).toContain("No test summary records found");
    });

    test("records and queries summary via testSummaryCommand", async () => {
      const runDir = "/virtual/test-summaries/save";
      const res = await testSummaryCommand({
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
      expect(res.saved).toBe(true);
      expect(res.passed_count).toBe(25);
      expect(res.failed_count).toBe(0);
      expect(res.skipped_count).toBe(1);
      expect(res.duration_ms).toBe(450);
      expect(res.coverage_percentage).toBe(98.2);
      expect(res.scope).toBe("scoped");
      expect(String(res.markdown)).toContain("✅ PASSED");

      const q = await testSummaryCommand({ run: runDir });
      expect(q.found).toBe(true);
      expect(q.passed_count).toBe(25);
      expect(q.failed_count).toBe(0);
    });

    test("executes via CLI execute dispatcher", async () => {
      const runDir = "/virtual/test-summaries/exec";
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
});
