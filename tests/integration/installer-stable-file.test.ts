import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readStableBytes,
  readStableText,
} from "../../orchestrating-long-tasks/scripts/src/installer/stable-file.ts";
import { cleanInstallerFixtures, installerFixture } from "../unit/installer/helpers.ts";

afterEach(cleanInstallerFixtures);

describe("installer stable file reader", () => {
  test("reads valid UTF-8 text file", async () => {
    const { root } = await installerFixture();
    const filePath = join(root, "valid.txt");
    await writeFile(filePath, "hello world 🚀");
    expect(readStableText(filePath)).toBe("hello world 🚀");
  });

  test("reads binary bytes and handles multi-chunk files > 64KB", async () => {
    const { root } = await installerFixture();
    const filePath = join(root, "large.bin");
    const data = Buffer.alloc(70 * 1024, 0x42);
    await writeFile(filePath, data);
    const result = readStableBytes(filePath, 100 * 1024);
    expect(result.length).toBe(70 * 1024);
    expect(Buffer.from(result)).toEqual(data);
  });

  test("rejects when file size exceeds maximum limit", async () => {
    const { root } = await installerFixture();
    const filePath = join(root, "oversized.bin");
    await writeFile(filePath, Buffer.alloc(100));
    expect(() => readStableBytes(filePath, 50)).toThrow(
      /source identity file is unsafe or oversized/,
    );
  });

  test("rejects when target path is a directory", async () => {
    const { root } = await installerFixture();
    const dirPath = join(root, "some-dir");
    await mkdir(dirPath);
    expect(() => readStableBytes(dirPath)).toThrow(/source identity file is unsafe or oversized/);
  });

  test("rejects when target path is a symlink", async () => {
    const { root } = await installerFixture();
    const targetPath = join(root, "real.txt");
    const linkPath = join(root, "link.txt");
    await writeFile(targetPath, "content");
    await symlink(targetPath, linkPath);
    expect(() => readStableBytes(linkPath)).toThrow(/source identity file is unsafe or oversized/);
  });

  test("readStableText throws INTEGRITY error for non-UTF8 binary data", async () => {
    const { root } = await installerFixture();
    const filePath = join(root, "invalid-utf8.bin");
    await writeFile(filePath, Buffer.from([0xff, 0xfe, 0xff, 0xfe]));
    expect(() => readStableText(filePath)).toThrow(/source identity file is not UTF-8/);
  });
});
