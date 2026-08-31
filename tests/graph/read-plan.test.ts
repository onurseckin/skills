import { describe, expect, test } from "bun:test";
import type { BigIntStats } from "node:fs";
import { lstat, mkdtemp, symlink, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readPlanObject } from "../../olt/scripts/src/graph/read-plan.ts";

describe("graph read plan object", () => {
  test("enforces size bounds, regular non-symlink files, and object json contents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "harness-read-plan-"));
    const validFile = join(dir, "valid.json");
    await writeFile(validFile, JSON.stringify({ key: "value" }));

    // Valid read
    const read = await readPlanObject(validFile, "test plan");
    expect(read).toEqual({ key: "value" });

    // Invalid maxBytes bound
    await expect(readPlanObject(validFile, "test plan", { maxBytes: 0 })).rejects.toThrow(
      "invalid size bound",
    );
    await expect(readPlanObject(validFile, "test plan", { maxBytes: -10 })).rejects.toThrow(
      "invalid size bound",
    );

    // Symlink file
    const symlinkPath = join(dir, "symlink.json");
    await symlink(validFile, symlinkPath);
    await expect(readPlanObject(symlinkPath, "test plan")).rejects.toThrow("not a regular file");

    // Directory
    await expect(readPlanObject(dir, "test plan")).rejects.toThrow("not a regular file");

    // Exceeds maxBytes
    await expect(readPlanObject(validFile, "test plan", { maxBytes: 5 })).rejects.toThrow(
      "exceeds 5 byte limit",
    );

    // JSON array (not object)
    const arrayFile = join(dir, "array.json");
    await writeFile(arrayFile, JSON.stringify(["item1", "item2"]));
    await expect(readPlanObject(arrayFile, "test plan")).rejects.toThrow(
      "must contain a JSON object",
    );

    // JSON primitive (not object)
    const primitiveFile = join(dir, "primitive.json");
    await writeFile(primitiveFile, JSON.stringify("a string"));
    await expect(readPlanObject(primitiveFile, "test plan")).rejects.toThrow(
      "must contain a JSON object",
    );
  });

  test("throws when the opened handle's identity disagrees with the pre-open lstat", async () => {
    // This guards a real TOCTOU race (the path gets swapped between the initial lstat and the
    // open) that isn't reproducible deterministically by racing real filesystem writes, so the
    // divergent stat is injected directly through the `open` seam instead.
    const dir = await mkdtemp(join(tmpdir(), "harness-read-plan-race-"));
    const filePath = join(dir, "race.json");
    await writeFile(filePath, JSON.stringify({ key: "value" }));

    // Bridges an intentionally partial stand-in (only the fields readPlanObject actually reads)
    // to the FileHandle contract; boundedRead's own methods are never reached because the
    // identity mismatch throws before that point.
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
    // Same TOCTOU shape as the previous test, but for the *second* race window (between finishing
    // the read and the closing lstat). Real `open`/`handle.stat` are left untouched so the first
    // race window's check passes normally; only the closing lstat is perturbed, and only on its
    // second call (the first call is the pre-open snapshot, which must still match reality).
    const dir = await mkdtemp(join(tmpdir(), "harness-read-plan-race-2-"));
    const filePath = join(dir, "race.json");
    await writeFile(filePath, JSON.stringify({ key: "value" }));

    let calls = 0;
    const raceLstat = async (path: string, options: { bigint: true }): Promise<BigIntStats> => {
      calls += 1;
      const real = await lstat(path, options);
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
