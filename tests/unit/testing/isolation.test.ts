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
  runWithIsolation,
  snapshotEnv,
  restoreEnvSnapshot,
  withIsolatedEnv,
  withIsolatedEnvSync,
} from "../../../olt/scripts/src/testing/isolation.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("testing subsystem isolation sandbox", () => {
  it("resolves repository root correctly", () => {
    const root = findRepoRoot();
    expect(root).toBeDefined();
    expect(existsSync(root)).toBe(true);
  });

  it("handles environment snapshots and overrides cleanly", () => {
    const snap = snapshotEnv();
    expect(snap).toBeDefined();
    applyEnvOverrides({ TEST_ISO_OVERRIDE_VAR: "active_value" });
    expect(process.env.TEST_ISO_OVERRIDE_VAR).toBe("active_value");
    restoreEnvSnapshot(snap);
    expect(process.env.TEST_ISO_OVERRIDE_VAR).toBeUndefined();
  });

  it("executes sync and async callbacks within isolated env", async () => {
    const syncRes = withIsolatedEnvSync({ SYNC_ISO_VAR: "sync_val" }, () => {
      expect(process.env.SYNC_ISO_VAR).toBe("sync_val");
      return 42;
    });
    expect(syncRes).toBe(42);
    expect(process.env.SYNC_ISO_VAR).toBeUndefined();

    const asyncRes = await withIsolatedEnv({ ASYNC_ISO_VAR: "async_val" }, async () => {
      expect(process.env.ASYNC_ISO_VAR).toBe("async_val");
      return "done";
    });
    expect(asyncRes).toBe("done");
    expect(process.env.ASYNC_ISO_VAR).toBeUndefined();
  });

  it("contains deletes to <repoRoot>/coverage/test-isolation and refuses paths outside it", () => {
    const outsideTarget = join(findRepoRoot(), ".olt", "not-test-isolation", "victim");
    let caught: unknown;
    try {
      removeIsolatedTempDir(outsideTarget);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HarnessError);
    const error = caught as HarnessError;
    expect(error.code).toBe("PATH_SAFETY");
    expect(error.message).toContain("CONTAINMENT");
  });

  it("silently no-ops removing an already-absent directory inside the isolation root", () => {
    const tempDir = getIsolatedTempDir({ prefix: "guard-noop" });
    removeIsolatedTempDir(tempDir);
    expect(existsSync(tempDir)).toBe(false);
    expect(() => removeIsolatedTempDir(tempDir)).not.toThrow();
  });

  it("allocates and checks ephemeral isolated ports safely", async () => {
    const port = await allocateIsolatedPort();
    expect(port).toBeGreaterThan(0);
    expect(await isPortAvailable(port)).toBe(false);
    releaseIsolatedPort(port);
    expect(await isPortAvailable(port)).toBe(true);

    const ports = await allocateIsolatedPorts(3);
    expect(ports.length).toBe(3);
    expect(new Set(ports).size).toBe(3);
    for (const p of ports) {
      releaseIsolatedPort(p);
    }
  });

  it("operates in-memory virtual filesystem without disk writes", async () => {
    const ctx = createTestIsolationContext({ prefix: "vfs-unit" });
    try {
      expect(ctx.id).toBeDefined();
      expect(ctx.isCleanedUp).toBe(false);
      // In-memory mode eliminates physical directory on disk
      expect(existsSync(ctx.tempDir)).toBe(false);

      const filePath = ctx.writeTempFile("nested/dir/sample.txt", "hello in-memory");
      expect(existsSync(filePath)).toBe(false);
      expect(ctx.tempFileExists("nested/dir/sample.txt")).toBe(true);
      expect(ctx.readTempFile("nested/dir/sample.txt")).toBe("hello in-memory");

      const binaryData = new Uint8Array([1, 2, 3, 4, 5]);
      ctx.writeTempFile("nested/binary.bin", binaryData);
      expect(ctx.readTempFileBuffer("nested/binary.bin")).toEqual(binaryData);

      ctx.createSubDir("custom/subfolder");
      expect(ctx.tempFileExists("custom/subfolder")).toBe(true);

      const rootListing = ctx.listTempFiles();
      expect(rootListing).toContain("nested");
      expect(rootListing).toContain("custom");

      const nestedListing = ctx.listTempFiles("nested");
      expect(nestedListing).toContain("dir");
      expect(nestedListing).toContain("binary.bin");

      ctx.removeTempFile("nested/dir/sample.txt");
      expect(ctx.tempFileExists("nested/dir/sample.txt")).toBe(false);
      expect(() => ctx.readTempFile("nested/dir/sample.txt")).toThrow();

      ctx.removeTempFile("nested");
      expect(ctx.tempFileExists("nested/binary.bin")).toBe(false);

      const port = await ctx.allocatePort();
      expect(port).toBeGreaterThan(0);
      expect(ctx.allocatedPorts).toContain(port);

      ctx.setEnv("SANDBOX_TEST_ENV", "vfs_value");
      expect(process.env.SANDBOX_TEST_ENV).toBe("vfs_value");
      expect(ctx.env.SANDBOX_TEST_ENV).toBe("vfs_value");
    } finally {
      await ctx.cleanup();
    }

    expect(ctx.isCleanedUp).toBe(true);
    expect(process.env.SANDBOX_TEST_ENV).toBeUndefined();
    expect(() => ctx.setEnv("VAR", "val")).toThrow();
    await expect(ctx.allocatePort()).rejects.toThrow();
  });

  it("supports synchronous cleanup and dispose scopes", () => {
    let savedDir = "";
    {
      using ctx = createTestIsolationContext({ prefix: "sync-disp" });
      savedDir = ctx.tempDir;
      ctx.writeTempFile("temp.txt", "content");
      expect(ctx.tempFileExists("temp.txt")).toBe(true);
    }
    expect(existsSync(savedDir)).toBe(false);
  });

  it("runs with runWithIsolation wrapper helper", async () => {
    const result = await runWithIsolation(async (ctx) => {
      ctx.writeTempFile("run-iso.txt", "isolated execution");
      expect(ctx.readTempFile("run-iso.txt")).toBe("isolated execution");
      return "success";
    });
    expect(result).toBe("success");
  });
});
