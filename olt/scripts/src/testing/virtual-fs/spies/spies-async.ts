import { spyOn, type Mock } from "bun:test";
import { Buffer } from "node:buffer";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { mockOpen, mockRead, mockWrite } from "../core/index.ts";
import {
  checkRmPermissions,
  forgetInode,
  isVirtualPath,
  mockCp,
  mockLink,
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
} from "../core/index.ts";
import type { VirtualMemoryFS } from "../memory/index.ts";

export function buildAsyncSpies(
  state: VirtualFSSpyState,
  vfs: VirtualMemoryFS,
): Array<{ mockRestore: () => void }> {
  const fspSpy = <K extends keyof typeof fsp>(k: K, fn: unknown) =>
    spyOn(fsp, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  return [
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
      forgetInode(state, np);
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
      forgetInode(state, np);
      state.customModes.delete(np);
      state.customMtimes.delete(np);
      state.symlinks.delete(np);
      vfs.unlinkSync(np);
    }),
    fspSpy("realpath", async (p: fs.PathLike) => {
      const s = String(p);
      const norm = normPath(s);
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
      const target = normPath(String(p));
      const targetLen = typeof len === "number" ? len : 0;
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
      const fd = mockOpen(state, p, flags);
      const target = normPath(String(p));
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
  ];
}
