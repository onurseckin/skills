import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { readPlanObject } from "../../../olt/scripts/src/graph/read-plan.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("graph read plan object", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let dirCounter = 0;

  const mockFs = {
    mkdtemp: async (prefix: string): Promise<string> => {
      const dir = `/virtual/${prefix}${++dirCounter}`;
      vfs.mkdirSync(dir, { recursive: true });
      return dir;
    },
    writeFile: async (path: string, data: string | Uint8Array): Promise<void> => {
      vfs.writeFileSync(path, data);
    },
    symlink: async (target: string, path: string): Promise<void> => {
      session.symlinkSync(target, path);
    },
    lstat: async (path: string, options?: { bigint: boolean }): Promise<BigIntStats> => {
      return session.statSync(path, options as never) as unknown as BigIntStats;
    },
  };

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  test("enforces size bounds, regular non-symlink files, and object json contents", async () => {
    const dir = await mockFs.mkdtemp("harness-read-plan-");
    const validFile = join(dir, "valid.json");
    await mockFs.writeFile(validFile, JSON.stringify({ key: "value" }));

    const read = await readPlanObject(validFile, "test plan");
    expect(read).toEqual({ key: "value" });

    await expect(readPlanObject(validFile, "test plan", { maxBytes: 0 })).rejects.toThrow(
      "invalid size bound",
    );
    await expect(readPlanObject(validFile, "test plan", { maxBytes: -10 })).rejects.toThrow(
      "invalid size bound",
    );

    const symlinkPath = join(dir, "symlink.json");
    await mockFs.symlink(validFile, symlinkPath);
    await expect(readPlanObject(symlinkPath, "test plan")).rejects.toThrow("not a regular file");

    await expect(readPlanObject(dir, "test plan")).rejects.toThrow("not a regular file");

    await expect(readPlanObject(validFile, "test plan", { maxBytes: 5 })).rejects.toThrow(
      "exceeds 5 byte limit",
    );

    const arrayFile = join(dir, "array.json");
    await mockFs.writeFile(arrayFile, JSON.stringify(["item1", "item2"]));
    await expect(readPlanObject(arrayFile, "test plan")).rejects.toThrow(
      "must contain a JSON object",
    );

    const primitiveFile = join(dir, "primitive.json");
    await mockFs.writeFile(primitiveFile, JSON.stringify("a string"));
    await expect(readPlanObject(primitiveFile, "test plan")).rejects.toThrow(
      "must contain a JSON object",
    );
  });

  test("throws when the opened handle's identity disagrees with the pre-open lstat", async () => {
    const dir = await mockFs.mkdtemp("harness-read-plan-race-");
    const filePath = join(dir, "race.json");
    await mockFs.writeFile(filePath, JSON.stringify({ key: "value" }));

    const fakeHandle = {
      stat: async () =>
        ({
          isFile: () => true,
          dev: 0n,
          ino: 0n,
          mode: 0n,
          size: 999n,
          mtimeNs: 0n,
        }) as unknown as BigIntStats,
      close: async () => {},
    } as unknown as FileHandle;

    await expect(
      readPlanObject(filePath, "test plan", { open: async () => fakeHandle }),
    ).rejects.toThrow("path changed while it was opened");
  });

  test("throws when the path's post-read lstat disagrees with the handle's own post-read stat", async () => {
    const dir = await mockFs.mkdtemp("harness-read-plan-race-2-");
    const filePath = join(dir, "race.json");
    await mockFs.writeFile(filePath, JSON.stringify({ key: "value" }));

    let calls = 0;
    const raceLstat = async (path: string, options: { bigint: true }): Promise<BigIntStats> => {
      calls += 1;
      const real = await mockFs.lstat(path, options);
      if (calls < 2) return real;
      return {
        isSymbolicLink: () => real.isSymbolicLink(),
        isFile: () => real.isFile(),
        dev: real.dev,
        ino: real.ino,
        mode: real.mode,
        size: real.size + 1n,
        mtimeNs: real.mtimeNs,
      } as unknown as BigIntStats;
    };

    await expect(readPlanObject(filePath, "test plan", { lstat: raceLstat })).rejects.toThrow(
      "path changed while it was read",
    );
  });
});
