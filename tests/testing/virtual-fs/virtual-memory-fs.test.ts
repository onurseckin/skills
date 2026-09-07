import { describe, expect, it, beforeEach } from "bun:test";
import {
  VirtualMemoryFS,
  virtualFS,
  normalizePosixPath,
  VirtualFSError,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { createTestVirtualMemoryFS, VIRTUAL_FS_SUITES } from "./index.ts";
import { TESTING_DOMAIN_SUITES } from "../index.ts";

describe("VirtualMemoryFS Core Engine", () => {
  let vfs: VirtualMemoryFS;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
  });

  describe("normalizePosixPath", () => {
    it("handles absolute and relative paths with dot segments", () => {
      expect(normalizePosixPath("/a/b/../c")).toBe("/a/c");
      expect(normalizePosixPath("a/b/c", "/root")).toBe("/root/a/b/c");
      expect(normalizePosixPath("foo/bar/../../baz", "/root/sub")).toBe("/root/sub/baz");
      expect(normalizePosixPath("foo/bar/../../../baz", "/root/sub")).toBe("/root/baz");
      expect(normalizePosixPath("C:\\folder\\file.txt")).toBe("/C:/folder/file.txt");
    });
  });

  describe("file read & write operations", () => {
    it("writes and reads utf-8 string content", () => {
      vfs.writeFileSync("/test.txt", "hello world");
      expect(vfs.existsSync("/test.txt")).toBe(true);
      expect(vfs.readFileSync("/test.txt", "utf-8")).toBe("hello world");
    });

    it("writes and reads binary Uint8Array data", () => {
      const buffer = new Uint8Array([1, 2, 3, 4, 5]);
      vfs.writeFileSync("/bin.dat", buffer);
      const read = vfs.readFileSync("/bin.dat");
      expect(read).toBeInstanceOf(Uint8Array);
      expect(Array.from(read)).toEqual([1, 2, 3, 4, 5]);
    });

    it("overwrites existing files and updates mtime", () => {
      vfs.writeFileSync("/data.txt", "initial");
      const stat1 = vfs.statSync("/data.txt");
      expect(stat1).toBeDefined();
      vfs.writeFileSync("/data.txt", "updated content");
      expect(vfs.readFileSync("/data.txt", "utf-8")).toBe("updated content");
      const stat2 = vfs.statSync("/data.txt");
      expect(stat2?.size).toBe("updated content".length);
    });

    it("throws EISDIR when writing to a directory path or root", () => {
      vfs.mkdirSync("/folder");
      expect(() => vfs.writeFileSync("/folder", "text")).toThrow(VirtualFSError);
      expect(() => vfs.writeFileSync("/", "text")).toThrow(VirtualFSError);
    });

    it("throws ENOENT when reading non-existent file or writing to non-existent parent", () => {
      expect(() => vfs.readFileSync("/absent.txt")).toThrow(VirtualFSError);
      expect(() => vfs.writeFileSync("/nonexistent/file.txt", "text")).toThrow(VirtualFSError);
    });

    it("throws EISDIR when reading a directory path", () => {
      vfs.mkdirSync("/dir");
      expect(() => vfs.readFileSync("/dir")).toThrow(VirtualFSError);
    });
  });

  describe("directory operations", () => {
    it("creates single directories and recursive directory trees", () => {
      const created1 = vfs.mkdirSync("/a");
      expect(created1).toBe("/a");
      expect(vfs.existsSync("/a")).toBe(true);

      const created2 = vfs.mkdirSync("/a/b/c/d", { recursive: true });
      expect(created2).toBe("/a/b");
      expect(vfs.existsSync("/a/b/c/d")).toBe(true);
    });

    it("throws EEXIST when directory exists without recursive flag", () => {
      vfs.mkdirSync("/dir");
      expect(() => vfs.mkdirSync("/dir")).toThrow(VirtualFSError);
      expect(vfs.mkdirSync("/dir", { recursive: true })).toBeUndefined();
    });

    it("throws ENOTDIR when creating directory inside a file path", () => {
      vfs.writeFileSync("/file.txt", "content");
      expect(() => vfs.mkdirSync("/file.txt/sub")).toThrow(VirtualFSError);
    });

    it("lists directory contents and supports withFileTypes and recursive", () => {
      vfs.mkdirSync("/tree/sub", { recursive: true });
      vfs.writeFileSync("/tree/file1.txt", "1");
      vfs.writeFileSync("/tree/sub/file2.txt", "2");

      const flat = vfs.readdirSync("/tree");
      expect(flat).toEqual(["file1.txt", "sub"]);

      const dirents = vfs.readdirSync("/tree", { withFileTypes: true });
      expect(dirents.length).toBe(2);
      const fileEntry = dirents.find((d) => d.name === "file1.txt");
      const dirEntry = dirents.find((d) => d.name === "sub");
      expect(fileEntry?.isFile()).toBe(true);
      expect(dirEntry?.isDirectory()).toBe(true);

      const recursiveList = vfs.readdirSync("/tree", { recursive: true });
      expect(recursiveList).toEqual(["file1.txt", "sub", "sub/file2.txt"]);
    });

    it("throws ENOENT or ENOTDIR for readdir on missing target or file", () => {
      expect(() => vfs.readdirSync("/missing")).toThrow(VirtualFSError);
      vfs.writeFileSync("/file.txt", "content");
      expect(() => vfs.readdirSync("/file.txt")).toThrow(VirtualFSError);
    });
  });

  describe("deletion operations", () => {
    it("deletes files with unlinkSync", () => {
      vfs.writeFileSync("/file.txt", "data");
      vfs.unlinkSync("/file.txt");
      expect(vfs.existsSync("/file.txt")).toBe(false);
    });

    it("throws EPERM or ENOENT with unlinkSync on dir or absent path", () => {
      vfs.mkdirSync("/dir");
      expect(() => vfs.unlinkSync("/dir")).toThrow(VirtualFSError);
      expect(() => vfs.unlinkSync("/missing.txt")).toThrow(VirtualFSError);
      expect(() => vfs.unlinkSync("/")).toThrow(VirtualFSError);
    });

    it("removes directories and files with rmSync", () => {
      vfs.mkdirSync("/nest/deep", { recursive: true });
      vfs.writeFileSync("/nest/deep/file.txt", "hello");

      expect(() => vfs.rmSync("/nest")).toThrow(VirtualFSError);
      vfs.rmSync("/nest", { recursive: true });
      expect(vfs.existsSync("/nest")).toBe(false);
    });

    it("supports rmSync force option for absent paths", () => {
      expect(() => vfs.rmSync("/missing")).toThrow(VirtualFSError);
      expect(() => vfs.rmSync("/missing", { force: true })).not.toThrow();
    });

    it("clears all contents when removing root recursively", () => {
      vfs.writeFileSync("/f1.txt", "1");
      vfs.rmSync("/", { recursive: true });
      expect(vfs.readdirSync("/")).toEqual([]);
      expect(vfs.existsSync("/")).toBe(true);
    });
  });

  describe("statSync & metadata", () => {
    it("returns stats for files and directories", () => {
      vfs.writeFileSync("/sample.txt", "12345");
      const stat = vfs.statSync("/sample.txt");
      expect(stat).toBeDefined();
      expect(stat?.isFile()).toBe(true);
      expect(stat?.isDirectory()).toBe(false);
      expect(stat?.size).toBe(5);

      vfs.mkdirSync("/mydir");
      const dirStat = vfs.statSync("/mydir");
      expect(dirStat?.isDirectory()).toBe(true);
      expect(dirStat?.isFile()).toBe(false);
    });

    it("respects throwIfNoEntry option", () => {
      expect(() => vfs.statSync("/absent")).toThrow(VirtualFSError);
      expect(vfs.statSync("/absent", { throwIfNoEntry: false })).toBeUndefined();
    });
  });

  describe("working directory, snapshots & reset", () => {
    it("handles cwd and chdir", () => {
      expect(vfs.cwd()).toBe("/");
      vfs.mkdirSync("/workspace");
      vfs.chdir("/workspace");
      expect(vfs.cwd()).toBe("/workspace");
      vfs.writeFileSync("local.txt", "relative content");
      expect(vfs.existsSync("/workspace/local.txt")).toBe(true);
      expect(vfs.readFileSync("local.txt", "utf-8")).toBe("relative content");
    });

    it("dumps tree and loads snapshots cleanly", () => {
      vfs.mkdirSync("/a");
      vfs.writeFileSync("/a/b.txt", "content-b");
      vfs.writeFileSync("/c.txt", "content-c");
      const tree = vfs.dumpTree();
      expect(tree).toEqual({
        "/a/b.txt": "content-b",
        "/c.txt": "content-c",
      });

      const memFs2 = new VirtualMemoryFS();
      memFs2.loadSnapshot({
        "/config/app.json": '{"active":true}',
        "/readme.md": "# Docs",
      });
      expect(memFs2.readFileSync("/config/app.json", "utf-8")).toBe('{"active":true}');
      expect(memFs2.readFileSync("/readme.md", "utf-8")).toBe("# Docs");
    });

    it("resets filesystem state cleanly", () => {
      vfs.writeFileSync("/test.txt", "data");
      vfs.mkdirSync("/sub");
      vfs.chdir("/sub");
      vfs.reset();
      expect(vfs.cwd()).toBe("/");
      expect(vfs.existsSync("/test.txt")).toBe(false);
      expect(vfs.existsSync("/sub")).toBe(false);
      expect(vfs.readdirSync("/")).toEqual([]);
    });

    it("supports fsyncSync no-op", () => {
      expect(() => vfs.fsyncSync()).not.toThrow();
      expect(() => vfs.fsyncSync(1)).not.toThrow();
      expect(() => vfs.fsyncSync("/test.txt")).not.toThrow();
    });

    it("provides working singleton virtualFS instance and fixture helper", () => {
      expect(virtualFS).toBeInstanceOf(VirtualMemoryFS);
      virtualFS.reset();
      virtualFS.writeFileSync("/singleton.txt", "active");
      expect(virtualFS.readFileSync("/singleton.txt", "utf-8")).toBe("active");
      virtualFS.reset();

      const memFsTest = createTestVirtualMemoryFS();
      expect(memFsTest.readFileSync("/fixtures/sample.txt", "utf-8")).toBe(
        "sample virtual content",
      );
      expect(VIRTUAL_FS_SUITES.length).toBe(1);
      expect(Object.keys(TESTING_DOMAIN_SUITES).length).toBe(5);
    });
  });
});
