import { beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mockOpen,
  mockRead,
  mockSpawnSync,
  mockWrite,
} from "../../../olt/scripts/src/testing/virtual-fs/descriptors.ts";
import type { VirtualFSSpyState } from "../../../olt/scripts/src/testing/virtual-fs/handlers.ts";
import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";

describe("Virtual FS Descriptors & Mock Spawn Engine", () => {
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
      nextFd: { value: 3000 },
      nextIno: { value: 5000 },
    };
  });

  describe("mockOpen", () => {
    it("throws ELOOP with O_NOFOLLOW on symlink", () => {
      state.symlinks.set("/virtual/link.txt", "/virtual/target.txt");
      expect(() => mockOpen(state, "/virtual/link.txt", fs.constants.O_NOFOLLOW)).toThrow("ELOOP");
    });

    it("throws EISDIR when opening directory for writing", () => {
      vfs.mkdirSync("/virtual/dir", { recursive: true });
      expect(() => mockOpen(state, "/virtual/dir", "w")).toThrow("EISDIR");
    });

    it("throws EACCES on read/write when permissions are denied", () => {
      vfs.writeFileSync("/virtual/no-read.txt", "secret");
      state.customModes.set("/virtual/no-read.txt", 0o000);
      expect(() => mockOpen(state, "/virtual/no-read.txt", "r")).toThrow("EACCES");

      vfs.mkdirSync("/virtual/no-write-dir", { recursive: true });
      state.customModes.set("/virtual/no-write-dir", 0o555);
      expect(() => mockOpen(state, "/virtual/no-write-dir/new.txt", "w")).toThrow("EACCES");
    });

    it("opens in append mode initializing position to file length", () => {
      vfs.writeFileSync("/virtual/app.txt", "12345");
      const fd = mockOpen(state, "/virtual/app.txt", "a");
      const entry = state.openDescriptors.get(fd);
      expect(entry?.position).toBe(5);
    });

    it("falls back to origOpenSync when reading non-virtual existing file", () => {
      const realPath = join(tmpdir(), `real-test-${Date.now()}.txt`);
      fs.writeFileSync(realPath, "real content", "utf8");
      try {
        const fd = mockOpen(state, realPath, "r");
        expect(typeof fd).toBe("number");
        fs.closeSync(fd);
      } finally {
        fs.rmSync(realPath, { force: true });
      }
    });
  });

  describe("mockRead & mockWrite", () => {
    it("reads and writes using ArrayBufferView and Buffer views", () => {
      vfs.writeFileSync("/virtual/rw.txt", "initial-data");
      const fd = mockOpen(state, "/virtual/rw.txt", "r+");

      const u8 = new Uint8Array(7);
      const bytesRead = mockRead(state, fd, u8, 0, 7, 0);
      expect(bytesRead).toBe(7);
      expect(new TextDecoder().decode(u8)).toBe("initial");

      const rawU8 = new Uint8Array([79, 86, 69, 82]); // "OVER"
      const writeU8Count = mockWrite(state, fd, rawU8, 0, 4, 0);
      expect(writeU8Count).toBe(4);

      const writeBytes = mockWrite(state, fd, "OVERWRITE", 0, 9, 0);
      expect(writeBytes).toBe(9);
      expect(vfs.readFileSync("/virtual/rw.txt", "utf8")).toBe("OVERWRITEata");
    });

    it("throws EISDIR when reading a directory descriptor", () => {
      vfs.mkdirSync("/virtual/dir-fd", { recursive: true });
      state.openDescriptors.set(4001, { path: "/virtual/dir-fd", position: 0 });
      const buf = Buffer.alloc(10);
      expect(() => mockRead(state, 4001, buf, 0, 10)).toThrow("EISDIR");
    });

    it("expands buffer when writing past current file length", () => {
      vfs.writeFileSync("/virtual/sparse.txt", "abc");
      const fd = mockOpen(state, "/virtual/sparse.txt", "r+");
      mockWrite(state, fd, "XYZ", 0, 3, 6);
      const res = vfs.readFileSync("/virtual/sparse.txt");
      expect(res.length).toBe(9);
    });

    it("falls back to origReadSync and origWriteSync on unmanaged descriptors", () => {
      const realPath = join(tmpdir(), `real-rw-${Date.now()}.txt`);
      fs.writeFileSync(realPath, "fallback-data", "utf8");
      const fd = fs.openSync(realPath, "r+");
      try {
        const buf = Buffer.alloc(8);
        const r = mockRead(state, fd, buf, 0, 8, 0);
        expect(r).toBe(8);

        const wBuf = mockWrite(state, fd, Buffer.from("MOD"), 0, 3, 0);
        expect(wBuf).toBe(3);
        const ws = mockWrite(state, fd, "STR");
        expect(ws).toBe(3);
      } finally {
        fs.closeSync(fd);
        fs.rmSync(realPath, { force: true });
      }
    });
  });

  describe("mockSpawnSync - tar", () => {
    it("extracts tar archive to target and normalizes dirty SKILL.md", () => {
      vfs.mkdirSync("/virtual/repo/olt", { recursive: true });
      vfs.writeFileSync("/virtual/repo/olt/SKILL.md", "dirty\n");
      const res = mockSpawnSync(state, "tar", ["-xf", "archive.tar", "-C", "/virtual/extract"], {
        cwd: "/virtual/repo",
      });
      expect(res.status).toBe(0);
      expect(vfs.readFileSync("/virtual/extract/olt/SKILL.md", "utf8")).toBe("canonical-skill\n");
    });

    it("creates default SKILL.md if source olt directory does not exist", () => {
      const res = mockSpawnSync(
        state,
        "tar",
        ["-xf", "archive.tar", "-C", "/virtual/extract-fresh"],
        { cwd: "/virtual/empty-repo" },
      );
      expect(res.status).toBe(0);
      expect(vfs.readFileSync("/virtual/extract-fresh/olt/SKILL.md", "utf8")).toBe(
        "canonical-skill\n",
      );
    });
  });

  describe("mockSpawnSync - git", () => {
    it("handles git init and diff failure on missing file or --no-index", () => {
      const res = mockSpawnSync(state, "git", ["init"], { cwd: "/virtual/my-repo" });
      expect(res.status).toBe(0);
      expect(vfs.existsSync("/virtual/my-repo/.git")).toBe(true);

      const resDiff = mockSpawnSync(state, "git", ["diff", "--no-index", "a", "b"], {
        cwd: "/virtual/my-repo",
      });
      expect(resDiff.status).toBe(2);
      expect(String(resDiff.stderr)).toContain("fatal: No such file or directory");
    });

    it("returns status 128 when cwd is not a git repository", () => {
      const res = mockSpawnSync(state, "git", ["status"], {
        cwd: "/virtual/not-git",
        encoding: "utf8",
      });
      expect(res.status).toBe(128);
      expect(String(res.stderr)).toContain("fatal: not a git repository");
    });

    it("handles git inspection flags and worktree detection", () => {
      vfs.mkdirSync("/virtual/my-repo/.git", { recursive: true });
      const cwd = "/virtual/my-repo";

      expect(mockSpawnSync(state, "git", ["config", "--get-regexp"], { cwd }).status).toBe(1);
      expect(
        mockSpawnSync(state, "git", ["rev-parse", "--is-inside-work-tree"], {
          cwd,
          encoding: "utf8",
        }).stdout,
      ).toBe("true\n");
      expect(
        mockSpawnSync(state, "git", ["rev-parse", "--absolute-git-dir"], { cwd, encoding: "utf8" })
          .stdout,
      ).toBe(`${cwd}/.git\n`);
      expect(
        mockSpawnSync(state, "git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" })
          .stdout,
      ).toBe(`${cwd}\n`);
      expect(
        mockSpawnSync(state, "git", ["config", "config.worktree"], { cwd, encoding: "utf8" })
          .stdout,
      ).toBe(`${cwd}/.git/config.worktree\n`);
      expect(mockSpawnSync(state, "git", ["archive"], { cwd, encoding: "utf8" }).stdout).toBe(
        "mock-archive\n",
      );
      expect(
        mockSpawnSync(state, "git", ["ls-files", "-z"], { cwd, encoding: "utf8" }).stdout,
      ).toBe("");
    });

    it("detects dirty porcelain status for untracked, renamed, and modified SKILL.md", () => {
      const cwd = "/virtual/porcelain-repo";
      vfs.mkdirSync(`${cwd}/.git`, { recursive: true });
      vfs.mkdirSync(`${cwd}/olt`, { recursive: true });
      vfs.writeFileSync(`${cwd}/olt/untracked.ts`, "export const x = 1;");
      vfs.writeFileSync(`${cwd}/olt/harness-renamed.ts`, "export const renamed = true;");
      vfs.writeFileSync(`${cwd}/olt/SKILL.md`, "modified skill content");

      const res = mockSpawnSync(state, "git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("?? olt/untracked.ts");
      expect(res.stdout).toContain(" D olt/harness.ts");
      expect(res.stdout).toContain("?? olt/harness-renamed.ts");
      expect(res.stdout).toContain(" M olt/SKILL.md");
    });
  });
});
