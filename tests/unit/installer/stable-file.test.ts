import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { readStableBytes, readStableText } from "../../../olt/scripts/src/installer/stable-file.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("readStableBytes", () => {
  test("reads the exact bytes of a small file", () => {
    const root = scratchRoot(import.meta.path, "reads-bytes");
    const file = join(root, "file.bin");
    writeFileSync(file, "hello world");
    expect(Buffer.from(readStableBytes(file)).toString("utf8")).toBe("hello world");
  });

  test("reads a file right at the maximum size", () => {
    const root = scratchRoot(import.meta.path, "reads-at-maximum");
    const file = join(root, "file.bin");
    writeFileSync(file, "abcde");
    expect(Buffer.from(readStableBytes(file, 5)).toString("utf8")).toBe("abcde");
  });

  test("throws when the path is a directory", () => {
    const root = scratchRoot(import.meta.path, "rejects-directory");
    const directory = join(root, "dir");
    mkdirSync(directory);
    expect(() => readStableBytes(directory)).toThrow(HarnessError);
  });

  test("throws when the path is a symlink", () => {
    const root = scratchRoot(import.meta.path, "rejects-symlink");
    const real = join(root, "real.txt");
    writeFileSync(real, "content");
    const link = join(root, "link.txt");
    symlinkSync(real, link);
    expect(() => readStableBytes(link)).toThrow(HarnessError);
  });

  test("throws when the file exceeds the size ceiling before opening it", () => {
    const root = scratchRoot(import.meta.path, "rejects-too-large-upfront");
    const file = join(root, "big.bin");
    writeFileSync(file, "x".repeat(100));
    expect(() => readStableBytes(file, 10)).toThrow(HarnessError);
  });

  test("reads a file spanning multiple 64KiB read chunks", () => {
    const root = scratchRoot(import.meta.path, "reads-multiple-chunks");
    const file = join(root, "multi-chunk.bin");
    const content = "z".repeat(70 * 1024);
    writeFileSync(file, content);
    expect(Buffer.from(readStableBytes(file, 128 * 1024)).toString("utf8")).toBe(content);
  });

  test("defaults to a 1MiB maximum when none is given", () => {
    const root = scratchRoot(import.meta.path, "default-maximum");
    const file = join(root, "default.bin");
    writeFileSync(file, "small");
    expect(Buffer.from(readStableBytes(file)).toString("utf8")).toBe("small");
  });
});

describe("readStableText", () => {
  test("decodes valid UTF-8 content", () => {
    const root = scratchRoot(import.meta.path, "decodes-utf8");
    const file = join(root, "text.txt");
    writeFileSync(file, "héllo wörld", "utf8");
    expect(readStableText(file)).toBe("héllo wörld");
  });

  test("throws HarnessError for invalid UTF-8 bytes", () => {
    const root = scratchRoot(import.meta.path, "rejects-invalid-utf8");
    const file = join(root, "invalid.bin");
    writeFileSync(file, Buffer.from([0xff, 0xfe, 0xfd]));
    expect(() => readStableText(file)).toThrow(HarnessError);
    try {
      readStableText(file);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).message).toContain("not UTF-8");
    }
  });

  test("propagates the original HarnessError when the underlying read fails first", () => {
    const root = scratchRoot(import.meta.path, "propagates-read-error");
    const directory = join(root, "dir");
    mkdirSync(directory);
    expect(() => readStableText(directory)).toThrow(HarnessError);
    try {
      readStableText(directory);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).message).toContain("unsafe or oversized");
    }
  });
});
