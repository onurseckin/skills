import { describe, expect, it } from "bun:test";
import {
  ChatVirtualFS,
  normalizePosixPath,
  VirtualDirent,
  VirtualFSError,
  VirtualStats,
} from "../../src/testing/virtual-fs/index.ts";

describe("ChatVirtualFS", () => {
  it("normalizes posix paths correctly", () => {
    expect(normalizePosixPath("a/b/../c")).toBe("/a/c");
    expect(normalizePosixPath("/foo/bar/./baz")).toBe("/foo/bar/baz");
    expect(normalizePosixPath("../sibling", "/root/sub")).toBe("/root/sibling");
  });

  it("handles basic file lifecycle in memory", () => {
    const vfs = new ChatVirtualFS(1000);
    expect(vfs.existsSync("/test.txt")).toBe(false);

    vfs.writeFileSync("/test.txt", "hello world");
    expect(vfs.existsSync("/test.txt")).toBe(true);
    expect(vfs.readFileSync("/test.txt", "utf-8")).toBe("hello world");

    vfs.appendFileSync("/test.txt", "!");
    expect(vfs.readFileSync("/test.txt", "utf-8")).toBe("hello world!");

    const stat = vfs.statSync("/test.txt");
    expect(stat).toBeDefined();
    expect(stat?.isFile()).toBe(true);
    expect(stat?.isDirectory()).toBe(false);
    expect(stat?.size).toBe(12);

    vfs.unlinkSync("/test.txt");
    expect(vfs.existsSync("/test.txt")).toBe(false);
  });

  it("handles directories and recursive creation", () => {
    const vfs = new ChatVirtualFS();
    vfs.mkdirSync("/a/b/c", { recursive: true });
    expect(vfs.existsSync("/a/b/c")).toBe(true);

    vfs.writeFileSync("/a/b/c/file1.txt", "one");
    vfs.writeFileSync("/a/b/c/file2.txt", "two");

    const entries = vfs.readdirSync("/a/b/c");
    expect(entries).toEqual(["file1.txt", "file2.txt"]);

    const withTypes = vfs.readdirSync("/a/b/c", { withFileTypes: true });
    expect(withTypes.length).toBe(2);
    expect(withTypes[0]?.isFile()).toBe(true);
  });

  it("advances synthetic clock deterministically", () => {
    const vfs = new ChatVirtualFS(100000);
    expect(vfs.now()).toBe(100000);

    vfs.advanceTime(5000);
    expect(vfs.now()).toBe(105000);
    expect(vfs.iso()).toBe(new Date(105000).toISOString());

    vfs.writeFileSync("/clocked.txt", "time test");
    const stat = vfs.statSync("/clocked.txt");
    expect(stat?.mtimeMs).toBe(105000);
  });

  it("manages synthetic PID table", () => {
    const vfs = new ChatVirtualFS();
    const pid = vfs.spawnProcess({ cmd: "daemon" });
    expect(vfs.isProcessAlive(pid)).toBe(true);

    vfs.killProcess(pid);
    expect(vfs.isProcessAlive(pid)).toBe(false);
  });

  it("emits events to watchers on modifications", () => {
    const vfs = new ChatVirtualFS();
    vfs.mkdirSync("/watched", { recursive: true });
    const events: string[] = [];

    const watcher = vfs.watch("/watched", (_event, filename) => {
      if (filename) {
        events.push(filename);
      }
    });

    vfs.writeFileSync("/watched/a.txt", "hello");
    expect(events).toContain("a.txt");

    watcher.close();
  });

  it("supports snapshot dump and load", () => {
    const vfs = new ChatVirtualFS();
    vfs.mkdirSync("/dir", { recursive: true });
    vfs.writeFileSync("/dir/test.txt", "snapshot content");

    const snapshot = vfs.dumpTree();
    expect(snapshot["/dir/test.txt"]).toBe("snapshot content");

    const vfs2 = new ChatVirtualFS();
    vfs2.loadSnapshot(snapshot);
    expect(vfs2.readFileSync("/dir/test.txt", "utf-8")).toBe("snapshot content");
  });

  it("throws expected POSIX errors", () => {
    const vfs = new ChatVirtualFS();
    expect(() => vfs.readFileSync("/nonexistent")).toThrow(VirtualFSError);
    expect(() => vfs.chdir("/missing")).toThrow(VirtualFSError);
  });
});
