import { describe, expect, it } from "bun:test";
import {
  VirtualDirent,
  VirtualFSError,
  VirtualStats,
} from "../../../olt/scripts/src/testing/virtual-fs/types.ts";

describe("Virtual FS Types - VirtualStats", () => {
  it("creates default file stats with fallback timestamps and permissions", () => {
    const before = Date.now();
    const stats = new VirtualStats();
    const after = Date.now();

    expect(stats.size).toBe(0);
    expect(stats.mode).toBe(0o644);
    expect(stats.isFile()).toBe(true);
    expect(stats.isDirectory()).toBe(false);
    expect(stats.isSymbolicLink()).toBe(false);
    expect(stats.isBlockDevice()).toBe(false);
    expect(stats.isCharacterDevice()).toBe(false);
    expect(stats.isFIFO()).toBe(false);
    expect(stats.isSocket()).toBe(false);
    expect(stats.atimeMs).toBeGreaterThanOrEqual(before);
    expect(stats.atimeMs).toBeLessThanOrEqual(after);
    expect(stats.atime.getTime()).toBe(stats.atimeMs);
    expect(stats.mtime.getTime()).toBe(stats.mtimeMs);
    expect(stats.ctime.getTime()).toBe(stats.ctimeMs);
    expect(stats.birthtime.getTime()).toBe(stats.birthtimeMs);
  });

  it("creates directory stats with default directory permissions 0o755", () => {
    const dirStats = new VirtualStats({ isDir: true });
    expect(dirStats.mode).toBe(0o755);
    expect(dirStats.isDirectory()).toBe(true);
    expect(dirStats.isFile()).toBe(false);
  });

  it("accepts custom properties and clones with partial overrides", () => {
    const custom = new VirtualStats({
      size: 1024,
      mode: 0o777,
      atimeMs: 1000,
      mtimeMs: 2000,
      ctimeMs: 3000,
      birthtimeMs: 4000,
      isDir: false,
    });
    expect(custom.size).toBe(1024);
    expect(custom.mode).toBe(0o777);
    expect(custom.atimeMs).toBe(1000);
    expect(custom.mtimeMs).toBe(2000);
    expect(custom.ctimeMs).toBe(3000);
    expect(custom.birthtimeMs).toBe(4000);

    const cloned = custom.clone();
    expect(cloned.size).toBe(1024);
    expect(cloned.mode).toBe(0o777);
    expect(cloned.mtimeMs).toBe(2000);

    const updated = custom.clone({
      size: 2048,
      mode: 0o700,
      atimeMs: 5000,
      mtimeMs: 6000,
      ctimeMs: 7000,
      birthtimeMs: 8000,
      isDir: true,
    });
    expect(updated.size).toBe(2048);
    expect(updated.mode).toBe(0o700);
    expect(updated.atimeMs).toBe(5000);
    expect(updated.mtimeMs).toBe(6000);
    expect(updated.ctimeMs).toBe(7000);
    expect(updated.birthtimeMs).toBe(8000);
    expect(updated.isDirectory()).toBe(true);
  });
});

describe("Virtual FS Types - VirtualDirent", () => {
  it("initializes file dirent correctly", () => {
    const dirent = new VirtualDirent("file.txt", "file", "/root/folder");
    expect(dirent.name).toBe("file.txt");
    expect(dirent.parentPath).toBe("/root/folder");
    expect(dirent.isFile()).toBe(true);
    expect(dirent.isDirectory()).toBe(false);
    expect(dirent.isSymbolicLink()).toBe(false);
    expect(dirent.isBlockDevice()).toBe(false);
    expect(dirent.isCharacterDevice()).toBe(false);
    expect(dirent.isFIFO()).toBe(false);
    expect(dirent.isSocket()).toBe(false);
  });

  it("initializes directory dirent correctly", () => {
    const dirent = new VirtualDirent("subdir", "dir", "/root");
    expect(dirent.name).toBe("subdir");
    expect(dirent.parentPath).toBe("/root");
    expect(dirent.isFile()).toBe(false);
    expect(dirent.isDirectory()).toBe(true);
    expect(dirent.isSymbolicLink()).toBe(false);
  });
});

describe("Virtual FS Types - VirtualFSError", () => {
  it("creates custom error instance and sets prototype", () => {
    const err = new VirtualFSError("ECUSTOM", "Custom error", "/path/test", "customOp");
    expect(err).toBeInstanceOf(VirtualFSError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("VirtualFSError");
    expect(err.code).toBe("ECUSTOM");
    expect(err.message).toBe("Custom error");
    expect(err.path).toBe("/path/test");
    expect(err.syscall).toBe("customOp");

    const errNoOpts = new VirtualFSError("ENOOPTS", "No opts");
    expect(errNoOpts.path).toBeUndefined();
    expect(errNoOpts.syscall).toBeUndefined();
  });

  it("creates standard ENOENT errors with default and custom syscall", () => {
    const errDefault = VirtualFSError.enoent("/virtual/file.txt");
    expect(errDefault.code).toBe("ENOENT");
    expect(errDefault.syscall).toBe("open");
    expect(errDefault.path).toBe("/virtual/file.txt");
    expect(errDefault.message).toContain(
      "ENOENT: no such file or directory, open '/virtual/file.txt'",
    );

    const errCustom = VirtualFSError.enoent("/virtual/other.txt", "stat");
    expect(errCustom.syscall).toBe("stat");
    expect(errCustom.message).toContain("stat '/virtual/other.txt'");
  });

  it("creates standard EISDIR errors with default and custom syscall", () => {
    const errDefault = VirtualFSError.eisdir("/virtual/dir");
    expect(errDefault.code).toBe("EISDIR");
    expect(errDefault.syscall).toBe("read");
    expect(errDefault.message).toContain(
      "EISDIR: illegal operation on a directory, read '/virtual/dir'",
    );

    const errCustom = VirtualFSError.eisdir("/virtual/dir2", "write");
    expect(errCustom.syscall).toBe("write");
  });

  it("creates standard ENOTDIR errors with default and custom syscall", () => {
    const errDefault = VirtualFSError.enotdir("/virtual/file");
    expect(errDefault.code).toBe("ENOTDIR");
    expect(errDefault.syscall).toBe("scandir");
    expect(errDefault.message).toContain("ENOTDIR: not a directory, scandir '/virtual/file'");

    const errCustom = VirtualFSError.enotdir("/virtual/file2", "opendir");
    expect(errCustom.syscall).toBe("opendir");
  });

  it("creates standard EEXIST errors with default and custom syscall", () => {
    const errDefault = VirtualFSError.eexist("/virtual/dir");
    expect(errDefault.code).toBe("EEXIST");
    expect(errDefault.syscall).toBe("mkdir");
    expect(errDefault.message).toContain("EEXIST: file already exists, mkdir '/virtual/dir'");

    const errCustom = VirtualFSError.eexist("/virtual/dir2", "symlink");
    expect(errCustom.syscall).toBe("symlink");
  });

  it("creates standard EPERM errors with default and custom syscall", () => {
    const errDefault = VirtualFSError.eperm("/virtual/locked");
    expect(errDefault.code).toBe("EPERM");
    expect(errDefault.syscall).toBe("unlink");
    expect(errDefault.message).toContain(
      "EPERM: operation not permitted, unlink '/virtual/locked'",
    );

    const errCustom = VirtualFSError.eperm("/virtual/locked2", "rmdir");
    expect(errCustom.syscall).toBe("rmdir");
  });
});
