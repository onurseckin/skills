import { spyOn, type Mock } from "bun:test";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as platform from "../../platform/index.ts";
import { mockOpen, mockRead, mockWrite } from "./descriptors.ts";
import {
  isVirtualPath,
  makeFsStats,
  mockCp,
  mockExists,
  mockLstat,
  mockMkdir,
  mockOpendir,
  mockReadFile,
  mockReaddir,
  mockRename,
  mockStat,
  mockWriteFile,
  normPath,
  origClose,
  origFstat,
  origRealpath,
  type VirtualFSSpyState,
} from "./handlers.ts";
import type { VirtualMemoryFS } from "./memory-fs.ts";

export interface VirtualFSSession {
  vfs: VirtualMemoryFS;
  spies: Array<{ mockRestore: () => void }>;
  cleanup: () => void;
}

export function createVirtualFSSession(vfs: VirtualMemoryFS): VirtualFSSession {
  const state: VirtualFSSpyState = {
    vfs,
    customMtimes: new Map(),
    customModes: new Map(),
    symlinks: new Map(),
    openDescriptors: new Map(),
    inodeMap: new Map(),
    nextFd: { value: 3000 },
    nextIno: { value: 5000 },
  };

  const spy = <K extends keyof typeof fs>(k: K, fn: unknown) =>
    spyOn(fs, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  const fspSpy = <K extends keyof typeof fsp>(k: K, fn: unknown) =>
    spyOn(fsp, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  const spawnSpy = (fn: unknown) =>
    spyOn(childProcess, "spawnSync").mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  const spies: Array<{ mockRestore: () => void }> = [
    spy("existsSync", (p: fs.PathLike) => mockExists(state, p)),
    spy("mkdirSync", (p: fs.PathLike, opts?: fs.MakeDirectoryOptions | boolean) =>
      mockMkdir(state, p, opts),
    ),
    spy("mkdtempSync", (prefix: string) => {
      const dir = normPath(prefix + Math.random().toString(36).slice(2));
      vfs.mkdirSync(dir, { recursive: true });
      return dir;
    }),
    spy("writeFileSync", (p: fs.PathOrFileDescriptor, d: string | NodeJS.ArrayBufferView, opts?: fs.WriteFileOptions) =>
      mockWriteFile(state, p, d, opts),
    ),
    spy("readFileSync", (p: fs.PathOrFileDescriptor, opts?: { encoding?: BufferEncoding | null; flag?: string } | BufferEncoding | null) =>
      mockReadFile(state, p, opts),
    ),
    spy("readdirSync", (p: fs.PathLike, opts?: { withFileTypes?: boolean } | BufferEncoding | null) =>
      mockReaddir(state, p, opts),
    ),
    spy("opendirSync", (p: fs.PathLike, opts?: fs.OpenDirOptions) => mockOpendir(state, p, opts)),
    spy("statSync", (p: fs.PathLike) => mockStat(state, p)),
    spy("lstatSync", (p: fs.PathLike) => mockLstat(state, p)),
    spy("symlinkSync", (t: fs.PathLike, p: fs.PathLike) => {
      state.symlinks.set(normPath(String(p)), String(t));
    }),
    spy("readlinkSync", (p: fs.PathLike) => {
      const target = state.symlinks.get(normPath(String(p)));
      if (!target) throw new Error("ENOENT: no such file or directory");
      return target;
    }),
    spy("utimesSync", (p: fs.PathLike, _a: unknown, m: number | string | Date) => {
      state.customMtimes.set(
        normPath(String(p)),
        typeof m === "number" ? m : m instanceof Date ? m.getTime() : Date.now(),
      );
    }),
    spy("renameSync", (src: fs.PathLike, dst: fs.PathLike) => mockRename(state, src, dst)),
    spy("cpSync", (src: string | URL, dst: string | URL) => mockCp(state, src, dst)),
    spy("ftruncateSync", (fd: number, len?: number | null) => {
      const entry = state.openDescriptors.get(fd);
      if (!entry) return;
      const targetLen = typeof len === "number" ? len : 0;
      const data = vfs.existsSync(entry.path)
        ? Buffer.from(vfs.readFileSync(entry.path))
        : Buffer.alloc(0);
      vfs.writeFileSync(entry.path, data.subarray(0, targetLen));
      entry.position = Math.min(entry.position, targetLen);
    }),
    spy("chmodSync", (p: fs.PathLike, m: fs.Mode) => {
      state.customModes.set(normPath(String(p)), typeof m === "string" ? parseInt(m, 8) : m);
    }),
    spy("fchmodSync", (fd: number, m: fs.Mode) => {
      const entry = state.openDescriptors.get(fd);
      if (entry) {
        state.customModes.set(entry.path, typeof m === "string" ? parseInt(m, 8) : m);
      }
    }),
    spy("fchownSync", () => {}),
    spy("futimesSync", (fd: number, _a: unknown, m: number | string | Date) => {
      const entry = state.openDescriptors.get(fd);
      if (entry) {
        state.customMtimes.set(
          entry.path,
          typeof m === "number" ? m : m instanceof Date ? m.getTime() : Date.now(),
        );
      }
    }),
    spy("rmSync", (p: fs.PathLike, opts?: fs.RmOptions) =>
      vfs.rmSync(normPath(String(p)), opts as Parameters<typeof vfs.rmSync>[1]),
    ),
    spy("unlinkSync", (p: fs.PathLike) => vfs.unlinkSync(normPath(String(p)))),
    spy("openSync", (p: fs.PathLike, flags: string | number) => mockOpen(state, p, flags)),
    spy("closeSync", (fd: number) => {
      if (state.openDescriptors.has(fd)) {
        state.openDescriptors.delete(fd);
      } else {
        try {
          origClose(fd);
        } catch {}
      }
    }),
    spy("fstatSync", (fd: number) => {
      const entry = state.openDescriptors.get(fd);
      if (!entry) {
        return origFstat(fd);
      }
      const vs = vfs.statSync(entry.path, { throwIfNoEntry: false });
      return vs ? makeFsStats(state, vs, entry.path) : origFstat(fd);
    }),
    spy(
      "readSync",
      (
        fd: number,
        buf: NodeJS.ArrayBufferView,
        off: number,
        len: number,
        pos?: number | bigint | null,
      ) => mockRead(state, fd, buf, off, len, pos),
    ),
    spy(
      "writeSync",
      (
        fd: number,
        buf: NodeJS.ArrayBufferView | string,
        off?: number | null,
        len?: number | null,
        pos?: number | bigint | null,
      ) => mockWrite(state, fd, buf, off, len, pos),
    ),
    spy("appendFileSync", (p: fs.PathOrFileDescriptor, d: string | Uint8Array) => {
      const target = normPath(String(p));
      const prev = vfs.existsSync(target) ? vfs.readFileSync(target, "utf8") : "";
      vfs.writeFileSync(
        target,
        prev + (typeof d === "string" ? d : Buffer.from(d as Uint8Array).toString("utf8")),
      );
    }),
    spy("fsyncSync", () => {}),
    spy("realpathSync", (p: fs.PathLike) => {
      const s = String(p);
      const norm = normPath(s);
      return isVirtualPath(s) || vfs.existsSync(norm) || vfs.existsSync(s) ? norm : origRealpath(s);
    }),
    fspSpy("mkdtemp", async (prefix: string) => {
      const dir = normPath(prefix + Math.random().toString(36).slice(2));
      vfs.mkdirSync(dir, { recursive: true });
      return dir;
    }),
    fspSpy("mkdir", async (p: fs.PathLike, opts?: fs.MakeDirectoryOptions | boolean) =>
      mockMkdir(state, p, opts),
    ),
    fspSpy("writeFile", async (p: fs.PathOrFileDescriptor, d: string | NodeJS.ArrayBufferView, opts?: fs.WriteFileOptions) =>
      mockWriteFile(state, p, d, opts),
    ),
    fspSpy("readFile", async (p: fs.PathOrFileDescriptor, opts?: { encoding?: BufferEncoding | null; flag?: string } | BufferEncoding | null) =>
      mockReadFile(state, p, opts),
    ),
    fspSpy("readdir", async (p: fs.PathLike, opts?: { withFileTypes?: boolean } | BufferEncoding | null) =>
      mockReaddir(state, p, opts),
    ),
    fspSpy("stat", async (p: fs.PathLike) => mockStat(state, p)),
    fspSpy("lstat", async (p: fs.PathLike) => mockLstat(state, p)),
    fspSpy("rm", async (p: fs.PathLike, opts?: fs.RmOptions) =>
      vfs.rmSync(normPath(String(p)), opts as Parameters<typeof vfs.rmSync>[1]),
    ),
    fspSpy("unlink", async (p: fs.PathLike) => vfs.unlinkSync(normPath(String(p)))),
    fspSpy("realpath", async (p: fs.PathLike) => {
      const s = String(p);
      const norm = normPath(s);
      return isVirtualPath(s) || vfs.existsSync(norm) || vfs.existsSync(s) ? norm : origRealpath(s);
    }),
    fspSpy("cp", async (src: string | URL, dst: string | URL) => mockCp(state, src, dst)),
    fspSpy("rename", async (src: fs.PathLike, dst: fs.PathLike) => mockRename(state, src, dst)),
    fspSpy("chmod", async (p: fs.PathLike, m: fs.Mode) => {
      state.customModes.set(normPath(String(p)), typeof m === "string" ? parseInt(m, 8) : m);
    }),
    fspSpy("symlink", async (target: fs.PathLike, linkPath: fs.PathLike) => {
      state.symlinks.set(normPath(String(linkPath)), String(target));
    }),
    fspSpy("readlink", async (p: fs.PathLike) => {
      const target = state.symlinks.get(normPath(String(p)));
      if (!target) throw new Error("ENOENT: no such file or directory");
      return target;
    }),
    fspSpy("truncate", async (p: fs.PathLike, len = 0) => {
      const target = normPath(String(p));
      const content = vfs.existsSync(target) ? Buffer.from(vfs.readFileSync(target)) : Buffer.alloc(0);
      vfs.writeFileSync(target, content.subarray(0, typeof len === "number" ? len : 0));
    }),
    fspSpy("open", async (p: fs.PathLike, flags: string | number = "r", mode?: fs.Mode) => {
      const fd = mockOpen(state, p, flags);
      const target = normPath(String(p));
      if (typeof mode === "number") state.customModes.set(target, mode);
      return {
        fd,
        stat: async () => mockStat(state, p),
        read: async (buf: NodeJS.ArrayBufferView, off = 0, len = buf.byteLength, pos = null) => ({
          bytesRead: mockRead(state, fd, buf, off, len, pos),
          buffer: buf,
        }),
        write: async (buf: NodeJS.ArrayBufferView | string, off = 0, len = typeof buf === "string" ? Buffer.byteLength(buf) : buf.byteLength, pos = null) => ({
          bytesWritten: mockWrite(state, fd, buf, off, len, pos),
          buffer: buf as never,
        }),
        truncate: async (len = 0) => {
          const content = vfs.existsSync(target) ? Buffer.from(vfs.readFileSync(target)) : Buffer.alloc(0);
          vfs.writeFileSync(target, content.subarray(0, typeof len === "number" ? len : 0));
        },
        chmod: async (m: fs.Mode) => {
          state.customModes.set(target, typeof m === "string" ? parseInt(m, 8) : m);
        },
        sync: async () => {},
        datasync: async () => {},
        close: async () => {
          state.openDescriptors.delete(fd);
        },
      } as unknown as fsp.FileHandle;
    }),
    spyOn(platform, "tryExclusiveFlock").mockReturnValue(true) as never,
    spyOn(platform, "releaseFlock").mockImplementation(() => {}) as never,
    spawnSpy(() => ({
      status: 0,
      stdout: Buffer.from("main\n"),
      stderr: Buffer.from(""),
      output: [null, Buffer.from("main\n"), Buffer.from("")],
      pid: 1234,
      signal: null,
      error: undefined,
    })),
    spyOn(childProcess, "execFileSync").mockImplementation((() => Buffer.from("main\n")) as never),
    spyOn(childProcess, "execSync").mockImplementation((() => Buffer.from("main\n")) as never),
  ];

  function cleanup(): void {
    for (const s of spies) {
      try {
        s.mockRestore();
      } catch {}
    }
    state.openDescriptors.clear();
    state.customMtimes.clear();
    state.customModes.clear();
    state.symlinks.clear();
    state.inodeMap.clear();
    vfs.reset();
  }

  return { vfs, spies, cleanup };
}
