import { beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkRmPermissions,
  copyDirRecursive,
  getInode,
  isVirtualPath,
  makeFsStats,
  mockCp,
  mockExists,
  mockLink,
  mockLstat,
  mockMkdir,
  mockOpendir,
  mockReadFile,
  mockReaddir,
  mockRename,
  mockStat,
  mockWriteFile,
  normPath,
  type VirtualFSSpyState,
} from "../../olt/scripts/src/testing/virtual-fs/handlers.ts";
import { VirtualMemoryFS } from "../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";
import { VirtualStats } from "../../olt/scripts/src/testing/virtual-fs/types.ts";

describe("Virtual FS Handlers Comprehensive Suite", () => {
  let vfs: VirtualMemoryFS;
  let state: VirtualFSSpyState;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync("/virtual", { recursive: true });
    state = {
      vfs,
      customMtimes: new Map(),
      customModes: new Map(),
      symlinks: new Map(),
      hardlinks: new Map(),
      openDescriptors: new Map(),
      inodeMap: new Map(),
      nextFd: { value: 100 },
      nextIno: { value: 200 },
    };
  });

  it("normalizes macOS private paths and maps inodes with bigint stats", () => {
    expect(normPath("/private/var/tmp")).toBe("/var/tmp");
    expect(isVirtualPath("/virtual/test")).toBe(true);
    expect(isVirtualPath("/var/log/real")).toBe(false);

    const ino1 = getInode(state, "/virtual/file.txt");
    expect(getInode(state, "/virtual/file.txt")).toBe(ino1);
    expect(getInode(state, "/virtual/file2.txt")).toBeGreaterThan(ino1);

    const vs = new VirtualStats({ size: 100, isDir: false });
    state.hardlinks.set(ino1, 2);
    const s = makeFsStats(state, vs, "/virtual/file.txt", false, true);
    expect(typeof s.size).toBe("bigint");
    expect(s.nlink).toBe(2n);
    expect(s.isSocket()).toBe(false);
  });

  it("checks rm permissions and parent exec restrictions", () => {
    vfs.mkdirSync("/virtual/locked-dir", { recursive: true });
    vfs.writeFileSync("/virtual/locked-dir/c.txt", "data");
    state.customModes.set("/virtual/locked-dir", 0o555);
    expect(() => checkRmPermissions(state, "/virtual/locked-dir")).toThrow("EACCES");

    state.customModes.set("/virtual/ro.txt", 0o444);
    expect(() => checkRmPermissions(state, "/virtual/ro.txt")).toThrow("EACCES");
    expect(() => checkRmPermissions(state, "/virtual/ro.txt", { force: true })).not.toThrow();

    vfs.mkdirSync("/virtual/no-exec", { recursive: true });
    vfs.writeFileSync("/virtual/no-exec/f.txt", "x");
    state.customModes.set("/virtual/no-exec", 0o666);
    expect(() => mockStat(state, "/virtual/no-exec/f.txt")).toThrow("EACCES");
    expect(() => mockLstat(state, "/virtual/no-exec/f.txt")).toThrow("EACCES");
  });

  it("handles mkdir, writeFile, readFile descriptors and EISDIR", () => {
    mockMkdir(state, "/virtual/mode-dir", { mode: 0o700 });
    expect(state.customModes.get("/virtual/mode-dir")).toBe(0o700);

    state.customModes.set("/virtual/deny-p", 0o555);
    expect(() => mockWriteFile(state, "/virtual/deny-p/sub.txt", "x")).toThrow("EACCES");
    mockWriteFile(state, "/virtual/parent/child.txt", "hello", { mode: 0o600 });
    expect(state.customModes.get("/virtual/parent/child.txt")).toBe(0o600);

    vfs.mkdirSync("/virtual/dir", { recursive: true });
    expect(() => mockReadFile(state, "/virtual/dir")).toThrow("EISDIR");

    state.openDescriptors.set(99, { path: "/virtual/dir", position: 0 });
    expect(mockReadFile(state, 99)).toBe("");

    vfs.writeFileSync("/virtual/msg.txt", "content");
    state.openDescriptors.set(98, { path: "/virtual/msg.txt", position: 0 });
    expect(mockReadFile(state, 98, "utf8")).toBe("content");
    expect(Buffer.isBuffer(mockReadFile(state, 98))).toBe(true);

    expect(() => mockReadFile(state, 999)).toThrow("EBADF");
    expect(() => mockReadFile(state, "/virtual/missing.txt")).toThrow("ENOENT");
  });

  it("handles copyDirRecursive, mockRename, mockLink, and mockCp", () => {
    vfs.mkdirSync("/virtual/src/sub", { recursive: true });
    vfs.writeFileSync("/virtual/src/sub/a.txt", "data");
    state.customModes.set("/virtual/src/sub/a.txt", 0o755);
    copyDirRecursive(vfs, "/virtual/src", "/virtual/dst", state);
    expect(vfs.readFileSync("/virtual/dst/sub/a.txt", "utf8")).toBe("data");
    expect(state.customModes.get("/virtual/dst/sub/a.txt")).toBe(0o755);

    state.symlinks.set("/virtual/sym1", "/virtual/target");
    vfs.writeFileSync("/virtual/sym1", "target");
    mockRename(state, "/virtual/sym1", "/virtual/sym2");
    expect(state.symlinks.has("/virtual/sym2")).toBe(true);

    mockRename(state, "/virtual/dst", "/virtual/dst2");
    expect(vfs.existsSync("/virtual/dst")).toBe(false);
    expect(vfs.existsSync("/virtual/dst2/sub/a.txt")).toBe(true);

    mockLink(state, "/virtual/dst2/sub/a.txt", "/virtual/dst2/sub/hard.txt");
    expect(state.hardlinks.get(getInode(state, "/virtual/dst2/sub/a.txt"))).toBe(2);

    mockCp(state, "/virtual/dst2", "/virtual/cp-dir");
    expect(vfs.existsSync("/virtual/cp-dir/sub/a.txt")).toBe(true);
    mockCp(state, "/virtual/dst2/sub/a.txt", "/virtual/single-cp.txt");
    expect(vfs.readFileSync("/virtual/single-cp.txt", "utf8")).toBe("data");

    expect(() => mockRename(state, "/virtual/none", "/virtual/x")).toThrow("ENOENT");
    expect(() => mockLink(state, "/virtual/none", "/virtual/x")).toThrow("ENOENT");
    expect(() => mockCp(state, "/virtual/none", "/virtual/x")).toThrow("ENOENT");
  });

  it("handles stat, lstat, readdir and fallback to real fs", () => {
    vfs.writeFileSync("/virtual/orig.txt", "target-data");
    state.symlinks.set("/virtual/link.txt", "/virtual/orig.txt");

    expect(mockStat(state, "/virtual/link.txt").isFile()).toBe(true);
    expect(mockLstat(state, "/virtual/link.txt").isSymbolicLink()).toBe(true);

    const realFile = join(tmpdir(), `real-h-${Date.now()}.txt`);
    const realDir = join(tmpdir(), `real-d-${Date.now()}`);
    fs.writeFileSync(realFile, "real-data", "utf8");
    fs.mkdirSync(realDir, { recursive: true });
    try {
      expect(mockExists(state, realFile)).toBe(true);
      expect(mockExists(state, "/virtual/missing")).toBe(false);
      expect(String(mockReadFile(state, realFile, "utf8"))).toBe("real-data");
      expect(mockStat(state, realFile).isFile()).toBe(true);
      expect(mockLstat(state, realFile).isFile()).toBe(true);
      expect(mockReaddir(state, realDir)).toEqual([]);
      const dir = mockOpendir(state, realDir);
      expect(dir.readSync()).toBeNull();
      dir.closeSync();
    } finally {
      fs.rmSync(realFile, { force: true });
      fs.rmSync(realDir, { recursive: true, force: true });
    }

    expect(() => mockStat(state, "/virtual/missing.txt")).toThrow("ENOENT");
    expect(() => mockLstat(state, "/virtual/missing.txt")).toThrow("ENOENT");
    expect(() => mockReaddir(state, "/virtual/missing-dir")).toThrow("ENOENT");
  });

  it("supports mockOpendir iteration and Dirent types", async () => {
    vfs.mkdirSync("/virtual/iter-dir/sub", { recursive: true });
    vfs.writeFileSync("/virtual/iter-dir/file.txt", "iter");
    vfs.writeFileSync("/virtual/iter-dir/sym", "target");
    state.symlinks.set("/virtual/iter-dir/sym", "/virtual/iter-dir/file.txt");

    const dirBuf = mockOpendir(state, "/virtual/iter-dir", { encoding: "buffer" });
    const bufNames: string[] = [];
    for await (const d of dirBuf) {
      bufNames.push(Buffer.isBuffer(d.name) ? d.name.toString("utf8") : String(d.name));
      if (d.name.toString() === "file.txt") expect(d.isFile()).toBe(true);
      if (d.name.toString() === "sub") expect(d.isDirectory()).toBe(true);
      if (d.name.toString() === "sym") expect(d.isSymbolicLink()).toBe(true);
    }
    expect(bufNames).toContain("file.txt");
    expect(bufNames).toContain("sub");
    expect(bufNames).toContain("sym");

    const dirSync = mockOpendir(state, "/virtual/iter-dir");
    const syncNames: string[] = [];
    for (const d of dirSync) syncNames.push(String(d.name));
    expect(syncNames.length).toBe(3);

    const dirManual = mockOpendir(state, "/virtual/iter-dir");
    expect(await dirManual.read()).not.toBeNull();
    await dirManual.close();
    expect(dirManual.readSync()).toBeNull();

    expect(() => mockOpendir(state, "/virtual/missing-open")).toThrow("ENOENT");
  });
});
