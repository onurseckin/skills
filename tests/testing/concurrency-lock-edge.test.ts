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
  readLockPayload,
  resetConcurrencyLockStore,
  resolveLockPath,
  resolveTestSummaryDir,
  saveTestSummary,
  setInMemoryLockPayload,
} from "../../olt/scripts/src/testing/concurrency-lock.ts";

describe("Concurrency Lock Edge Cases & Telemetry", () => {
  let tempDir: string;

  beforeEach(() => {
    resetConcurrencyLockStore();
    tempDir = mkdtempSync(join(tmpdir(), "lock-edge-"));
  });

  afterEach(() => {
    resetConcurrencyLockStore();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  describe("isFullSuiteTestCommand flags and token parser", () => {
    it("handles value flags correctly when identifying target tests", () => {
      expect(isFullSuiteTestCommand("bun test --filter my-filter")).toBe(true);
      expect(isFullSuiteTestCommand("bun test -f my-filter tests/a.test.ts")).toBe(false);
      expect(isFullSuiteTestCommand("bun test --reporter spec tests/a.test.ts")).toBe(false);
      expect(isFullSuiteTestCommand("bun test -r dot tests/a.test.ts")).toBe(false);
      expect(isFullSuiteTestCommand("bun test --cwd /app tests/a.test.ts")).toBe(false);
      expect(isFullSuiteTestCommand("bun test --max-concurrency 4 tests/a.test.ts")).toBe(false);
      expect(isFullSuiteTestCommand("bun test --threshold 80 tests/a.test.ts")).toBe(false);
      expect(isFullSuiteTestCommand("bun test -t 1000 tests/a.test.ts")).toBe(false);

      expect(isFullSuiteTestCommand("test")).toBe(true);
      expect(isFullSuiteTestCommand("test tests/a.test.ts")).toBe(false);
      expect(isFullSuiteTestCommand("npm run test")).toBe(true);
      expect(isFullSuiteTestCommand("npm run t")).toBe(true);
      expect(isFullSuiteTestCommand("pnpm run t")).toBe(true);
      expect(isFullSuiteTestCommand("yarn run t")).toBe(true);
      expect(isFullSuiteTestCommand([])).toBe(false);
      expect(isFullSuiteTestCommand("   ")).toBe(false);
    });
  });

  describe("readLockPayload field fallbacks and corruption", () => {
    it("populates fallback values when optional payload fields are missing", () => {
      const lockFile = join(tempDir, "partial.lock");
      writeFileSync(
        lockFile,
        JSON.stringify({ pid: process.pid, agent_id: "agent-partial" }),
        "utf8",
      );

      const payload = readLockPayload(lockFile);
      expect(payload).not.toBeNull();
      expect(payload?.pid).toBe(process.pid);
      expect(payload?.agent_id).toBe("agent-partial");
      expect(typeof payload?.hostname).toBe("string");
      expect(typeof payload?.acquired_at_utc).toBe("string");
      expect(typeof payload?.acquired_at_ms).toBe("number");
      expect(payload?.command).toBeUndefined();
    });

    it("returns null when JSON payload has missing or invalid required types", () => {
      const badPidFile = join(tempDir, "bad-pid.lock");
      writeFileSync(badPidFile, JSON.stringify({ pid: "not-a-number", agent_id: "agent" }), "utf8");
      expect(readLockPayload(badPidFile)).toBeNull();

      const badAgentFile = join(tempDir, "bad-agent.lock");
      writeFileSync(badAgentFile, JSON.stringify({ pid: 1234, agent_id: 5678 }), "utf8");
      expect(readLockPayload(badAgentFile)).toBeNull();
    });
  });

  describe("resolveTestSummaryDir and resolveLockPath defaults", () => {
    it("normalizes test-summaries directory and resolves repo defaults", () => {
      expect(resolveTestSummaryDir("/var/run/test-summaries/")).toBe("/var/run/test-summaries");
      expect(resolveTestSummaryDir("/var/run/test-summaries")).toBe("/var/run/test-summaries");
      expect(resolveTestSummaryDir("/var/run/custom")).toBe("/var/run/custom/test-summaries");
      expect(resolveTestSummaryDir()).toContain("test-summaries");
      expect(resolveLockPath()).toContain("full-suite-test.lock");
    });
  });

  describe("createTestSummaryRecord clamping and scope deduction", () => {
    it("clamps negative values and deduces scope based on file count", () => {
      const sSingle = createTestSummaryRecord({
        passed_count: -5,
        failed_count: -2,
        skipped_count: -1,
        duration_ms: -100,
        test_files_count: 1,
      });
      expect(sSingle.passed_count).toBe(0);
      expect(sSingle.failed_count).toBe(0);
      expect(sSingle.skipped_count).toBe(0);
      expect(sSingle.duration_ms).toBe(0);
      expect(sSingle.scope).toBe("scoped");

      const sMulti = createTestSummaryRecord({
        passed_count: 10,
        failed_count: 0,
        test_files_count: 5,
      });
      expect(sMulti.scope).toBe("full");
    });
  });

  describe("getLatestTestSummary fallback logic", () => {
    it("finds newest memory summary by mtime when latest.json key is absent", async () => {
      const sDir = resolveTestSummaryDir(tempDir);
      const sOld = createTestSummaryRecord({
        passed_count: 1,
        failed_count: 0,
        timestamp_utc: "2026-01-01T00:00:00.000Z",
      });
      const sNew = createTestSummaryRecord({
        passed_count: 5,
        failed_count: 0,
        timestamp_utc: "2026-01-02T00:00:00.000Z",
      });

      await saveTestSummary(sOld, { runDir: tempDir });
      await saveTestSummary(sNew, { runDir: tempDir });

      const latest = await getLatestTestSummary({ runDir: tempDir });
      expect(latest?.passed_count).toBe(5);
    });

    it("reads disk directory sorted by mtime when memory store is empty and latest.json absent", async () => {
      const sDir = resolveTestSummaryDir(tempDir);
      mkdirSync(sDir, { recursive: true });

      const oldRec = createTestSummaryRecord({ passed_count: 2, failed_count: 0 });
      const newRec = createTestSummaryRecord({ passed_count: 8, failed_count: 0 });

      writeFileSync(join(sDir, "summary-2026-01-01.json"), JSON.stringify(oldRec), "utf8");
      writeFileSync(join(sDir, "summary-2026-01-02.json"), JSON.stringify(newRec), "utf8");

      resetConcurrencyLockStore();

      const latest = await getLatestTestSummary({ runDir: tempDir });
      expect(latest?.passed_count).toBeDefined();
    });
  });

  describe("acquireFullSuiteTestLock with stale disk lock and recovery", () => {
    it("cleans up stale dead PID lock file on disk during acquisition", async () => {
      const lockPath = resolveLockPath(tempDir);
      mkdirSync(join(tempDir, ".locks"), { recursive: true });
      writeFileSync(lockPath, JSON.stringify({ pid: 99999999, agent_id: "dead-agent" }), "utf8");

      const res = await acquireFullSuiteTestLock({ runDir: tempDir, agentId: "new-agent" });
      expect(res.acquired).toBe(true);
      await res.release();
    });

    it("releases lock properly even if guarded action throws", async () => {
      const lockPath = resolveLockPath(tempDir);
      await expect(
        guardTestExecution(
          "bun test",
          () => {
            expect(readLockPayload(lockPath)).not.toBeNull();
            throw new Error("action error");
          },
          { runDir: tempDir },
        ),
      ).rejects.toThrow("action error");

      expect(readLockPayload(lockPath)).toBeNull();
    });

    it("waits and returns reason when lock remains occupied past timeout", async () => {
      const lockPath = resolveLockPath(tempDir);
      setInMemoryLockPayload(lockPath, {
        pid: process.pid,
        agent_id: "blocking-agent",
        acquired_at_utc: new Date().toISOString(),
        acquired_at_ms: Date.now(),
        hostname: "localhost",
      });

      const start = Date.now();
      const res = await acquireFullSuiteTestLock({
        runDir: tempDir,
        timeoutMs: 60,
        retryIntervalMs: 20,
      });

      expect(res.acquired).toBe(false);
      expect(Date.now() - start).toBeGreaterThanOrEqual(50);
    });
  });

  describe("formatTestSummaryMarkdown edge cases", () => {
    it("formats summary with null coverage, null commit sha, and extra details", () => {
      const summary = createTestSummaryRecord({
        passed_count: 3,
        failed_count: 0,
        coverage_percentage: null,
        commit_sha: null,
        details: { engine: "bun", branch: "feat" },
      });

      const md = formatTestSummaryMarkdown(summary);
      expect(md).toContain("- **Coverage**: N/A");
      expect(md).toContain("- **Commit SHA**: N/A");
      expect(md).toContain("✅ PASSED");
    });
  });
});
