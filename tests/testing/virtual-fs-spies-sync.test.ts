import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { VirtualMemoryFS } from "../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/spies.ts";

describe("Virtual FS Spies - Synchronous Operations", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync("/virtual", { recursive: true });
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  it("handles mkdtempSync with prefix and creates unique directory", () => {
    const dir = fs.mkdtempSync("/virtual/tmp/sync-test-");
    expect(dir.startsWith("/virtual/tmp/sync-test-")).toBe(true);
    expect(vfs.existsSync(dir)).toBe(true);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });

  it("handles symlinkSync and readlinkSync (string and buffer)", () => {
    fs.writeFileSync("/virtual/orig.txt", "target data");
    fs.symlinkSync("/virtual/orig.txt", "/virtual/link.txt");

    expect(fs.readlinkSync("/virtual/link.txt")).toBe("/virtual/orig.txt");
    const buf = fs.readlinkSync("/virtual/link.txt", "buffer");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe("/virtual/orig.txt");

    const objBuf = fs.readlinkSync("/virtual/link.txt", { encoding: "buffer" });
    expect(Buffer.isBuffer(objBuf)).toBe(true);

    expect(() => fs.readlinkSync("/virtual/missing-link.txt")).toThrow("ENOENT");
  });

  it("handles utimesSync with number, Date, and fallback", () => {
    fs.writeFileSync("/virtual/mtime.txt", "hello");
    fs.utimesSync("/virtual/mtime.txt", 1000, 2000);
    expect(fs.statSync("/virtual/mtime.txt").mtimeMs).toBe(2000);

    const d = new Date("2025-01-01T00:00:00Z");
    fs.utimesSync("/virtual/mtime.txt", d, d);
    expect(fs.statSync("/virtual/mtime.txt").mtimeMs).toBe(d.getTime());

    fs.utimesSync("/virtual/mtime.txt", "invalid", "invalid");
    expect(fs.statSync("/virtual/mtime.txt").mtimeMs).toBeGreaterThan(0);
  });

  it("handles copyFileSync for virtual paths with auto-parent creation", () => {
    fs.writeFileSync("/virtual/src/data.txt", "copied content");
    fs.copyFileSync("/virtual/src/data.txt", "/virtual/nested/dest/data.txt");
    expect(vfs.readFileSync("/virtual/nested/dest/data.txt", "utf8")).toBe("copied content");
  });

  it("handles ftruncateSync with existing descriptor and unknown fd", () => {
    fs.writeFileSync("/virtual/trunc.txt", "0123456789");
    const fd = fs.openSync("/virtual/trunc.txt", "r+");
    fs.ftruncateSync(fd, 4);
    expect(vfs.readFileSync("/virtual/trunc.txt", "utf8")).toBe("0123");
    fs.ftruncateSync(fd, null);
    expect(vfs.readFileSync("/virtual/trunc.txt", "utf8")).toBe("");
    expect(() => fs.ftruncateSync(99999, 2)).not.toThrow();
    fs.closeSync(fd);
  });

  it("handles chmodSync and fchmodSync with string and numeric modes", () => {
    fs.writeFileSync("/virtual/chmod.txt", "content");
    fs.chmodSync("/virtual/chmod.txt", 0o755);
    expect(fs.statSync("/virtual/chmod.txt").mode & 0o777).toBe(0o755);

    fs.chmodSync("/virtual/chmod.txt", "644");
    expect(fs.statSync("/virtual/chmod.txt").mode & 0o777).toBe(0o644);

    const fd = fs.openSync("/virtual/chmod.txt", "r");
    fs.fchmodSync(fd, 0o700);
    expect(fs.statSync("/virtual/chmod.txt").mode & 0o777).toBe(0o700);
    fs.fchmodSync(fd, "600");
    expect(fs.statSync("/virtual/chmod.txt").mode & 0o777).toBe(0o600);
    expect(() => fs.fchmodSync(99999, 0o777)).not.toThrow();
    fs.closeSync(fd);
  });

  it("handles fchownSync and futimesSync", () => {
    fs.writeFileSync("/virtual/futimes.txt", "test");
    const fd = fs.openSync("/virtual/futimes.txt", "r");
    expect(() => fs.fchownSync(fd, 1000, 1000)).not.toThrow();

    fs.futimesSync(fd, 500, 1500);
    expect(fs.statSync("/virtual/futimes.txt").mtimeMs).toBe(1500);

    const date = new Date("2026-06-01T12:00:00Z");
    fs.futimesSync(fd, date, date);
    expect(fs.statSync("/virtual/futimes.txt").mtimeMs).toBe(date.getTime());

    fs.futimesSync(fd, "invalid", "invalid");
    expect(fs.statSync("/virtual/futimes.txt").mtimeMs).toBeGreaterThan(0);

    expect(() => fs.futimesSync(99999, 10, 20)).not.toThrow();
    fs.closeSync(fd);
  });

  it("cleans up metadata maps on rmSync and unlinkSync", () => {
    fs.mkdirSync("/virtual/cleanup-dir/sub", { recursive: true });
    fs.writeFileSync("/virtual/cleanup-dir/sub/file.txt", "abc");
    fs.symlinkSync("/virtual/cleanup-dir/sub/file.txt", "/virtual/cleanup-dir/sub/link.txt");
    fs.chmodSync("/virtual/cleanup-dir/sub", 0o755);
    fs.utimesSync("/virtual/cleanup-dir/sub/file.txt", 100, 200);

    fs.unlinkSync("/virtual/cleanup-dir/sub/file.txt");
    expect(vfs.existsSync("/virtual/cleanup-dir/sub/file.txt")).toBe(false);

    fs.rmSync("/virtual/cleanup-dir", { recursive: true, force: true });
    expect(vfs.existsSync("/virtual/cleanup-dir")).toBe(false);
  });

  it("handles readFileSync and readdirSync option variations", () => {
    fs.mkdirSync("/virtual/rd-dir", { recursive: true });
    fs.writeFileSync("/virtual/rd-dir/hello.txt", "world");

    expect(fs.readFileSync("/virtual/rd-dir/hello.txt", "utf8")).toBe("world");
    expect(fs.readFileSync("/virtual/rd-dir/hello.txt", { encoding: "utf8" })).toBe("world");
    expect(Buffer.isBuffer(fs.readFileSync("/virtual/rd-dir/hello.txt"))).toBe(true);

    const entries = fs.readdirSync("/virtual/rd-dir", { withFileTypes: true });
    expect(entries.length).toBe(1);
    expect(entries[0]?.isFile()).toBe(true);
  });

  it("handles fs.readSync and fs.writeSync spies directly", () => {
    fs.writeFileSync("/virtual/direct-rw.txt", "abcdef");
    const fd = fs.openSync("/virtual/direct-rw.txt", "r+");
    const buf = Buffer.alloc(3);
    const readCount = fs.readSync(fd, buf, 0, 3, 0);
    expect(readCount).toBe(3);
    expect(buf.toString()).toBe("abc");

    const writeCount = fs.writeSync(fd, "XYZ", 0, 3, 0);
    expect(writeCount).toBe(3);
    expect(fs.readFileSync("/virtual/direct-rw.txt", "utf8")).toBe("XYZdef");
    fs.closeSync(fd);
  });

  it("handles appendFileSync, fsyncSync, and fdatasyncSync", () => {
    fs.appendFileSync("/virtual/append.txt", "first-");
    expect(vfs.readFileSync("/virtual/append.txt", "utf8")).toBe("first-");

    fs.appendFileSync("/virtual/append.txt", new TextEncoder().encode("second"));
    expect(vfs.readFileSync("/virtual/append.txt", "utf8")).toBe("first-second");

    expect(() => fs.fsyncSync(1)).not.toThrow();
    expect(() => fs.fdatasyncSync(1)).not.toThrow();
  });

  it("handles realpathSync resolving direct, nested symlinks, and fallback", () => {
    fs.mkdirSync("/virtual/real/target", { recursive: true });
    fs.writeFileSync("/virtual/real/target/file.txt", "data");
    fs.symlinkSync("/virtual/real/target", "/virtual/real/link-dir");

    expect(fs.realpathSync("/virtual/real/link-dir")).toBe("/virtual/real/target");
    expect(fs.realpathSync("/virtual/real/link-dir/file.txt")).toBe(
      "/virtual/real/target/file.txt",
    );
    expect(fs.realpathSync("/virtual/real/target")).toBe("/virtual/real/target");
    expect(fs.realpathSync(process.cwd())).toBe(process.cwd());

    expect(() => fs.realpathSync("/virtual/missing-path-12345")).toThrow();
  });

  it("handles fstatSync and closeSync on openDescriptors and unknown descriptors", () => {
    fs.writeFileSync("/virtual/fstat-test.txt", "sample");
    const fd = fs.openSync("/virtual/fstat-test.txt", "r");

    const st = fs.fstatSync(fd);
    expect(st.isFile()).toBe(true);
    expect(st.size).toBe(6);

    const stBig = fs.fstatSync(fd, { bigint: true });
    expect(typeof stBig.size).toBe("bigint");
    expect(stBig.size).toBe(6n);

    fs.closeSync(fd);
    expect(() => fs.closeSync(99999)).not.toThrow();
  });
});
