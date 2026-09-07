import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { VirtualMemoryFS } from "../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/spies.ts";

const mockFs = await import("node:fs");

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
    const dir = mockFs.mkdtempSync("/virtual/tmp/sync-test-");
    expect(dir.startsWith("/virtual/tmp/sync-test-")).toBe(true);
    expect(vfs.existsSync(dir)).toBe(true);
    expect(mockFs.statSync(dir).isDirectory()).toBe(true);
  });

  it("handles symlinkSync and readlinkSync (string and buffer)", () => {
    mockFs.writeFileSync("/virtual/orig.txt", "target data");
    mockFs.symlinkSync("/virtual/orig.txt", "/virtual/link.txt");

    expect(mockFs.readlinkSync("/virtual/link.txt")).toBe("/virtual/orig.txt");
    const buf = mockFs.readlinkSync("/virtual/link.txt", "buffer");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe("/virtual/orig.txt");

    const objBuf = mockFs.readlinkSync("/virtual/link.txt", { encoding: "buffer" });
    expect(Buffer.isBuffer(objBuf)).toBe(true);

    expect(() => mockFs.readlinkSync("/virtual/missing-link.txt")).toThrow("ENOENT");
  });

  it("handles utimesSync with number, Date, and fallback", () => {
    mockFs.writeFileSync("/virtual/mtime.txt", "hello");
    mockFs.utimesSync("/virtual/mtime.txt", 1000, 2000);
    expect(mockFs.statSync("/virtual/mtime.txt").mtimeMs).toBe(2_000_000);

    const d = new Date("2025-01-01T00:00:00Z");
    mockFs.utimesSync("/virtual/mtime.txt", d, d);
    expect(mockFs.statSync("/virtual/mtime.txt").mtimeMs).toBe(d.getTime());

    mockFs.utimesSync("/virtual/mtime.txt", "invalid", "invalid");
    expect(mockFs.statSync("/virtual/mtime.txt").mtimeMs).toBeGreaterThan(0);
  });

  it("handles copyFileSync for virtual paths with auto-parent creation", () => {
    mockFs.writeFileSync("/virtual/src/data.txt", "copied content");
    mockFs.copyFileSync("/virtual/src/data.txt", "/virtual/nested/dest/data.txt");
    expect(vfs.readFileSync("/virtual/nested/dest/data.txt", "utf8")).toBe("copied content");
  });

  it("handles ftruncateSync with existing descriptor and unknown fd", () => {
    mockFs.writeFileSync("/virtual/trunc.txt", "0123456789");
    const fd = mockFs.openSync("/virtual/trunc.txt", "r+");
    mockFs.ftruncateSync(fd, 4);
    expect(vfs.readFileSync("/virtual/trunc.txt", "utf8")).toBe("0123");
    mockFs.ftruncateSync(fd, null);
    expect(vfs.readFileSync("/virtual/trunc.txt", "utf8")).toBe("");
    expect(() => mockFs.ftruncateSync(99999, 2)).not.toThrow();
    mockFs.closeSync(fd);
  });

  it("handles chmodSync and fchmodSync with string and numeric modes", () => {
    mockFs.writeFileSync("/virtual/chmod.txt", "content");
    mockFs.chmodSync("/virtual/chmod.txt", 0o755);
    expect(mockFs.statSync("/virtual/chmod.txt").mode & 0o777).toBe(0o755);

    mockFs.chmodSync("/virtual/chmod.txt", "644");
    expect(mockFs.statSync("/virtual/chmod.txt").mode & 0o777).toBe(0o644);

    const fd = mockFs.openSync("/virtual/chmod.txt", "r");
    mockFs.fchmodSync(fd, 0o700);
    expect(mockFs.statSync("/virtual/chmod.txt").mode & 0o777).toBe(0o700);
    mockFs.fchmodSync(fd, "600");
    expect(mockFs.statSync("/virtual/chmod.txt").mode & 0o777).toBe(0o600);
    expect(() => mockFs.fchmodSync(99999, 0o777)).not.toThrow();
    mockFs.closeSync(fd);
  });

  it("handles fchownSync and futimesSync", () => {
    mockFs.writeFileSync("/virtual/futimes.txt", "test");
    const fd = mockFs.openSync("/virtual/futimes.txt", "r");
    expect(() => mockFs.fchownSync(fd, 1000, 1000)).not.toThrow();

    mockFs.futimesSync(fd, 500, 1500);
    expect(mockFs.statSync("/virtual/futimes.txt").mtimeMs).toBe(1_500_000);

    const date = new Date("2026-06-01T12:00:00Z");
    mockFs.futimesSync(fd, date, date);
    expect(mockFs.statSync("/virtual/futimes.txt").mtimeMs).toBe(date.getTime());

    mockFs.futimesSync(fd, "invalid", "invalid");
    expect(mockFs.statSync("/virtual/futimes.txt").mtimeMs).toBeGreaterThan(0);

    expect(() => mockFs.futimesSync(99999, 10, 20)).not.toThrow();
    mockFs.closeSync(fd);
  });

  it("cleans up metadata maps on rmSync and unlinkSync", () => {
    mockFs.mkdirSync("/virtual/cleanup-dir/sub", { recursive: true });
    mockFs.writeFileSync("/virtual/cleanup-dir/sub/file.txt", "abc");
    mockFs.symlinkSync("/virtual/cleanup-dir/sub/file.txt", "/virtual/cleanup-dir/sub/link.txt");
    mockFs.chmodSync("/virtual/cleanup-dir/sub", 0o755);
    mockFs.utimesSync("/virtual/cleanup-dir/sub/file.txt", 100, 200);

    mockFs.unlinkSync("/virtual/cleanup-dir/sub/file.txt");
    expect(vfs.existsSync("/virtual/cleanup-dir/sub/file.txt")).toBe(false);

    mockFs.rmSync("/virtual/cleanup-dir", { recursive: true, force: true });
    expect(vfs.existsSync("/virtual/cleanup-dir")).toBe(false);
  });

  it("handles readFileSync and readdirSync option variations", () => {
    mockFs.mkdirSync("/virtual/rd-dir", { recursive: true });
    mockFs.writeFileSync("/virtual/rd-dir/hello.txt", "world");

    expect(mockFs.readFileSync("/virtual/rd-dir/hello.txt", "utf8")).toBe("world");
    expect(mockFs.readFileSync("/virtual/rd-dir/hello.txt", { encoding: "utf8" })).toBe("world");
    expect(Buffer.isBuffer(mockFs.readFileSync("/virtual/rd-dir/hello.txt"))).toBe(true);

    const entries = mockFs.readdirSync("/virtual/rd-dir", { withFileTypes: true });
    expect(entries.length).toBe(1);
    expect(entries[0]?.isFile()).toBe(true);
  });

  it("handles fs.readSync and fs.writeSync spies directly", () => {
    mockFs.writeFileSync("/virtual/direct-rw.txt", "abcdef");
    const fd = mockFs.openSync("/virtual/direct-rw.txt", "r+");
    const buf = Buffer.alloc(3);
    const readCount = mockFs.readSync(fd, buf, 0, 3, 0);
    expect(readCount).toBe(3);
    expect(buf.toString()).toBe("abc");

    const writeCount = mockFs.writeSync(fd, "XYZ", 0, 3, 0);
    expect(writeCount).toBe(3);
    expect(mockFs.readFileSync("/virtual/direct-rw.txt", "utf8")).toBe("XYZdef");
    mockFs.closeSync(fd);
  });

  it("handles appendFileSync, fsyncSync, and fdatasyncSync", () => {
    mockFs.appendFileSync("/virtual/append.txt", "first-");
    expect(vfs.readFileSync("/virtual/append.txt", "utf8")).toBe("first-");

    mockFs.appendFileSync("/virtual/append.txt", new TextEncoder().encode("second"));
    expect(vfs.readFileSync("/virtual/append.txt", "utf8")).toBe("first-second");

    expect(() => mockFs.fsyncSync(1)).not.toThrow();
    expect(() => mockFs.fdatasyncSync(1)).not.toThrow();
  });

  it("handles realpathSync resolving direct, nested symlinks, and fallback", () => {
    mockFs.mkdirSync("/virtual/real/target", { recursive: true });
    mockFs.writeFileSync("/virtual/real/target/file.txt", "data");
    mockFs.symlinkSync("/virtual/real/target", "/virtual/real/link-dir");

    expect(mockFs.realpathSync("/virtual/real/link-dir")).toBe("/virtual/real/target");
    expect(mockFs.realpathSync("/virtual/real/link-dir/file.txt")).toBe(
      "/virtual/real/target/file.txt",
    );
    expect(mockFs.realpathSync("/virtual/real/target")).toBe("/virtual/real/target");
    expect(mockFs.realpathSync(process.cwd())).toBe(process.cwd());

    expect(() => mockFs.realpathSync("/virtual/missing-path-12345")).toThrow();
  });

  it("handles fstatSync and closeSync on openDescriptors and unknown descriptors", () => {
    mockFs.writeFileSync("/virtual/fstat-test.txt", "sample");
    const fd = mockFs.openSync("/virtual/fstat-test.txt", "r");

    const st = mockFs.fstatSync(fd);
    expect(st.isFile()).toBe(true);
    expect(st.size).toBe(6);

    const stBig = mockFs.fstatSync(fd, { bigint: true });
    expect(typeof stBig.size).toBe("bigint");
    expect(stBig.size).toBe(6n);

    mockFs.closeSync(fd);
    expect(() => mockFs.closeSync(99999)).not.toThrow();
  });
});
