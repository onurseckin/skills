import { describe, expect, it, beforeEach } from "bun:test";
import {
  VirtualMemoryFS,
  virtualFS,
  normalizePosixPath,
  VirtualFSError,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("VirtualMemoryFS Core Engine", () => {
  let fs: VirtualMemoryFS;

  beforeEach(() => {
    fs = new VirtualMemoryFS();
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
      fs.writeFileSync("/test.txt", "hello world");
      expect(fs.existsSync("/test.txt")).toBe(true);
      expect(fs.readFileSync("/test.txt", "utf-8")).toBe("hello world");
    });

    it("writes and reads binary Uint8Array data", () => {
      const buffer = new Uint8Array([1, 2, 3, 4, 5]);
      fs.writeFileSync("/bin.dat", buffer);
      const read = fs.readFileSync("/bin.dat");
      expect(read).toBeInstanceOf(Uint8Array);
      expect(Array.from(read)).toEqual([1, 2, 3, 4, 5]);
    });

    it("overwrites existing files and updates mtime", () => {
      fs.writeFileSync("/data.txt", "initial");
      const stat1 = fs.statSync("/data.txt");
      expect(stat1).toBeDefined();
      fs.writeFileSync("/data.txt", "updated content");
      expect(fs.readFileSync("/data.txt", "utf-8")).toBe("updated content");
      const stat2 = fs.statSync("/data.txt");
      expect(stat2?.size).toBe("updated content".length);
    });

    it("throws EISDIR when writing to a directory path or root", () => {
      fs.mkdirSync("/folder");
      expect(() => fs.writeFileSync("/folder", "text")).toThrow(VirtualFSError);
      expect(() => fs.writeFileSync("/", "text")).toThrow(VirtualFSError);
    });

    it("throws ENOENT when reading non-existent file or writing to non-existent parent", () => {
      expect(() => fs.readFileSync("/absent.txt")).toThrow(VirtualFSError);
      expect(() => fs.writeFileSync("/nonexistent/file.txt", "text")).toThrow(VirtualFSError);
    });

    it("throws EISDIR when reading a directory path", () => {
      fs.mkdirSync("/dir");
      expect(() => fs.readFileSync("/dir")).toThrow(VirtualFSError);
    });
  });

  describe("directory operations (mkdirSync & readdirSync)", () => {
    it("creates single directories and recursive directory trees", () => {
      const created1 = fs.mkdirSync("/a");
      expect(created1).toBe("/a");
      expect(fs.existsSync("/a")).toBe(true);

      const created2 = fs.mkdirSync("/a/b/c/d", { recursive: true });
      expect(created2).toBe("/a/b");
      expect(fs.existsSync("/a/b/c/d")).toBe(true);
    });

    it("throws EEXIST when directory exists without recursive flag", () => {
      fs.mkdirSync("/dir");
      expect(() => fs.mkdirSync("/dir")).toThrow(VirtualFSError);
      expect(fs.mkdirSync("/dir", { recursive: true })).toBeUndefined();
    });

    it("throws ENOTDIR when creating directory inside a file path", () => {
      fs.writeFileSync("/file.txt", "content");
      expect(() => fs.mkdirSync("/file.txt/sub")).toThrow(VirtualFSError);
    });

    it("lists directory contents and supports withFileTypes and recursive", () => {
      fs.mkdirSync("/tree/sub", { recursive: true });
      fs.writeFileSync("/tree/file1.txt", "1");
      fs.writeFileSync("/tree/sub/file2.txt", "2");

      const flat = fs.readdirSync("/tree");
      expect(flat).toEqual(["file1.txt", "sub"]);

      const dirents = fs.readdirSync("/tree", { withFileTypes: true });
      expect(dirents.length).toBe(2);
      const fileEntry = dirents.find((d) => d.name === "file1.txt");
      const dirEntry = dirents.find((d) => d.name === "sub");
      expect(fileEntry?.isFile()).toBe(true);
      expect(dirEntry?.isDirectory()).toBe(true);

      const recursiveList = fs.readdirSync("/tree", { recursive: true });
      expect(recursiveList).toEqual(["file1.txt", "sub", "sub/file2.txt"]);
    });

    it("throws ENOENT or ENOTDIR for readdir on missing target or file", () => {
      expect(() => fs.readdirSync("/missing")).toThrow(VirtualFSError);
      fs.writeFileSync("/file.txt", "content");
      expect(() => fs.readdirSync("/file.txt")).toThrow(VirtualFSError);
    });
  });

  describe("deletion operations (unlinkSync & rmSync)", () => {
    it("deletes files with unlinkSync", () => {
      fs.writeFileSync("/file.txt", "data");
      fs.unlinkSync("/file.txt");
      expect(fs.existsSync("/file.txt")).toBe(false);
    });

    it("throws EPERM or ENOENT with unlinkSync on dir or absent path", () => {
      fs.mkdirSync("/dir");
      expect(() => fs.unlinkSync("/dir")).toThrow(VirtualFSError);
      expect(() => fs.unlinkSync("/missing.txt")).toThrow(VirtualFSError);
      expect(() => fs.unlinkSync("/")).toThrow(VirtualFSError);
    });

    it("removes directories and files with rmSync", () => {
      fs.mkdirSync("/nest/deep", { recursive: true });
      fs.writeFileSync("/nest/deep/file.txt", "hello");

      expect(() => fs.rmSync("/nest")).toThrow(VirtualFSError); // EISDIR without recursive
      fs.rmSync("/nest", { recursive: true });
      expect(fs.existsSync("/nest")).toBe(false);
    });

    it("supports rmSync force option for absent paths", () => {
      expect(() => fs.rmSync("/missing")).toThrow(VirtualFSError);
      expect(() => fs.rmSync("/missing", { force: true })).not.toThrow();
    });

    it("clears all contents when removing root recursively", () => {
      fs.writeFileSync("/f1.txt", "1");
      fs.rmSync("/", { recursive: true });
      expect(fs.readdirSync("/")).toEqual([]);
      expect(fs.existsSync("/")).toBe(true);
    });
  });

  describe("statSync & metadata", () => {
    it("returns stats for files and directories", () => {
      fs.writeFileSync("/sample.txt", "12345");
      const stat = fs.statSync("/sample.txt");
      expect(stat).toBeDefined();
      expect(stat?.isFile()).toBe(true);
      expect(stat?.isDirectory()).toBe(false);
      expect(stat?.size).toBe(5);

      fs.mkdirSync("/mydir");
      const dirStat = fs.statSync("/mydir");
      expect(dirStat?.isDirectory()).toBe(true);
      expect(dirStat?.isFile()).toBe(false);
    });

    it("respects throwIfNoEntry option", () => {
      expect(() => fs.statSync("/absent")).toThrow(VirtualFSError);
      expect(fs.statSync("/absent", { throwIfNoEntry: false })).toBeUndefined();
    });
  });

  describe("working directory, snapshots & reset", () => {
    it("handles cwd and chdir", () => {
      expect(fs.cwd()).toBe("/");
      fs.mkdirSync("/workspace");
      fs.chdir("/workspace");
      expect(fs.cwd()).toBe("/workspace");
      fs.writeFileSync("local.txt", "relative content");
      expect(fs.existsSync("/workspace/local.txt")).toBe(true);
      expect(fs.readFileSync("local.txt", "utf-8")).toBe("relative content");
    });

    it("dumps tree and loads snapshots cleanly", () => {
      fs.mkdirSync("/a");
      fs.writeFileSync("/a/b.txt", "content-b");
      fs.writeFileSync("/c.txt", "content-c");
      const tree = fs.dumpTree();
      expect(tree).toEqual({
        "/a/b.txt": "content-b",
        "/c.txt": "content-c",
      });

      const fs2 = new VirtualMemoryFS();
      fs2.loadSnapshot({
        "/config/app.json": '{"active":true}',
        "/readme.md": "# Docs",
      });
      expect(fs2.readFileSync("/config/app.json", "utf-8")).toBe('{"active":true}');
      expect(fs2.readFileSync("/readme.md", "utf-8")).toBe("# Docs");
    });

    it("resets filesystem state cleanly", () => {
      fs.writeFileSync("/test.txt", "data");
      fs.mkdirSync("/sub");
      fs.chdir("/sub");
      fs.reset();
      expect(fs.cwd()).toBe("/");
      expect(fs.existsSync("/test.txt")).toBe(false);
      expect(fs.existsSync("/sub")).toBe(false);
      expect(fs.readdirSync("/")).toEqual([]);
    });

    it("supports fsyncSync no-op", () => {
      expect(() => fs.fsyncSync()).not.toThrow();
      expect(() => fs.fsyncSync(1)).not.toThrow();
      expect(() => fs.fsyncSync("/test.txt")).not.toThrow();
    });

    it("provides working singleton virtualFS instance", () => {
      expect(virtualFS).toBeInstanceOf(VirtualMemoryFS);
      virtualFS.reset();
      virtualFS.writeFileSync("/singleton.txt", "active");
      expect(virtualFS.readFileSync("/singleton.txt", "utf-8")).toBe("active");
      virtualFS.reset();
    });
  });
});
