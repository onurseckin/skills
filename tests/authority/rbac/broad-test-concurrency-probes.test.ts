import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import {
  inspectShellEval,
  isTestFileArgument,
  isWholeSuiteTestRun,
} from "../../../olt/scripts/src/authority/rbac/command-predicates.ts";
import { verifyCommandAuthorization } from "../../../olt/scripts/src/authority/rbac/index.ts";
import {
  acquireTestLock,
  createMemoryLockStore,
  getActiveLockStore,
  isProcessAlive,
  resetLockStore,
  setLockStore,
  type LockStore,
  type TestLockData,
} from "../../../scripts/testing/index.ts";
import { cleanupVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

const LOCK_DIR = ".olt/.locks";
const BROAD_LOCK_FILE = join(LOCK_DIR, "broad-test.lock");

describe("Socratic Adversarial Concurrency Probes - Broad Test Concurrency & RBAC (Probes 1 & 2)", () => {
  let release: (() => void) | undefined;
  let exitSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let memStore: LockStore;

  beforeEach(() => {
    setupVirtualAuthorityFS();
    memStore = createMemoryLockStore();
    setLockStore(memStore);
    exitSpy = spyOn(process, "exit").mockImplementation(
      (code?: number | string | null | undefined): never => {
        throw new Error(`process.exit called with ${String(code)}`);
      },
    );
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (release) {
      try {
        release();
      } catch {}
      release = undefined;
    }
    resetLockStore();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    cleanupVirtualAuthorityFS();
  });

  describe("Probe 1: isWholeSuiteTestRun Predicate & Targeted Test File Disambiguation", () => {
    test("correctly identifies broad whole-suite test runs across package managers and runners", () => {
      const broadRuns: readonly string[][] = [
        ["vitest"],
        ["jest"],
        ["npx", "vitest"],
        ["npx", "jest"],
        ["npm", "test"],
        ["npm", "t"],
        ["npm", "run", "test"],
        ["pnpm", "test"],
        ["pnpm", "t"],
        ["pnpm", "run", "test"],
        ["yarn", "test"],
        ["yarn", "t"],
        ["yarn", "run", "test"],
        ["bun", "test"],
        ["bun", "test", "--coverage"],
        ["bun", "test", "--bail"],
        ["bun", "test", "--timeout", "30000"],
        ["bun", "test", "--parallel"],
        ["bun", "test", "--max-concurrency", "4"],
        ["bun", "test", "tests"],
        ["bun", "test", "."],
        ["bun", "test", "src/"],
        ["bun", "run", "test"],
        ["bun", "run", "test", "--coverage"],
        ["bun-test"],
        ["bun-test", "--coverage"],
      ];

      for (const cmd of broadRuns) {
        expect(isWholeSuiteTestRun(cmd)).toBe(true);
      }
    });

    test("distinguishes targeted test files from broad runs and deactivates whole-suite flag", () => {
      const targetedRuns: readonly string[][] = [
        ["bun", "test", "tests/authority/rbac/broad-test-concurrency.test.ts"],
        ["bun", "test", "tests/unit/app.spec.ts"],
        ["bun", "test", "src/services/user.test.js"],
        ["bun", "test", "tests/integration/gateway.spec.jsx"],
        ["bun", "test", "tests/components/button.test.tsx"],
        ["bun", "test", "--timeout", "5000", "tests/unit/core.test.ts"],
        ["bun", "test", "tests/unit/core.test.ts", "--coverage"],
        ["bun", "test", "--parallel", "tests/unit/core.test.ts"],
        ["bun", "test", "--max-concurrency", "2", "tests/unit/core.test.ts"],
        ["bun", "run", "test", "tests/unit/core.test.ts"],
        ["bun-test", "tests/unit/core.test.ts"],
        ["bun", "test", "tests/a.test.ts", "tests/b.test.ts"],
      ];

      for (const cmd of targetedRuns) {
        expect(isWholeSuiteTestRun(cmd)).toBe(false);
      }
    });

    test("returns false for non-test commands and empty vectors", () => {
      expect(isWholeSuiteTestRun([])).toBe(false);
      expect(isWholeSuiteTestRun(["git", "status"])).toBe(false);
      expect(isWholeSuiteTestRun(["git", "diff", "tests/foo.test.ts"])).toBe(false);
      expect(isWholeSuiteTestRun(["node", "server.js"])).toBe(false);
      expect(isWholeSuiteTestRun(["bun", "run", "build"])).toBe(false);
      expect(isWholeSuiteTestRun(["bun", "run", "index.ts"])).toBe(false);
    });

    test("socratic probe: adversarial evasion attempts via shell eval wrappers and flags", () => {
      expect(isTestFileArgument("-f")).toBe(false);
      expect(isTestFileArgument("--test-pattern")).toBe(false);
      expect(isTestFileArgument("tests")).toBe(false);
      expect(isTestFileArgument(".")).toBe(false);
      expect(isTestFileArgument("foo.txt")).toBe(false);
      expect(isTestFileArgument("tests/foo.test.ts")).toBe(true);
      expect(isTestFileArgument("tests/bar.spec.js")).toBe(true);

      const shellEvalResult = inspectShellEval(
        "implementer",
        ["bash", "-c", "bun test"],
        verifyCommandAuthorization,
      );
      expect(shellEvalResult).not.toBeNull();
      expect(shellEvalResult?.authorized).toBe(false);
      expect(shellEvalResult?.reason).toBe("WHOLE_SUITE_TEST_RUN_DENIED");

      const nodeEvalResult = inspectShellEval(
        "implementer",
        ["node", "-e", "bun test"],
        verifyCommandAuthorization,
      );
      expect(nodeEvalResult).not.toBeNull();
      expect(nodeEvalResult?.authorized).toBe(false);
      expect(nodeEvalResult?.reason).toBe("WHOLE_SUITE_TEST_RUN_DENIED");
    });

    test("integrates with RBAC command authorizer to deny whole-suite runs while permitting targeted runs for implementer", () => {
      const broadAuth = verifyCommandAuthorization("implementer", ["bun", "test"]);
      expect(broadAuth.authorized).toBe(false);
      expect(broadAuth.reason).toBe("WHOLE_SUITE_TEST_RUN_DENIED");

      const targetedAuth = verifyCommandAuthorization("implementer", [
        "bun",
        "test",
        "tests/authority/rbac/broad-test-concurrency.test.ts",
      ]);
      expect(targetedAuth.authorized).toBe(true);
      expect(targetedAuth.reason).toBeUndefined();

      const coordAuth = verifyCommandAuthorization("coordinator", [
        "bun",
        "test",
        "tests/authority/rbac/broad-test-concurrency.test.ts",
      ]);
      expect(coordAuth.authorized).toBe(false);
      expect(coordAuth.reason).toBe("SUPERVISOR_ZERO_TEST_RUNS");

      const validatorAuth = verifyCommandAuthorization("validator", [
        "bun",
        "test",
        "tests/authority/rbac/broad-test-concurrency.test.ts",
      ]);
      expect(validatorAuth.authorized).toBe(false);
      expect(validatorAuth.reason).toBe("SUPERVISOR_ZERO_TEST_RUNS");
    });
  });

  describe("Probe 2: Concurrent Broad Test Runs Enforce Single-Agent Serialization / Locking", () => {
    test("single-agent acquires broad test lock and establishes valid lock payload", () => {
      release = acquireTestLock(true, ["tests"], { skipSignalHandlers: true });
      expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);

      const raw = getActiveLockStore().readFileSync(BROAD_LOCK_FILE);
      const lockData = JSON.parse(raw) as TestLockData;
      expect(lockData.pid).toBe(process.pid);
      expect(lockData.scope).toBe("broad");
      expect(lockData.args).toEqual(["tests"]);
      expect(new Date(lockData.startedAt).getTime()).toBeGreaterThan(0);
    });

    test("concurrent broad test run is blocked with process.exit(1) while lock is held", () => {
      release = acquireTestLock(true, ["tests"], { skipSignalHandlers: true });
      expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);

      expect(() => {
        acquireTestLock(true, ["tests"], { skipSignalHandlers: true });
      }).toThrow("process.exit called with 1");

      expect(errorSpy).toHaveBeenCalled();
    });

    test("enforces serialization: second agent acquires lock cleanly once first agent releases", () => {
      const releaseAgent1 = acquireTestLock(true, ["tests"], {
        skipSignalHandlers: true,
      });
      expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);

      expect(() => {
        acquireTestLock(true, ["tests"], { skipSignalHandlers: true });
      }).toThrow("process.exit called with 1");

      releaseAgent1();
      expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(false);

      const releaseAgent2 = acquireTestLock(true, ["tests"], {
        skipSignalHandlers: true,
      });
      expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);
      releaseAgent2();
      expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(false);
    });

    test("idempotent release: calling release multiple times does not throw or double-unlink", () => {
      release = acquireTestLock(true, ["tests"], { skipSignalHandlers: true });
      expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);

      expect(() => release?.()).not.toThrow();
      expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(false);

      expect(() => release?.()).not.toThrow();
    });

    test("socratic probe: dead PID / stale lock reclamation allows unblocked recovery", () => {
      const staleLock: TestLockData = {
        pid: 99999999,
        scope: "broad",
        args: ["tests"],
        startedAt: new Date(Date.now() - 120_000).toISOString(),
      };
      getActiveLockStore().mkdirSync(LOCK_DIR);
      getActiveLockStore().writeFileSync(BROAD_LOCK_FILE, JSON.stringify(staleLock));
      expect(isProcessAlive(staleLock.pid)).toBe(false);

      release = acquireTestLock(true, ["tests"], { skipSignalHandlers: true });
      expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);

      const activeLock = JSON.parse(
        getActiveLockStore().readFileSync(BROAD_LOCK_FILE),
      ) as TestLockData;
      expect(activeLock.pid).toBe(process.pid);
    });

    test("socratic probe: corrupt lock file data is reclaimed automatically", () => {
      getActiveLockStore().mkdirSync(LOCK_DIR);
      getActiveLockStore().writeFileSync(BROAD_LOCK_FILE, "NOT_VALID_JSON{{{<<>>");

      release = acquireTestLock(true, ["tests"], { skipSignalHandlers: true });
      expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);

      const data = JSON.parse(getActiveLockStore().readFileSync(BROAD_LOCK_FILE)) as TestLockData;
      expect(data.pid).toBe(process.pid);
    });

    test("socratic probe: release preserves lock if ownership belongs to another PID", () => {
      release = acquireTestLock(true, ["tests"], { skipSignalHandlers: true });
      expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);

      const foreignLock: TestLockData = {
        pid: 99999999,
        scope: "broad",
        args: ["foreign tests"],
        startedAt: new Date().toISOString(),
      };
      getActiveLockStore().writeFileSync(BROAD_LOCK_FILE, JSON.stringify(foreignLock));

      release();
      expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);
      const remaining = JSON.parse(
        getActiveLockStore().readFileSync(BROAD_LOCK_FILE),
      ) as TestLockData;
      expect(remaining.pid).toBe(99999999);
    });
  });
});
