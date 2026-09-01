import { spyOn, type Mock } from "bun:test";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as platform from "../../platform/index.ts";
import { mockOpen, mockRead, mockWrite } from "./descriptors.ts";
import {
  isVirtualPath,
  makeFsStats,
  mockCp,
  mockExists,
  mockLstat,
  mockMkdir,
  mockReadFile,
  mockReaddir,
  mockRename,
  mockStat,
  mockWriteFile,
  normPath,
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

  const spawnSpy = (fn: unknown) =>
    spyOn(childProcess, "spawnSync").mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  const spies: Array<{ mockRestore: () => void }> = [
    spy("existsSync", (p: fs.PathLike) => mockExists(state, p)),
    spy("mkdirSync", (p: fs.PathLike, opts?: fs.MakeDirectoryOptions | boolean) =>
      mockMkdir(state, p, opts),
    ),
    spy(
      "writeFileSync",
      (
        p: fs.PathOrFileDescriptor,
        d: string | NodeJS.ArrayBufferView,
        opts?: fs.WriteFileOptions,
      ) => mockWriteFile(state, p, d, opts),
    ),
    spy(
      "readFileSync",
      (
        p: fs.PathOrFileDescriptor,
        opts?: { encoding?: BufferEncoding | null; flag?: string } | BufferEncoding | null,
      ) => mockReadFile(state, p, opts),
    ),
    spy(
      "readdirSync",
      (p: fs.PathLike, opts?: { withFileTypes?: boolean } | BufferEncoding | null) =>
        mockReaddir(state, p, opts),
    ),
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
      state.openDescriptors.delete(fd);
    }),
    spy("fstatSync", (fd: number) => {
      const entry = state.openDescriptors.get(fd);
      const target = entry?.path ?? "/virtual";
      const vs = vfs.statSync(target, { throwIfNoEntry: false });
      return vs ? makeFsStats(state, vs, target) : (fs.statSync(target) as fs.Stats);
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
