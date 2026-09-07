import { spyOn, type Mock } from "bun:test";
import { Buffer } from "node:buffer";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  checkRmPermissions,
  forgetInode,
  isVirtualPath,
  makeFsStats,
  mockCp,
  mockExists,
  mockLink,
  mockLstat,
  mockMkdir,
  mockOpen,
  mockOpendir,
  mockRead,
  mockReadFile,
  mockReaddir,
  mockRename,
  mockStat,
  mockWrite,
  mockWriteFile,
  normPath,
  origClose,
  origFstat,
  origRead,
  origRealpath,
  type VirtualFSSpyState,
} from "../core/index.ts";
import type { VirtualMemoryFS } from "../memory/index.ts";

export function buildSyncSpies(
  state: VirtualFSSpyState,
  vfs: VirtualMemoryFS,
): Array<{ mockRestore: () => void }> {
  const spy = <K extends keyof typeof fs>(k: K, fn: unknown) =>
    spyOn(fs, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  return [
    spy("existsSync", (p: fs.PathLike) => mockExists(state, p)),
    spy("mkdirSync", (p: fs.PathLike, opts?: fs.MakeDirectoryOptions | boolean) =>
      mockMkdir(state, p, opts),
    ),
    spy("mkdtempSync", (prefix: string) => {
      const dir = normPath(prefix + Math.random().toString(36).slice(2));
      vfs.mkdirSync(dir, { recursive: true });
      return dir;
    }),
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
    spy("opendirSync", (p: fs.PathLike, opts?: fs.OpenDirOptions) => mockOpendir(state, p, opts)),
    spy("statSync", (p: fs.PathLike, opts?: fs.StatOptions) => mockStat(state, p, opts)),
    spy("lstatSync", (p: fs.PathLike, opts?: fs.StatOptions) => mockLstat(state, p, opts)),
    spy("symlinkSync", (t: fs.PathLike, p: fs.PathLike) => {
      const np = normPath(String(p));
      state.symlinks.set(np, String(t));
      const parent = path.dirname(np);
      if (!vfs.existsSync(parent)) vfs.mkdirSync(parent, { recursive: true });
      if (!vfs.existsSync(np)) vfs.writeFileSync(np, "");
    }),
    spy("linkSync", (src: fs.PathLike, dst: fs.PathLike) => mockLink(state, src, dst)),
    spy(
      "readlinkSync",
      (p: fs.PathLike, opts?: fs.BufferEncodingOption | { encoding?: BufferEncoding | null }) => {
        const target = state.symlinks.get(normPath(String(p)));
        if (!target) throw new Error("ENOENT: no such file or directory");
        return opts === "buffer" || (typeof opts === "object" && opts?.encoding === "buffer")
          ? Buffer.from(target)
          : target;
      },
    ),
    spy("utimesSync", (p: fs.PathLike, _a: unknown, m: number | string | Date) => {
      state.customMtimes.set(
        normPath(String(p)),
        typeof m === "number"
          ? m < 1e11
            ? m * 1000
            : m
          : m instanceof Date
            ? m.getTime()
            : Date.now(),
      );
    }),
    spy("renameSync", (src: fs.PathLike, dst: fs.PathLike) => mockRename(state, src, dst)),
    spy("cpSync", (src: string | URL, dst: string | URL) => mockCp(state, src, dst)),
    spy("copyFileSync", (src: fs.PathLike, dst: fs.PathLike) => {
      const sStr = normPath(String(src));
      const dStr = normPath(String(dst));
      const data = vfs.existsSync(sStr) ? vfs.readFileSync(sStr) : origRead(String(src));
      const parent = path.dirname(dStr);
      if (!vfs.existsSync(parent)) vfs.mkdirSync(parent, { recursive: true });
      vfs.writeFileSync(dStr, data);
    }),
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
      const e = state.openDescriptors.get(fd);
      if (e) state.customModes.set(e.path, typeof m === "string" ? parseInt(m, 8) : m);
    }),
    spy("fchownSync", () => {}),
    spy("futimesSync", (fd: number, _a: unknown, m: number | string | Date) => {
      const e = state.openDescriptors.get(fd);
      if (e)
        state.customMtimes.set(
          e.path,
          typeof m === "number"
            ? m < 1e11
              ? m * 1000
              : m
            : m instanceof Date
              ? m.getTime()
              : Date.now(),
        );
    }),
    spy("rmSync", (p: fs.PathLike, opts?: fs.RmOptions) => {
      const np = normPath(String(p));
      checkRmPermissions(state, np, opts);
      forgetInode(state, np);
      state.customModes.delete(np);
      state.customMtimes.delete(np);
      state.symlinks.delete(np);
      for (const k of state.symlinks.keys()) if (k.startsWith(np + "/")) state.symlinks.delete(k);
      for (const k of state.customModes.keys())
        if (k.startsWith(np + "/")) state.customModes.delete(k);
      vfs.rmSync(np, opts as Parameters<typeof vfs.rmSync>[1]);
    }),
    spy("unlinkSync", (p: fs.PathLike) => {
      const np = normPath(String(p));
      forgetInode(state, np);
      state.customModes.delete(np);
      state.customMtimes.delete(np);
      state.symlinks.delete(np);
      vfs.unlinkSync(np);
    }),
    spy("openSync", (p: fs.PathLike, flags: string | number) => mockOpen(state, p, flags)),
    spy("closeSync", (fd: number) => {
      if (state.openDescriptors.has(fd)) state.openDescriptors.delete(fd);
      else {
        try {
          origClose(fd);
        } catch {}
      }
    }),
    spy("fstatSync", (fd: number, opts?: fs.StatOptions) => {
      const entry = state.openDescriptors.get(fd);
      if (!entry) return origFstat(fd, opts as never);
      const vs = vfs.statSync(entry.path, { throwIfNoEntry: false });
      return vs
        ? makeFsStats(
            state,
            vs,
            entry.path,
            false,
            Boolean(opts && typeof opts === "object" && opts.bigint),
          )
        : origFstat(fd, opts as never);
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
    spy("fdatasyncSync", () => {}),
    spy("realpathSync", (p: fs.PathLike) => {
      const s = String(p);
      let norm = normPath(s);
      for (const [sym, target] of state.symlinks) {
        if (norm === sym) {
          norm = target;
          break;
        }
        if (norm.startsWith(sym + "/")) {
          norm = target + norm.slice(sym.length);
          break;
        }
      }
      if (vfs.existsSync(norm) || vfs.existsSync(s) || state.symlinks.has(norm)) return norm;
      if (isVirtualPath(s))
        throw Object.assign(new Error(`ENOENT: no such file or directory, realpath '${s}'`), {
          code: "ENOENT",
        });
      return origRealpath(s);
    }),
  ];
}
