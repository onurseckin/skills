import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { exchangePaths, renameNoReplace } from "../../olt/scripts/src/installer/native-rename.ts";

describe("Native Rename Coverage Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `native-rename-cov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("renameNoReplace", () => {
    it("moves a single file to a non-existent destination", () => {
      const src = join(tempDir, "source.txt");
      const dst = join(tempDir, "dest.txt");
      writeFileSync(src, "payload-content", "utf8");

      renameNoReplace(src, dst, "move single file");

      expect(existsSync(src)).toBe(false);
      expect(existsSync(dst)).toBe(true);
      expect(readFileSync(dst, "utf8")).toBe("payload-content");
    });

    it("moves a directory structure to a non-existent target path", () => {
      const srcDir = join(tempDir, "source-dir");
      const dstDir = join(tempDir, "target-dir");
      mkdirSync(join(srcDir, "nested"), { recursive: true });
      writeFileSync(join(srcDir, "nested", "data.json"), '{"valid":true}', "utf8");

      renameNoReplace(srcDir, dstDir, "move directory tree");

      expect(existsSync(srcDir)).toBe(false);
      expect(existsSync(join(dstDir, "nested", "data.json"))).toBe(true);
      expect(readFileSync(join(dstDir, "nested", "data.json"), "utf8")).toBe('{"valid":true}');
    });

    it("throws HarnessError with INVALID_STATE and custom label when destination already exists", () => {
      const src = join(tempDir, "source-conflict.txt");
      const dst = join(tempDir, "dest-conflict.txt");
      writeFileSync(src, "alpha", "utf8");
      writeFileSync(dst, "beta", "utf8");

      expect(() => renameNoReplace(src, dst, "release step 3")).toThrow(HarnessError);

      try {
        renameNoReplace(src, dst, "release step 3");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.message).toContain("release step 3");
        expect(harnessErr.message).toContain("destination already exists");
      }
    });

    it("throws HarnessError with INVALID_STATE when source does not exist", () => {
      const src = join(tempDir, "missing-src.txt");
      const dst = join(tempDir, "never-created.txt");

      expect(() => renameNoReplace(src, dst, "relocate artifact")).toThrow(HarnessError);

      try {
        renameNoReplace(src, dst, "relocate artifact");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.message).toContain("relocate artifact");
        expect(harnessErr.message).toContain("rename failed with errno");
      }
    });

    it("handles file paths with spaces and special characters", () => {
      const src = join(tempDir, "source file with space & symbols #1.txt");
      const dst = join(tempDir, "dest file with space & symbols #1.txt");
      writeFileSync(src, "special-char-data", "utf8");

      renameNoReplace(src, dst, "special chars rename");

      expect(existsSync(src)).toBe(false);
      expect(readFileSync(dst, "utf8")).toBe("special-char-data");
    });
  });

  describe("exchangePaths", () => {
    it("atomically swaps contents of two existing files", () => {
      const left = join(tempDir, "left.txt");
      const right = join(tempDir, "right.txt");
      writeFileSync(left, "initial-left", "utf8");
      writeFileSync(right, "initial-right", "utf8");

      exchangePaths(left, right, "file exchange");

      expect(readFileSync(left, "utf8")).toBe("initial-right");
      expect(readFileSync(right, "utf8")).toBe("initial-left");
    });

    it("atomically swaps two directory trees with nested assets", () => {
      const leftDir = join(tempDir, "dir-left");
      const rightDir = join(tempDir, "dir-right");
      mkdirSync(join(leftDir, "sub"), { recursive: true });
      mkdirSync(join(rightDir, "sub"), { recursive: true });
      writeFileSync(join(leftDir, "sub", "id.txt"), "left-payload", "utf8");
      writeFileSync(join(rightDir, "sub", "id.txt"), "right-payload", "utf8");

      exchangePaths(leftDir, rightDir, "directory exchange");

      expect(readFileSync(join(leftDir, "sub", "id.txt"), "utf8")).toBe("right-payload");
      expect(readFileSync(join(rightDir, "sub", "id.txt"), "utf8")).toBe("left-payload");
    });

    it("restores original state when exchanged twice consecutively", () => {
      const left = join(tempDir, "toggle-left.txt");
      const right = join(tempDir, "toggle-right.txt");
      writeFileSync(left, "left-val", "utf8");
      writeFileSync(right, "right-val", "utf8");

      exchangePaths(left, right, "swap 1");
      exchangePaths(left, right, "swap 2");

      expect(readFileSync(left, "utf8")).toBe("left-val");
      expect(readFileSync(right, "utf8")).toBe("right-val");
    });

    it("throws HarnessError when left path is missing", () => {
      const left = join(tempDir, "nonexistent-left");
      const right = join(tempDir, "existing-right");
      writeFileSync(right, "existing", "utf8");

      expect(() => exchangePaths(left, right, "swap failure left")).toThrow(HarnessError);

      try {
        exchangePaths(left, right, "swap failure left");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.message).toContain("swap failure left");
      }
    });

    it("throws HarnessError when right path is missing", () => {
      const left = join(tempDir, "existing-left");
      const right = join(tempDir, "nonexistent-right");
      writeFileSync(left, "existing", "utf8");

      expect(() => exchangePaths(left, right, "swap failure right")).toThrow(HarnessError);

      try {
        exchangePaths(left, right, "swap failure right");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.message).toContain("swap failure right");
      }
    });
  });
});
