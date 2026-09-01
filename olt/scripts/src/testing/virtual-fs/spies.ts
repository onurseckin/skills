import { spyOn, type Mock } from "bun:test";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as nativeRename from "../../installer/native-rename.ts";
import { HarnessError } from "../../core/errors/index.ts";
import * as platform from "../../platform/index.ts";
import { mockOpen, mockRead, mockWrite, mockSpawnSync } from "./descriptors.ts";
import {
  checkRmPermissions,
  copyDirRecursive,
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
  origClose,
  origFstat,
  origRead,
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
    hardlinks: new Map(),
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
        typeof m === "number" ? m : m instanceof Date ? m.getTime() : Date.now(),
      );
    }),
    spy("renameSync", (src: fs.PathLike, dst: fs.PathLike) => mockRename(state, src, dst)),
    spy("cpSync", (src: string | URL, dst: string | URL) => mockCp(state, src, dst)),
    spy("copyFileSync", (src: fs.PathLike, dst: fs.PathLike) => {
      const sStr = normPath(String(src)),
        dStr = normPath(String(dst));
      const data = vfs.existsSync(sStr) ? vfs.readFileSync(sStr) : origRead(String(src));
      const parent = path.dirname(dStr);
      if (!vfs.existsSync(parent)) vfs.mkdirSync(parent, { recursive: true });
      vfs.writeFileSync(dStr, data);
    }),
    spy("ftruncateSync", (fd: number, len?: number | null) => {
      const entry = state.openDescriptors.get(fd);
      if (!entry) return;
      const targetLen = typeof len === "number" ? len : 0,
        data = vfs.existsSync(entry.path)
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
          typeof m === "number" ? m : m instanceof Date ? m.getTime() : Date.now(),
        );
    }),
    spy("rmSync", (p: fs.PathLike, opts?: fs.RmOptions) => {
      const np = normPath(String(p));
      checkRmPermissions(state, np, opts);
      state.inodeMap.delete(np);
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
      state.inodeMap.delete(np);
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
    fspSpy("mkdtemp", async (prefix: string) => {
      const dir = normPath(prefix + Math.random().toString(36).slice(2));
      vfs.mkdirSync(dir, { recursive: true });
      return dir;
    }),
    fspSpy("mkdir", async (p: fs.PathLike, opts?: fs.MakeDirectoryOptions | boolean) =>
      mockMkdir(state, p, opts),
    ),
    fspSpy(
      "writeFile",
      async (
        p: fs.PathOrFileDescriptor,
        d: string | NodeJS.ArrayBufferView,
        opts?: fs.WriteFileOptions,
      ) => mockWriteFile(state, p, d, opts),
    ),
    fspSpy(
      "readFile",
      async (
        p: fs.PathOrFileDescriptor,
        opts?: { encoding?: BufferEncoding | null; flag?: string } | BufferEncoding | null,
      ) => mockReadFile(state, p, opts),
    ),
    fspSpy(
      "readdir",
      async (p: fs.PathLike, opts?: { withFileTypes?: boolean } | BufferEncoding | null) =>
        mockReaddir(state, p, opts),
    ),
    fspSpy("stat", async (p: fs.PathLike, opts?: fs.StatOptions) => mockStat(state, p, opts)),
    fspSpy("lstat", async (p: fs.PathLike, opts?: fs.StatOptions) => mockLstat(state, p, opts)),
    fspSpy("rm", async (p: fs.PathLike, opts?: fs.RmOptions) => {
      const np = normPath(String(p));
      checkRmPermissions(state, np, opts);
      state.inodeMap.delete(np);
      state.customModes.delete(np);
      state.customMtimes.delete(np);
      state.symlinks.delete(np);
      for (const k of state.symlinks.keys()) if (k.startsWith(np + "/")) state.symlinks.delete(k);
      for (const k of state.customModes.keys())
        if (k.startsWith(np + "/")) state.customModes.delete(k);
      vfs.rmSync(np, opts as Parameters<typeof vfs.rmSync>[1]);
    }),
    fspSpy("unlink", async (p: fs.PathLike) => {
      const np = normPath(String(p));
      state.inodeMap.delete(np);
      state.customModes.delete(np);
      state.customMtimes.delete(np);
      state.symlinks.delete(np);
      vfs.unlinkSync(np);
    }),
    fspSpy("realpath", async (p: fs.PathLike) => {
      const s = String(p),
        norm = normPath(s);
      if (vfs.existsSync(norm) || vfs.existsSync(s) || state.symlinks.has(norm)) return norm;
      if (isVirtualPath(s))
        throw Object.assign(new Error(`ENOENT: no such file or directory, realpath '${s}'`), {
          code: "ENOENT",
        });
      return origRealpath(s);
    }),
    fspSpy("cp", async (src: string | URL, dst: string | URL) => mockCp(state, src, dst)),
    fspSpy("rename", async (src: fs.PathLike, dst: fs.PathLike) => mockRename(state, src, dst)),
    fspSpy("chmod", async (p: fs.PathLike, m: fs.Mode) => {
      state.customModes.set(normPath(String(p)), typeof m === "string" ? parseInt(m, 8) : m);
    }),
    fspSpy("symlink", async (target: fs.PathLike, linkPath: fs.PathLike) => {
      const np = normPath(String(linkPath));
      state.symlinks.set(np, String(target));
      const parent = path.dirname(np);
      if (!vfs.existsSync(parent)) vfs.mkdirSync(parent, { recursive: true });
      if (!vfs.existsSync(np)) vfs.writeFileSync(np, "");
    }),
    fspSpy("link", async (src: fs.PathLike, dst: fs.PathLike) => mockLink(state, src, dst)),
    fspSpy(
      "readlink",
      async (
        p: fs.PathLike,
        opts?: fs.BufferEncodingOption | { encoding?: BufferEncoding | null },
      ) => {
        const target = state.symlinks.get(normPath(String(p)));
        if (!target) throw new Error("ENOENT: no such file or directory");
        return opts === "buffer" || (typeof opts === "object" && opts?.encoding === "buffer")
          ? Buffer.from(target)
          : target;
      },
    ),
    fspSpy("truncate", async (p: fs.PathLike, len = 0) => {
      const target = normPath(String(p)),
        targetLen = typeof len === "number" ? len : 0;
      const content = vfs.existsSync(target)
        ? Buffer.from(vfs.readFileSync(target))
        : Buffer.alloc(0);
      if (content.length === targetLen) return;
      if (content.length > targetLen) vfs.writeFileSync(target, content.subarray(0, targetLen));
      else {
        const exp = Buffer.alloc(targetLen);
        content.copy(exp);
        vfs.writeFileSync(target, exp);
      }
    }),
    fspSpy("open", async (p: fs.PathLike, flags: string | number = "r", mode?: fs.Mode) => {
      const fd = mockOpen(state, p, flags),
        target = normPath(String(p));
      if (typeof mode === "number") state.customModes.set(target, mode);
      return {
        fd,
        stat: async (opts?: fs.StatOptions) => mockStat(state, p, opts),
        read: async (b: NodeJS.ArrayBufferView, off = 0, len = b.byteLength, pos = null) => ({
          bytesRead: mockRead(state, fd, b, off, len, pos),
          buffer: b,
        }),
        write: async (
          b: NodeJS.ArrayBufferView | string,
          off = 0,
          len = typeof b === "string" ? Buffer.byteLength(b) : b.byteLength,
          pos = null,
        ) => ({ bytesWritten: mockWrite(state, fd, b, off, len, pos), buffer: b as never }),
        truncate: async (len = 0) => {
          const c = vfs.existsSync(target)
            ? Buffer.from(vfs.readFileSync(target))
            : Buffer.alloc(0);
          vfs.writeFileSync(target, c.subarray(0, typeof len === "number" ? len : 0));
        },
        chmod: async (m: fs.Mode) => {
          state.customModes.set(target, typeof m === "string" ? parseInt(m, 8) : m);
        },
        sync: async () => {},
        datasync: async () => {},
        close: async () => {
          if (state.openDescriptors.has(fd)) state.openDescriptors.delete(fd);
        },
      } as unknown as fsp.FileHandle;
    }),
    spyOn(platform, "tryExclusiveFlock").mockReturnValue(true) as never,
    spyOn(platform, "releaseFlock").mockImplementation(() => {}) as never,
    spawnSpy((cmd: unknown, args: unknown, opts: unknown) => mockSpawnSync(state, cmd, args, opts)),
    spyOn(childProcess, "execFileSync").mockImplementation(((
      cmd: unknown,
      args: unknown,
      opts: unknown,
    ) =>
      String(cmd).includes("git")
        ? Buffer.from("main\n")
        : (childProcess.execFileSync as (...args: unknown[]) => unknown)(
            cmd,
            args,
            opts,
          )) as never),
    spyOn(childProcess, "execSync").mockImplementation(((cmd: unknown, opts: unknown) =>
      String(cmd).includes("git")
        ? Buffer.from("main\n")
        : (childProcess.execSync as (...args: unknown[]) => unknown)(cmd, opts)) as never),
    spyOn(
      Bun as unknown as Record<string, (...args: unknown[]) => unknown>,
      "spawn" as never,
    ).mockImplementation(((options: { cmd?: string[] }) => {
      const outText =
        options.cmd?.[0] === "ps"
          ? `${process.pid} 1 ${process.pid}\n`
          : options.cmd?.[0] === "echo"
            ? options.cmd.slice(1).join(" ") + "\n"
            : "main\n";
      return {
        pid: 999999,
        exited: Promise.resolve(0),
        stdout: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(outText));
            c.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        kill: () => {},
        ref: () => {},
        unref: () => {},
      };
    }) as never),
    spyOn(nativeRename, "renameNoReplace").mockImplementation(((
      src: string,
      dst: string,
      label: string,
    ) => {
      const srcStr = normPath(src),
        dstStr = normPath(dst);
      if (vfs.existsSync(dstStr) || state.symlinks.has(dstStr))
        throw new HarnessError("INVALID_STATE", `${label} destination already exists`);
      if (!vfs.existsSync(srcStr) && !state.symlinks.has(srcStr))
        throw new HarnessError("INVALID_STATE", `${label} rename failed with errno 2`);
      mockRename(state, srcStr, dstStr);
    }) as never),
    spyOn(nativeRename, "exchangePaths").mockImplementation(((
      l: string,
      r: string,
      label: string,
    ) => {
      const ls = normPath(l),
        rs = normPath(r);
      if (!vfs.existsSync(ls) || !vfs.existsSync(rs))
        throw new HarnessError("INVALID_STATE", `${label} rename failed with errno 2`);
      const tmp = `${ls}.tmp-${Date.now()}`;
      mockRename(state, ls, tmp);
      mockRename(state, rs, ls);
      mockRename(state, tmp, rs);
    }) as never),
    spyOn(process, "cwd").mockImplementation(() => state.vfs.cwd()),
    spyOn(process, "chdir").mockImplementation(((dir: string) => {
      state.vfs.chdir(String(dir));
    }) as never),
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
