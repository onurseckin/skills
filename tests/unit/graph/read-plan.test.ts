import { describe, expect, test } from "bun:test";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readPlanObject } from "../../../orchestrating-long-tasks/scripts/src/graph/read-plan.ts";

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
});
