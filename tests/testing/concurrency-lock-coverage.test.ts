import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  resolveTestSummaryDir,
  saveTestSummary,
  setInMemoryLockPayload,
} from "../../olt/scripts/src/testing/concurrency-lock.ts";

describe("Concurrency Locking & Test Summary Telemetry", () => {
  let tempDir: string;

  beforeEach(() => {
    resetConcurrencyLockStore();
    tempDir = mkdtempSync(join(tmpdir(), "lock-test-"));
  });

  afterEach(() => {
    resetConcurrencyLockStore();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  describe("isTestFilePath & isFullSuiteTestCommand", () => {
    it("identifies test file extensions accurately", () => {
      expect(isTestFilePath("src/auth.test.ts")).toBe(true);
      expect(isTestFilePath("src/auth.spec.js")).toBe(true);
      expect(isTestFilePath("src/auth.test.tsx")).toBe(true);
      expect(isTestFilePath("src/auth.spec.cjs")).toBe(true);
      expect(isTestFilePath("src/auth.test.mjs")).toBe(true);
      expect(isTestFilePath("src/auth.ts")).toBe(false);
      expect(isTestFilePath("README.md")).toBe(false);
    });

    it("detects full-suite vs scoped test commands", () => {
      expect(isFullSuiteTestCommand("")).toBe(false);
      expect(isFullSuiteTestCommand(["git", "status"])).toBe(false);
      expect(isFullSuiteTestCommand("bun test")).toBe(true);
      expect(isFullSuiteTestCommand("npm test")).toBe(true);
      expect(isFullSuiteTestCommand("pnpm run test")).toBe(true);
      expect(isFullSuiteTestCommand("yarn test")).toBe(true);
      expect(isFullSuiteTestCommand("vitest run")).toBe(true);
      expect(isFullSuiteTestCommand("jest")).toBe(true);
      expect(isFullSuiteTestCommand(["test"])).toBe(true);

      expect(isFullSuiteTestCommand("bun test --timeout 5000")).toBe(true);
      expect(isFullSuiteTestCommand("bun test tests/unit/a.test.ts")).toBe(false);
      expect(isFullSuiteTestCommand("bun test tests/unit/a.test.ts tests/unit/b.spec.ts")).toBe(
        false,
      );
      expect(isFullSuiteTestCommand("bun test tests/unit/")).toBe(true);
    });
  });

  describe("isProcessAlive & lock path resolution", () => {
    it("checks process liveness correctly", () => {
      expect(isProcessAlive(0)).toBe(false);
      expect(isProcessAlive(-5)).toBe(false);
      expect(isProcessAlive(NaN)).toBe(false);
      expect(isProcessAlive(process.pid)).toBe(true);
      expect(isProcessAlive(9999999)).toBe(false);
    });

    it("resolves lock paths based on run directory formats", () => {
      const directLock = resolveLockPath("/tmp/custom.lock");
      expect(directLock).toBe("/tmp/custom.lock");

      const locksDir = resolveLockPath("/tmp/run/.locks");
      expect(locksDir).toBe("/tmp/run/.locks/full-suite-test.lock");

      const standardDir = resolveLockPath("/tmp/run");
      expect(standardDir).toBe("/tmp/run/.locks/full-suite-test.lock");

      const repoDefault = resolveLockPath();
      expect(repoDefault).toContain(".capsules/.locks/full-suite-test.lock");
    });
  });

  describe("acquireFullSuiteTestLock & readLockPayload", () => {
    it("acquires and releases in-memory and file locks cleanly", async () => {
      const lockPath = join(tempDir, "test.lock");
      const lock = await acquireFullSuiteTestLock({ runDir: tempDir, agentId: "agent-alpha" });

      expect(lock.acquired).toBe(true);
      expect(lock.lockPath).toBeDefined();

      const payload = readLockPayload(lock.lockPath!);
      expect(payload).toBeDefined();
      expect(payload?.agent_id).toBe("agent-alpha");
      expect(payload?.pid).toBe(process.pid);

      await lock.release();
      expect(readLockPayload(lock.lockPath!)).toBeNull();
    });

    it("handles corrupt in-memory and disk locks", () => {
      const lockPath = join(tempDir, "corrupt.lock");
      setInMemoryLockPayload(lockPath, "corrupt");
      expect(readLockPayload(lockPath)).toBeNull();

      setInMemoryLockPayload(lockPath, null);
      writeFileSync(lockPath, "{ bad json", "utf8");
      expect(readLockPayload(lockPath)).toBeNull();
    });

    it("rejects concurrent lock acquisition when active lock is held", async () => {
      const lockPath = resolveLockPath(tempDir);
      setInMemoryLockPayload(lockPath, {
        pid: process.pid,
        agent_id: "existing-agent",
        acquired_at_utc: new Date().toISOString(),
        acquired_at_ms: Date.now(),
        hostname: "localhost",
      });

      const lock = await acquireFullSuiteTestLock({
        runDir: tempDir,
        agentId: "new-agent",
        timeoutMs: 0,
      });

      expect(lock.acquired).toBe(false);
      expect(lock.reason).toContain(`Full-suite test lock held by active PID ${process.pid}`);
    });
  });

  describe("guardTestExecution", () => {
    it("bypasses lock for scoped single-file test commands", async () => {
      let executed = false;
      const result = await guardTestExecution("bun test tests/a.test.ts", () => {
        executed = true;
        return "success";
      });

      expect(result.executed).toBe(true);
      expect(result.bypassedLock).toBe(true);
      expect(result.result).toBe("success");
      expect(executed).toBe(true);
    });

    it("acquires lock for full-suite test commands and releases in finally", async () => {
      let executed = false;
      const result = await guardTestExecution(
        "bun test",
        () => {
          executed = true;
          return 42;
        },
        { runDir: tempDir },
      );

      expect(result.executed).toBe(true);
      expect(result.bypassedLock).toBe(false);
      expect(result.result).toBe(42);
      expect(executed).toBe(true);
    });
  });

  describe("Test Summary Telemetry & Markdown Reporting", () => {
    it("creates, saves, and retrieves test summary records", async () => {
      const summary = createTestSummaryRecord({
        passed_count: 10,
        failed_count: 0,
        skipped_count: 1,
        duration_ms: 125,
        coverage_percentage: 98.5,
        test_files_count: 3,
        agent_id: "agent-lead",
      });

      expect(summary.scope).toBe("full");
      expect(summary.passed_count).toBe(10);
      expect(summary.coverage_percentage).toBe(98.5);

      const summaryDir = resolveTestSummaryDir(tempDir);
      expect(summaryDir).toBe(join(tempDir, "test-summaries"));

      const savedPath = await saveTestSummary(summary, { runDir: tempDir });
      expect(savedPath).toContain("summary-");

      const latest = await getLatestTestSummary({ runDir: tempDir });
      expect(latest).toBeDefined();
      expect(latest?.passed_count).toBe(10);
      expect(latest?.agent_id).toBe("agent-lead");
    });

    it("formats markdown representations for passed, failed, and empty runs", () => {
      const passedSummary = createTestSummaryRecord({
        passed_count: 5,
        failed_count: 0,
        duration_ms: 50,
        coverage_percentage: 100,
        agent_id: "agent-1",
      });
      const passedMd = formatTestSummaryMarkdown(passedSummary);
      expect(passedMd).toContain("✅ PASSED");
      expect(passedMd).toContain("100.0%");
      expect(passedMd).toContain("agent-1");

      const failedSummary = createTestSummaryRecord({
        passed_count: 2,
        failed_count: 1,
        duration_ms: 60,
      });
      const failedMd = formatTestSummaryMarkdown(failedSummary);
      expect(failedMd).toContain("❌ FAILED");

      const emptySummary = createTestSummaryRecord({
        passed_count: 0,
        failed_count: 0,
      });
      const emptyMd = formatTestSummaryMarkdown(emptySummary);
      expect(emptyMd).toContain("⚠️ NO_TESTS");
    });
  });
});
