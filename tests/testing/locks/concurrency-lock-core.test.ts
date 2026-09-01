import { beforeEach, describe, expect, test } from "bun:test";
import {
  acquireFullSuiteTestLock,
  guardTestExecution,
  isFullSuiteTestCommand,
  isProcessAlive,
  isTestFilePath,
  readLockPayload,
  resetConcurrencyLockStore,
  resolveLockPath,
  setInMemoryLockPayload,
} from "../../../olt/scripts/src/testing/concurrency-lock.ts";

describe("concurrency-lock-core (in-memory zero-disk)", () => {
  beforeEach(() => {
    resetConcurrencyLockStore();
  });

  describe("isTestFilePath", () => {
    test("identifies test/spec file paths and rejects non-tests", () => {
      expect(isTestFilePath("tests/orchestrator/agents/grants.test.ts")).toBe(true);
      expect(isTestFilePath("tests/testing/locks/concurrency-lock-core.test.ts")).toBe(true);
      expect(isTestFilePath("src/component.spec.ts")).toBe(true);
      expect(isTestFilePath("src/component.test.js")).toBe(true);
      expect(isTestFilePath("tests/testing/foo.test.tsx")).toBe(true);
      expect(isTestFilePath("tests/testing/foo.spec.jsx")).toBe(true);
      expect(isTestFilePath("tests\\testing\\windows.test.ts")).toBe(true);
      expect(isTestFilePath("tests")).toBe(false);
      expect(isTestFilePath("tests/")).toBe(false);
      expect(isTestFilePath("tests/testing")).toBe(false);
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
      expect(isFullSuiteTestCommand("bun test tests/testing")).toBe(true);
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
      expect(isFullSuiteTestCommand("bun test tests/orchestrator/agents/grants.test.ts")).toBe(
        false,
      );
      expect(
        isFullSuiteTestCommand([
          "bun",
          "test",
          "tests/testing/locks/concurrency-lock-core.test.ts",
        ]),
      ).toBe(false);
      expect(isFullSuiteTestCommand("bun test --coverage tests/cli/coverage-check.test.ts")).toBe(
        false,
      );
      expect(isFullSuiteTestCommand("bun test ./tests/testing/foo.spec.ts")).toBe(false);
      expect(isFullSuiteTestCommand("bun test --bail tests/testing/bar.test.js")).toBe(false);
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
        "bun test tests/orchestrator/agents/grants.test.ts",
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
});
