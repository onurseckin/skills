import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  findRepoRoot,
  getIsolatedTempDir,
  removeIsolatedTempDir,
  snapshotEnv,
  restoreEnvSnapshot,
  applyEnvOverrides,
  withIsolatedEnv,
  withIsolatedEnvSync,
  allocateIsolatedPort,
  allocateIsolatedPorts,
  releaseIsolatedPort,
  isPortAvailable,
  createTestIsolationContext,
  runWithIsolation,
  type TestIsolationContext,
} from "../../orchestrating-long-tasks/scripts/src/testing/isolation";

describe("Parallel Test Isolation Primitives", () => {
  describe("findRepoRoot", () => {
    it("should resolve root directory containing repository markers", () => {
      const root = findRepoRoot();
      expect(typeof root).toBe("string");
      expect(root.length).toBeGreaterThan(0);
      expect(existsSync(join(root, "package.json"))).toBe(true);
    });

    it("should resolve root starting from subdirectories", () => {
      const subDir = join(findRepoRoot(), "orchestrating-long-tasks", "scripts");
      const root = findRepoRoot(subDir);
      expect(root).toBe(findRepoRoot());
    });
  });

  describe("getIsolatedTempDir and removeIsolatedTempDir", () => {
    it("should create an isolated directory under .tmp/test-isolation", () => {
      const tempDir = getIsolatedTempDir();
      try {
        expect(existsSync(tempDir)).toBe(true);
        expect(tempDir).toContain(join(".tmp", "test-isolation"));
      } finally {
        removeIsolatedTempDir(tempDir);
      }
      expect(existsSync(tempDir)).toBe(false);
    });

    it("should respect prefix and subDir options", () => {
      const tempDir = getIsolatedTempDir({
        prefix: "worker-test",
        subDir: "nested-scope",
      });
      try {
        expect(existsSync(tempDir)).toBe(true);
        expect(tempDir).toContain("worker-test-");
        expect(tempDir.endsWith("nested-scope")).toBe(true);
      } finally {
        // remove the parent isolated dir
        const parent = join(tempDir, "..");
        removeIsolatedTempDir(parent);
      }
    });

    it("should handle removeIsolatedTempDir safely on non-existent directories", () => {
      expect(() => {
        removeIsolatedTempDir(join(findRepoRoot(), ".tmp", "test-isolation", "non-existent-dir-12345"));
      }).not.toThrow();
    });
  });

  describe("Environment Isolation", () => {
    it("should accurately snapshot and restore process.env", () => {
      const snapshot = snapshotEnv();
      const testKey = "TEST_ISOLATION_VAR_" + Math.random().toString(36).slice(2, 8);

      process.env[testKey] = "temp_value";
      expect(process.env[testKey]).toBe("temp_value");

      restoreEnvSnapshot(snapshot);
      expect(process.env[testKey]).toBeUndefined();
    });

    it("should apply environment overrides", () => {
      const key1 = "ISOLATION_OVERRIDE_1";
      const key2 = "ISOLATION_OVERRIDE_2";
      process.env[key2] = "old_val";

      applyEnvOverrides({
        [key1]: "new_val_1",
        [key2]: undefined,
      });

      expect(process.env[key1]).toBe("new_val_1");
      expect(process.env[key2]).toBeUndefined();

      delete process.env[key1];
    });

    it("should run withIsolatedEnvSync and revert mutations on return", () => {
      const envKey = "ISOLATED_SYNC_ENV_TEST";
      delete process.env[envKey];

      const result = withIsolatedEnvSync({ [envKey]: "sync_active" }, () => {
        expect(process.env[envKey]).toBe("sync_active");
        return 42;
      });

      expect(result).toBe(42);
      expect(process.env[envKey]).toBeUndefined();
    });

    it("should run withIsolatedEnvSync and revert mutations on throw", () => {
      const envKey = "ISOLATED_SYNC_ERROR_TEST";
      delete process.env[envKey];

      expect(() => {
        withIsolatedEnvSync({ [envKey]: "sync_active_error" }, () => {
          expect(process.env[envKey]).toBe("sync_active_error");
          throw new Error("sync error");
        });
      }).toThrow("sync error");

      expect(process.env[envKey]).toBeUndefined();
    });

    it("should run withIsolatedEnv asynchronously and revert mutations on completion", async () => {
      const envKey = "ISOLATED_ASYNC_ENV_TEST";
      delete process.env[envKey];

      const result = await withIsolatedEnv({ [envKey]: "async_active" }, async () => {
        await new Promise((res) => setTimeout(res, 5));
        expect(process.env[envKey]).toBe("async_active");
        return "success";
      });

      expect(result).toBe("success");
      expect(process.env[envKey]).toBeUndefined();
    });

    it("should run withIsolatedEnv asynchronously and revert mutations on failure", async () => {
      const envKey = "ISOLATED_ASYNC_ERROR_TEST";
      delete process.env[envKey];

      await expect(
        withIsolatedEnv({ [envKey]: "async_err_active" }, async () => {
          await new Promise((res) => setTimeout(res, 5));
          throw new Error("async failure");
        }),
      ).rejects.toThrow("async failure");

      expect(process.env[envKey]).toBeUndefined();
    });
  });

  describe("Ephemeral Port Allocation", () => {
    it("should allocate a free port", async () => {
      const port = await allocateIsolatedPort();
      try {
        expect(typeof port).toBe("number");
        expect(port).toBeGreaterThan(0);
        expect(port).toBeLessThanOrEqual(65535);
      } finally {
        releaseIsolatedPort(port);
      }
    });

    it("should allocate multiple distinct ports", async () => {
      const ports = await allocateIsolatedPorts(3);
      try {
        expect(ports.length).toBe(3);
        const unique = new Set(ports);
        expect(unique.size).toBe(3);
        for (const p of ports) {
          expect(p).toBeGreaterThan(0);
        }
      } finally {
        for (const p of ports) {
          releaseIsolatedPort(p);
        }
      }
    });

    it("should check port availability", async () => {
      const port = await allocateIsolatedPort();
      // While reserved in our tracker, isPortAvailable should return false
      expect(await isPortAvailable(port)).toBe(false);

      releaseIsolatedPort(port);
      // Once released, the port should be reported as available for binding
      expect(await isPortAvailable(port)).toBe(true);
    });
  });

  describe("createTestIsolationContext", () => {
    it("should create, operate, and clean up an isolated context", async () => {
      const testEnvKey = "CTX_TEST_ENV_" + Math.random().toString(36).slice(2, 6);
      const ctx = createTestIsolationContext({
        prefix: "ctx-unit",
        env: {
          [testEnvKey]: "active_value",
        },
      });

      try {
        expect(ctx.id).toBeDefined();
        expect(ctx.isCleanedUp).toBe(false);
        expect(existsSync(ctx.tempDir)).toBe(true);
        expect(process.env[testEnvKey]).toBe("active_value");
        expect(ctx.env[testEnvKey]).toBe("active_value");

        // Filesystem operations
        const writtenPath = ctx.writeTempFile("nested/sample.txt", "hello isolation");
        expect(existsSync(writtenPath)).toBe(true);
        expect(ctx.tempFileExists("nested/sample.txt")).toBe(true);
        expect(ctx.readTempFile("nested/sample.txt")).toBe("hello isolation");

        const buffer = ctx.readTempFileBuffer("nested/sample.txt");
        expect(buffer.length).toBe(15);

        const subDir = ctx.createSubDir("subfolder");
        expect(existsSync(subDir)).toBe(true);

        const files = ctx.listTempFiles();
        expect(files).toContain("nested");
        expect(files).toContain("subfolder");

        // Port allocation in context
        const port = await ctx.allocatePort();
        expect(port).toBeGreaterThan(0);
        expect(ctx.allocatedPorts).toContain(port);

        // Env mutation in context
        ctx.setEnv(testEnvKey, "mutated_value");
        expect(process.env[testEnvKey]).toBe("mutated_value");

        ctx.removeTempFile("nested/sample.txt");
        expect(ctx.tempFileExists("nested/sample.txt")).toBe(false);
      } finally {
        await ctx.cleanup();
      }

      expect(ctx.isCleanedUp).toBe(true);
      expect(existsSync(ctx.tempDir)).toBe(false);
      expect(process.env[testEnvKey]).toBeUndefined();

      // Throws on post-cleanup operations
      expect(() => ctx.setEnv("ANOTHER_VAR", "fail")).toThrow();
      await expect(ctx.allocatePort()).rejects.toThrow();
    });

    it("should support synchronous cleanupSync", () => {
      const ctx = createTestIsolationContext({ prefix: "sync-ctx" });
      const dir = ctx.tempDir;
      expect(existsSync(dir)).toBe(true);

      ctx.cleanupSync();
      expect(ctx.isCleanedUp).toBe(true);
      expect(existsSync(dir)).toBe(false);
    });

    it("should support explicit resource management with Symbol.dispose", () => {
      let capturedDir = "";
      {
        using ctx = createTestIsolationContext({ prefix: "dispose-ctx" });
        capturedDir = ctx.tempDir;
        expect(existsSync(capturedDir)).toBe(true);
      }
      expect(existsSync(capturedDir)).toBe(false);
    });
  });

  describe("runWithIsolation", () => {
    it("should execute inside sandbox and clean up on completion", async () => {
      let observedDir = "";
      const testKey = "RUN_WITH_ISOLATION_KEY";

      const outcome = await runWithIsolation(
        async (ctx: TestIsolationContext) => {
          observedDir = ctx.tempDir;
          expect(existsSync(observedDir)).toBe(true);
          expect(process.env[testKey]).toBe("sandboxed");

          ctx.writeTempFile("data.json", JSON.stringify({ ok: true }));
          expect(ctx.readTempFile("data.json")).toBe('{"ok":true}');

          const port = await ctx.allocatePort();
          expect(port).toBeGreaterThan(0);

          return { status: "complete", port };
        },
        {
          prefix: "runner-test",
          env: { [testKey]: "sandboxed" },
        },
      );

      expect(outcome.status).toBe("complete");
      expect(outcome.port).toBeGreaterThan(0);
      expect(existsSync(observedDir)).toBe(false);
      expect(process.env[testKey]).toBeUndefined();
    });

    it("should clean up resources even when callback throws", async () => {
      let observedDir = "";
      const testKey = "RUN_WITH_ISOLATION_FAIL_KEY";

      await expect(
        runWithIsolation(
          (ctx: TestIsolationContext) => {
            observedDir = ctx.tempDir;
            expect(existsSync(observedDir)).toBe(true);
            throw new Error("Sandbox catastrophic failure");
          },
          {
            prefix: "fail-test",
            env: { [testKey]: "fail_val" },
          },
        ),
      ).rejects.toThrow("Sandbox catastrophic failure");

      expect(existsSync(observedDir)).toBe(false);
      expect(process.env[testKey]).toBeUndefined();
    });
  });
});
