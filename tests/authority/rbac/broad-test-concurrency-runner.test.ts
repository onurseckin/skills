import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { isWholeSuiteTestRun } from "../../../olt/scripts/src/authority/rbac/command-predicates.ts";
import {
  acquireTestLock,
  buildBunTestArgs,
  createMemoryLockStore,
  DEFAULT_PARALLEL,
  DEFAULT_TIMEOUT_MS,
  getActiveLockStore,
  isBroadScopeTargets,
  parseRunnerArgs,
  resetLockStore,
  setLockStore,
  type LockStore,
  type TestLockData,
} from "../../../scripts/testing/index.ts";
import { cleanupVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

const LOCK_DIR = ".olt/.locks";
const BROAD_LOCK_FILE = join(LOCK_DIR, "broad-test.lock");

describe("Socratic Adversarial Concurrency Probes - Broad Test Concurrency & RBAC (Probes 3 & 4)", () => {
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

  describe("Probe 3: Targeted Test File Arguments Bypass Locking and Run Concurrently", () => {
    test("targeted test file argument completely bypasses lock acquisition", () => {
      release = acquireTestLock(false, ["tests/authority/rbac/broad-test-concurrency.test.ts"], {
        skipSignalHandlers: true,
      });
      expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(false);
      expect(() => release?.()).not.toThrow();
    });

    test("multiple targeted runs execute concurrently without mutual exclusion", () => {
      const rel1 = acquireTestLock(false, ["tests/module-a.test.ts"], {
        skipSignalHandlers: true,
      });
      const rel2 = acquireTestLock(false, ["tests/module-b.test.ts"], {
        skipSignalHandlers: true,
      });
      const rel3 = acquireTestLock(false, ["tests/module-c.test.ts"], {
        skipSignalHandlers: true,
      });

      expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(false);
      expect(exitSpy).not.toHaveBeenCalled();

      expect(() => {
        rel1();
        rel2();
        rel3();
      }).not.toThrow();
    });

    test("targeted test file argument proceeds unhindered even if broad lock exists", () => {
      const activeBroadLock: TestLockData = {
        pid: process.pid,
        scope: "broad",
        args: ["tests"],
        startedAt: new Date().toISOString(),
      };
      getActiveLockStore().mkdirSync(LOCK_DIR);
      getActiveLockStore().writeFileSync(BROAD_LOCK_FILE, JSON.stringify(activeBroadLock));

      const targetedRelease = acquireTestLock(
        false,
        ["tests/authority/rbac/broad-test-concurrency.test.ts"],
        { skipSignalHandlers: true },
      );

      expect(exitSpy).not.toHaveBeenCalled();
      expect(() => targetedRelease()).not.toThrow();
      expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(true);
    });

    test("socratic probe: asynchronous concurrent simulation executes 10 targeted runners concurrently", async () => {
      const taskIndices = Array.from({ length: 10 }, (_, i) => i);
      const results = await Promise.all(
        taskIndices.map(async (idx) => {
          const rel = acquireTestLock(false, [`tests/task-${idx}.test.ts`], {
            skipSignalHandlers: true,
          });
          await new Promise((res) => setTimeout(res, 2));
          rel();
          return idx;
        }),
      );

      expect(results).toHaveLength(10);
      expect(exitSpy).not.toHaveBeenCalled();
      expect(getActiveLockStore().existsSync(BROAD_LOCK_FILE)).toBe(false);
    });
  });

  describe("Probe 4: Parallel Runner Engine Remains Untouched", () => {
    test("broad and targeted runs preserve DEFAULT_PARALLEL = true by default", () => {
      expect(DEFAULT_PARALLEL).toBe(true);
      expect(DEFAULT_TIMEOUT_MS).toBe(30000);

      const parsedBroad = parseRunnerArgs([]);
      expect(parsedBroad.isBroadScope).toBe(true);
      expect(parsedBroad.parallel).toBe(true);
      expect(parsedBroad.bunTestArgs).toContain("--parallel");

      const parsedTargeted = parseRunnerArgs([
        "tests/authority/rbac/broad-test-concurrency.test.ts",
      ]);
      expect(parsedTargeted.isBroadScope).toBe(false);
      expect(parsedTargeted.parallel).toBe(true);
      expect(parsedTargeted.bunTestArgs).toContain("--parallel");
    });

    test("explicit parallel flags and worker counts are forwarded directly to engine arguments", () => {
      const parsedWorkers = parseRunnerArgs(["--parallel=4", "tests/foo.test.ts"]);
      expect(parsedWorkers.parallel).toBe(true);
      expect(parsedWorkers.parallelWorkers).toBe(4);
      expect(parsedWorkers.bunTestArgs).toContain("--parallel=4");

      const parsedSeparate = parseRunnerArgs(["--parallel", "6", "tests/foo.test.ts"]);
      expect(parsedSeparate.parallel).toBe(true);
      expect(parsedSeparate.parallelWorkers).toBe(6);
      expect(parsedSeparate.bunTestArgs).toContain("--parallel=6");

      const parsedMaxConc = parseRunnerArgs(["--max-concurrency", "8", "tests/foo.test.ts"]);
      expect(parsedMaxConc.maxConcurrency).toBe(8);
      expect(parsedMaxConc.bunTestArgs).toContain("--max-concurrency");
      expect(parsedMaxConc.bunTestArgs).toContain("8");
    });

    test("no-parallel flag is forwarded intact to bun test engine", () => {
      const parsedNoParallel = parseRunnerArgs(["--no-parallel", "tests/foo.test.ts"]);
      expect(parsedNoParallel.parallel).toBe(false);
      expect(parsedNoParallel.bunTestArgs).toContain("--no-parallel");
    });

    test("parallel options do not interfere with isWholeSuiteTestRun detection", () => {
      expect(isWholeSuiteTestRun(["bun", "test", "--parallel"])).toBe(true);
      expect(isWholeSuiteTestRun(["bun", "test", "--no-parallel"])).toBe(true);
      expect(isWholeSuiteTestRun(["bun", "test", "--max-concurrency", "4"])).toBe(true);
      expect(isWholeSuiteTestRun(["bun", "test", "--parallel", "tests/foo.test.ts"])).toBe(false);
      expect(isWholeSuiteTestRun(["bun", "test", "--no-parallel", "tests/foo.test.ts"])).toBe(
        false,
      );
      expect(
        isWholeSuiteTestRun(["bun", "test", "--max-concurrency", "4", "tests/foo.test.ts"]),
      ).toBe(false);
    });

    test("isBroadScopeTargets accurately classifies root target patterns", () => {
      expect(isBroadScopeTargets([])).toBe(true);
      expect(isBroadScopeTargets(["tests"])).toBe(true);
      expect(isBroadScopeTargets(["tests/"])).toBe(true);
      expect(isBroadScopeTargets(["."])).toBe(true);
      expect(isBroadScopeTargets(["./"])).toBe(true);
      expect(isBroadScopeTargets(["tests/authority/rbac/broad-test-concurrency.test.ts"])).toBe(
        false,
      );
      expect(isBroadScopeTargets(["src/app.test.ts"])).toBe(false);
    });

    test("preserves passthrough arguments and boundary markers alongside parallel options", () => {
      const parsed = parseRunnerArgs([
        "--parallel=2",
        "tests/foo.test.ts",
        "--",
        "--custom-flag",
        "--another-arg",
      ]);
      expect(parsed.parallel).toBe(true);
      expect(parsed.parallelWorkers).toBe(2);
      expect(parsed.passthroughArgs).toEqual(["--", "--custom-flag", "--another-arg"]);

      const reconstructed = buildBunTestArgs(parsed);
      expect(reconstructed).toContain("--parallel=2");
      expect(reconstructed).toContain("tests/foo.test.ts");
      expect(reconstructed).toContain("--");
      expect(reconstructed).toContain("--custom-flag");
    });
  });
});
