import { describe, expect, it } from "bun:test";
import {
  allocateIsolatedPort,
  allocateIsolatedPorts,
  applyEnvOverrides,
  createTestIsolationContext,
  findRepoRoot,
  getIsolatedTempDir,
  isPortAvailable,
  releaseIsolatedPort,
  removeIsolatedTempDir,
  restoreEnvSnapshot,
  runWithIsolation,
  snapshotEnv,
  withIsolatedEnv,
  withIsolatedEnvSync,
} from "../../olt/scripts/src/testing/isolation.ts";

describe("Test Isolation & Concurrency Sandbox Primitives", () => {
  describe("Isolated Temp Directories", () => {
    it("generates and removes temp directory paths with string and object options", () => {
      expect(typeof findRepoRoot()).toBe("string");

      const dir1 = getIsolatedTempDir("test-prefix");
      expect(dir1).toContain("test-prefix");
      removeIsolatedTempDir(dir1);

      const dir2 = getIsolatedTempDir({
        prefix: "opts-prefix",
        subDir: "nested/folder",
        uuid: "static-uuid-1234",
        create: false,
      });
      expect(dir2).toContain("opts-prefix-static-uuid-1234");
      expect(dir2).toContain("nested/folder");
    });
  });

  describe("Environment Snapshot and Isolation helpers", () => {
    it("snapshots, applies overrides, and restores environment variables", () => {
      const initial = snapshotEnv();
      const testKey = "TEST_ISOLATION_VAR_XYZ";

      applyEnvOverrides({ [testKey]: "active", DELETEME: undefined });
      expect(process.env[testKey]).toBe("active");

      restoreEnvSnapshot(initial);
      expect(process.env[testKey]).toBeUndefined();
    });

    it("runs sync and async functions inside isolated env wrapper", async () => {
      const syncRes = withIsolatedEnvSync({ SCOPED_SYNC_VAR: "sync-val" }, () => {
        expect(process.env.SCOPED_SYNC_VAR).toBe("sync-val");
        return 42;
      });
      expect(syncRes).toBe(42);
      expect(process.env.SCOPED_SYNC_VAR).toBeUndefined();

      const asyncRes = await withIsolatedEnv({ SCOPED_ASYNC_VAR: "async-val" }, async () => {
        expect(process.env.SCOPED_ASYNC_VAR).toBe("async-val");
        return "done";
      });
      expect(asyncRes).toBe("done");
      expect(process.env.SCOPED_ASYNC_VAR).toBeUndefined();
    });
  });

  describe("Port allocation and availability", () => {
    it("allocates isolated ports, preferred ports, and handles port releasing", async () => {
      const port = await allocateIsolatedPort();
      expect(port).toBeGreaterThan(0);
      expect(await isPortAvailable(port)).toBe(false);

      releaseIsolatedPort(port);
      expect(await isPortAvailable(port)).toBe(true);

      const preferred = await allocateIsolatedPort({ preferredPort: port });
      expect(preferred).toBe(port);
      releaseIsolatedPort(preferred);

      const ports = await allocateIsolatedPorts(2);
      expect(ports.length).toBe(2);
      expect(ports[0]).not.toBe(ports[1]);
      for (const p of ports) releaseIsolatedPort(p);
    });
  });

  describe("TestIsolationContext - inMemory mode", () => {
    it("handles full lifecycle of in-memory files, env, ports, and disposal", async () => {
      const ctx = createTestIsolationContext({
        prefix: "mem-test",
        env: { CTX_VAR: "hello" },
        isolatedEnv: true,
        inMemory: true,
      });

      expect(ctx.id).toBeDefined();
      expect(typeof ctx.tempDir).toBe("string");
      expect(ctx.env.CTX_VAR).toBe("hello");
      expect(ctx.isCleanedUp).toBe(false);

      const port = await ctx.allocatePort();
      const morePorts = await ctx.allocatePorts(1);
      expect(ctx.allocatedPorts).toContain(port);
      expect(ctx.allocatedPorts).toContain(morePorts[0]!);

      ctx.createSubDir("nested/dir");
      const filePath = ctx.writeTempFile("nested/dir/test.txt", "file content");
      expect(filePath).toBe(ctx.getTempDir("nested/dir/test.txt"));
      expect(ctx.tempFileExists("nested/dir/test.txt")).toBe(true);
      expect(ctx.readTempFile("nested/dir/test.txt")).toBe("file content");

      ctx.writeTempFile("binary.dat", new Uint8Array([1, 2, 3]));
      expect(Array.from(ctx.readTempFileBuffer("binary.dat"))).toEqual([1, 2, 3]);

      const rootEntries = ctx.listTempFiles();
      expect(rootEntries).toContain("nested");
      expect(rootEntries).toContain("binary.dat");

      const nestedEntries = ctx.listTempFiles("nested/dir");
      expect(nestedEntries).toEqual(["test.txt"]);

      ctx.removeTempFile("nested");
      expect(ctx.tempFileExists("nested/dir/test.txt")).toBe(false);

      expect(() => ctx.readTempFile("missing.txt")).toThrow("File not found");
      expect(() => ctx.readTempFileBuffer("missing.txt")).toThrow("File not found");

      ctx.setEnv("DYNAMIC_VAR", "active");
      expect(ctx.env.DYNAMIC_VAR).toBe("active");
      expect(process.env.DYNAMIC_VAR).toBe("active");
      ctx.restoreEnv();

      await ctx.cleanup();
      expect(ctx.isCleanedUp).toBe(true);

      expect(ctx.allocatePort()).rejects.toThrow("Cannot allocate port on cleaned-up");
      expect(ctx.allocatePorts(1)).rejects.toThrow("Cannot allocate ports on cleaned-up");
      expect(() => ctx.setEnv("X", "Y")).toThrow("Cannot modify environment on cleaned-up");
    });
  });

  describe("TestIsolationContext - disk mode & runWithIsolation", () => {
    it("operates disk isolation context and cleans up automatically", async () => {
      const res = await runWithIsolation(
        async (ctx) => {
          ctx.createSubDir("disk-sub");
          ctx.writeTempFile("disk-sub/data.txt", "disk-content");
          expect(ctx.tempFileExists("disk-sub/data.txt")).toBe(true);
          expect(ctx.readTempFile("disk-sub/data.txt")).toBe("disk-content");
          expect(ctx.readTempFileBuffer("disk-sub/data.txt").length).toBe(12);

          const files = ctx.listTempFiles("disk-sub");
          expect(files).toContain("data.txt");

          ctx.removeTempFile("disk-sub/data.txt");
          expect(ctx.tempFileExists("disk-sub/data.txt")).toBe(false);

          return "sandbox-success";
        },
        { inMemory: false, prefix: "disk-run" },
      );

      expect(res).toBe("sandbox-success");
    });

    it("supports sync and async disposal primitives", async () => {
      const ctx = createTestIsolationContext({ inMemory: true });
      ctx[Symbol.dispose]();
      expect(ctx.isCleanedUp).toBe(true);

      const ctxAsync = createTestIsolationContext({ inMemory: true });
      await ctxAsync[Symbol.asyncDispose]();
      expect(ctxAsync.isCleanedUp).toBe(true);
    });
  });
});
