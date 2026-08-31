import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRegularFileNoFollow } from "../../olt/scripts/src/core/no-follow.ts";

describe("core/no-follow.ts", () => {
  it("reads regular file contents safely", () => {
    const tmp = mkdtempSync(join(tmpdir(), "nofollow-test-"));
    try {
      const file = join(tmp, "regular.txt");
      writeFileSync(file, "hello nofollow");
      const bytes = readRegularFileNoFollow(file);
      expect(new TextDecoder().decode(bytes)).toBe("hello nofollow");

      const dir = join(tmp, "directory");
      mkdirSync(dir);
      expect(() => readRegularFileNoFollow(dir)).toThrow("not a regular file");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
