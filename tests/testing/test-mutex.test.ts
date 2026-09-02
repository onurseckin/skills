import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  acquireTestLock,
  createMemoryLockStore,
  diskLockStore,
  getActiveLockStore,
  isProcessAlive,
  resetLockStore,
  setLockStore,
} from "../../scripts/testing/mutex/test-mutex.ts";

describe("Test Mutex & Lock Store Engine", () => {
  beforeEach(() => {
    resetLockStore();
  });
  afterEach(() => {
    resetLockStore();
  });

  describe("Memory and Disk LockStore implementations", () => {
    it("operates memory lock store with initial files and throws on missing file", () => {
      const store = createMemoryLockStore({ "/test/lock": "initial-data" });
      expect(store.isMemory).toBe(true);
      expect(store.existsSync("/test/lock")).toBe(true);
      expect(store.readFileSync("/test/lock")).toBe("initial-data");

      store.writeFileSync("/test/new", "content");
      expect(store.readFileSync("/test/new")).toBe("content");

      store.unlinkSync("/test/new");
      expect(store.existsSync("/test/new")).toBe(false);
      expect(() => store.readFileSync("/test/new")).toThrow("ENOENT: no such file");
      expect(() => store.mkdirSync("/test/dir")).not.toThrow();
    });

    it("manages global active lock store state", () => {
      expect(getActiveLockStore()).toBe(diskLockStore);
      const customStore = createMemoryLockStore();
      setLockStore(customStore);
      expect(getActiveLockStore()).toBe(customStore);
      resetLockStore();
      expect(getActiveLockStore()).toBe(diskLockStore);
    });

    it("verifies diskLockStore properties and operations", () => {
      expect(diskLockStore.isMemory).toBe(false);
    });
  });

  describe("isProcessAlive", () => {
    it("returns true for running process and false for non-existent process", () => {
      expect(isProcessAlive(process.pid)).toBe(true);
      expect(isProcessAlive(-999999)).toBe(false);
    });
  });

  describe("acquireTestLock", () => {
    it("returns no-op function when scope is targeted (not broad)", () => {
      const release = acquireTestLock(false, ["tests/foo.test.ts"], {
        skipSignalHandlers: true,
      });
      expect(typeof release).toBe("function");
      expect(() => release()).not.toThrow();
    });

    it("acquires lock using inMemory option and custom lock directory", () => {
      const memStore = createMemoryLockStore();
      const release = acquireTestLock(true, ["test:all"], {
        inMemory: true,
        store: memStore,
        lockDir: ".custom-locks",
        skipSignalHandlers: true,
      });

      const lockPath = ".custom-locks/broad-test.lock";
      expect(memStore.existsSync(lockPath)).toBe(true);
      const data = JSON.parse(memStore.readFileSync(lockPath)) as {
        pid: number;
        scope: string;
        args: string[];
      };
      expect(data.pid).toBe(process.pid);
      expect(data.scope).toBe("broad");
      expect(data.args).toEqual(["test:all"]);

      release();
      expect(memStore.existsSync(lockPath)).toBe(false);
      expect(() => release()).not.toThrow();
    });

    it("cleans up stale lock file when previous PID is dead", () => {
      const deadPid = 2147483640;
      const memStore = createMemoryLockStore({
        ".olt/.locks/broad-test.lock": JSON.stringify({
          pid: deadPid,
          scope: "broad",
          args: ["old-run"],
          startedAt: new Date(0).toISOString(),
        }),
      });

      const release = acquireTestLock(true, ["new-run"], {
        inMemory: true,
        store: memStore,
        skipSignalHandlers: true,
      });

      const currentLock = JSON.parse(memStore.readFileSync(".olt/.locks/broad-test.lock")) as {
        pid: number;
      };
      expect(currentLock.pid).toBe(process.pid);
      release();
    });

    it("cleans up corrupted unparseable existing lock file", () => {
      const memStore = createMemoryLockStore({
        "/custom.lock": "{ invalid json content",
      });

      const release = acquireTestLock(true, ["run"], {
        inMemory: true,
        store: memStore,
        lockFile: "/custom.lock",
        skipSignalHandlers: true,
      });

      expect(memStore.existsSync("/custom.lock")).toBe(true);
      release();
      expect(memStore.existsSync("/custom.lock")).toBe(false);
    });

    it("aborts execution with process.exit(1) if active lock belongs to running process", () => {
      const memStore = createMemoryLockStore({
        "/locked.lock": JSON.stringify({
          pid: process.pid,
          scope: "broad",
          args: ["existing-run"],
          startedAt: new Date().toISOString(),
        }),
      });

      const exitSpy = spyOn(process, "exit").mockImplementation(
        (c?: number | string | boolean | null) => {
          throw new Error(`ProcessExited_${String(c)}`);
        },
      );
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        expect(() =>
          acquireTestLock(true, ["conflict-run"], {
            inMemory: true,
            store: memStore,
            lockFile: "/locked.lock",
            skipSignalHandlers: true,
          }),
        ).toThrow("ProcessExited_1");
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        exitSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });

    it("does not release lock if PID in lockfile has changed", () => {
      const memStore = createMemoryLockStore();
      const release = acquireTestLock(true, ["run"], {
        inMemory: true,
        store: memStore,
        lockFile: "/my.lock",
        skipSignalHandlers: true,
      });

      memStore.writeFileSync(
        "/my.lock",
        JSON.stringify({ pid: 999999, scope: "broad", args: [], startedAt: "" }),
      );
      release();
      expect(memStore.existsSync("/my.lock")).toBe(true);
    });

    it("registers and triggers process signal handlers when skipSignalHandlers is false", () => {
      const memStore = createMemoryLockStore();
      const handlers = new Map<string, (err?: unknown) => void>();
      const onSpy = spyOn(process, "on").mockImplementation(
        (evt: string, fn: (...args: unknown[]) => void) => {
          handlers.set(evt, fn as (err?: unknown) => void);
          return process;
        },
      );
      const exitSpy = spyOn(process, "exit").mockImplementation(
        (c?: number | string | boolean | null) => {
          throw new Error(`Exit_${String(c)}`);
        },
      );
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        acquireTestLock(true, ["sig"], {
          inMemory: true,
          store: memStore,
          lockFile: "/sig.lock",
          skipSignalHandlers: false,
        });

        expect(handlers.has("exit")).toBe(true);
        expect(() => handlers.get("SIGINT")?.()).toThrow("Exit_130");
        expect(() => handlers.get("SIGTERM")?.()).toThrow("Exit_143");
        expect(() => handlers.get("uncaughtException")?.(new Error("boom"))).toThrow("Exit_1");
      } finally {
        onSpy.mockRestore();
        exitSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });
  });
});
