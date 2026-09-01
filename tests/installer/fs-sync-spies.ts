import { spyOn, type Mock } from "bun:test";
import * as fs from "node:fs";
import { dirname } from "node:path";
import { normPath, resolveVirtualPath, vfsState } from "./virtual-state.ts";
import {
  copyDirRecursive,
  handleCreateSymlink,
  handleLstat,
  handleOpenSync,
  handleReadSync,
  handleRenameSync,
  handleStat,
  handleWriteSync,
} from "./fs-handlers.ts";
import { checkWriteAccess, makeInstallerStats } from "./virtual-stats.ts";

export function createSyncFsSpies(): Array<
  Mock<(...args: unknown[]) => unknown> | { mockRestore: () => void }
> {
  const spy = <K extends keyof typeof fs>(k: K, fn: unknown) =>
    spyOn(fs, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  return [
    spy("existsSync", (p: fs.PathLike) => {
      const s = String(p);
      const norm = normPath(s);
      const resolved = resolveVirtualPath(norm);
      return (
        vfsState.vfs.existsSync(s) ||
        vfsState.vfs.existsSync(norm) ||
        vfsState.vfs.existsSync(resolved) ||
        vfsState.symlinks.has(norm)
      );
    }),
    spy("mkdirSync", (p: fs.PathLike, opts?: fs.MakeDirectoryOptions | boolean) => {
      const target = resolveVirtualPath(normPath(String(p)));
      const res = vfsState.vfs.mkdirSync(
        target,
        opts as Parameters<typeof vfsState.vfs.mkdirSync>[1],
      );
      if (typeof opts === "object" && opts !== null && typeof opts.mode === "number") {
        vfsState.customModes.set(target, opts.mode);
      }
      return res;
    }),
    spy(
      "writeFileSync",
      (
        p: fs.PathOrFileDescriptor,
        d: string | NodeJS.ArrayBufferView,
        opts?: fs.WriteFileOptions,
      ) => {
        const target = resolveVirtualPath(normPath(String(p)));
        checkWriteAccess(target);
        const parent = dirname(target);
        if (parent && !vfsState.vfs.existsSync(parent))
          vfsState.vfs.mkdirSync(parent, { recursive: true });
        vfsState.vfs.writeFileSync(
          target,
          typeof d === "string" ? d : Buffer.from(d as Uint8Array),
        );
        if (typeof opts === "object" && opts !== null && typeof opts.mode === "number") {
          vfsState.customModes.set(target, opts.mode);
        }
      },
    ),
    spy(
      "readFileSync",
      (
        p: fs.PathOrFileDescriptor,
        opts?: { encoding?: BufferEncoding | null; flag?: string } | BufferEncoding | null,
      ) => {
        if (typeof p === "number") {
          const entry = vfsState.openDescriptors.get(p);
          if (!entry || vfsState.vfs.statSync(entry.path, { throwIfNoEntry: false })?.isDirectory())
            return "";
          return typeof opts === "string" || (typeof opts === "object" && opts?.encoding)
            ? vfsState.vfs.readFileSync(entry.path, "utf8")
            : Buffer.from(vfsState.vfs.readFileSync(entry.path));
        }
        const s = String(p);
        const norm = normPath(s);
        const resolved = resolveVirtualPath(norm);
        const lookup = vfsState.vfs.existsSync(resolved)
          ? resolved
          : vfsState.vfs.existsSync(norm)
            ? norm
            : s;
        if (vfsState.vfs.existsSync(lookup)) {
          if (vfsState.vfs.statSync(lookup, { throwIfNoEntry: false })?.isDirectory()) {
            const err = new Error(`EISDIR: illegal operation on a directory, read '${lookup}'`);
            (err as unknown as { code: string }).code = "EISDIR";
            throw err;
          }
          return typeof opts === "string" || (typeof opts === "object" && opts?.encoding)
            ? vfsState.vfs.readFileSync(lookup, "utf8")
            : Buffer.from(vfsState.vfs.readFileSync(lookup));
        }
        const err = new Error(`ENOENT: no such file or directory, open '${lookup}'`);
        (err as unknown as { code: string }).code = "ENOENT";
        throw err;
      },
    ),
    spy(
      "readdirSync",
      (p: fs.PathLike, opts?: { withFileTypes?: boolean } | BufferEncoding | null) => {
        const s = String(p);
        const norm = normPath(s);
        const resolved = resolveVirtualPath(norm);
        const lookup = vfsState.vfs.existsSync(resolved) ? resolved : norm;
        return (typeof opts === "object" && opts?.withFileTypes
          ? vfsState.vfs.readdirSync(lookup, { withFileTypes: true })
          : vfsState.vfs.readdirSync(lookup)) as unknown as fs.Dirent[] & string[];
      },
    ),
    spy("statSync", handleStat),
    spy("lstatSync", handleLstat),
    spy("symlinkSync", (t: fs.PathLike, p: fs.PathLike) => {
      handleCreateSymlink(String(t), String(p));
    }),
    spy("readlinkSync", (p: fs.PathLike) => {
      const target = vfsState.symlinks.get(normPath(String(p)));
      if (!target) throw new Error("ENOENT: no such file or directory");
      return target;
    }),
    spy("utimesSync", (p: fs.PathLike, _a: unknown, m: number | string | Date) => {
      vfsState.customMtimes.set(
        normPath(String(p)),
        typeof m === "number" ? m : m instanceof Date ? m.getTime() : Date.now(),
      );
    }),
    spy("renameSync", handleRenameSync),
    spy("cpSync", (src: string | URL, dst: string | URL) => {
      const srcStr = normPath(String(src));
      const dstStr = normPath(String(dst));
      const stat = vfsState.vfs.statSync(srcStr, { throwIfNoEntry: false });
      if (!stat) {
        const err = new Error(`ENOENT: no such file or directory, cp '${srcStr}' -> '${dstStr}'`);
        (err as unknown as { code: string }).code = "ENOENT";
        throw err;
      }
      if (stat.isDirectory()) copyDirRecursive(srcStr, dstStr);
      else {
        vfsState.vfs.writeFileSync(dstStr, vfsState.vfs.readFileSync(srcStr));
        const m = vfsState.customModes.get(srcStr);
        if (m !== undefined) vfsState.customModes.set(dstStr, m);
      }
    }),
    spy("chmodSync", (p: fs.PathLike, m: fs.Mode) => {
      vfsState.customModes.set(normPath(String(p)), typeof m === "string" ? parseInt(m, 8) : m);
    }),
    spy("fchmodSync", (fd: number, m: fs.Mode) => {
      const entry = vfsState.openDescriptors.get(fd);
      if (entry) {
        vfsState.customModes.set(entry.path, typeof m === "string" ? parseInt(m, 8) : m);
      }
    }),
    spy("rmSync", (p: fs.PathLike, opts?: fs.RmOptions) => {
      const norm = normPath(String(p));
      vfsState.inodeMap.delete(norm);
      vfsState.symlinks.delete(norm);
      vfsState.customModes.delete(norm);
      vfsState.customMtimes.delete(norm);
      vfsState.specialFiles.delete(norm);
      vfsState.vfs.rmSync(norm, opts as Parameters<typeof vfsState.vfs.rmSync>[1]);
    }),
    spy("unlinkSync", (p: fs.PathLike) => {
      const norm = normPath(String(p));
      vfsState.inodeMap.delete(norm);
      vfsState.symlinks.delete(norm);
      vfsState.customModes.delete(norm);
      vfsState.customMtimes.delete(norm);
      vfsState.specialFiles.delete(norm);
      vfsState.vfs.unlinkSync(norm);
    }),
    spy("openSync", handleOpenSync),
    spy("closeSync", (fd: number) => {
      const entry = vfsState.openDescriptors.get(fd);
      if (entry) {
        const ino = vfsState.inodeMap.get(entry.path);
        if (ino !== undefined && vfsState.inodeLockOwners.get(ino) === fd) {
          vfsState.inodeLockOwners.delete(ino);
        }
      }
      vfsState.openDescriptors.delete(fd);
    }),
    spy("fstatSync", (fd: number, opts?: { bigint?: boolean }) => {
      const entry = vfsState.openDescriptors.get(fd);
      const target = entry?.path ?? "/virtual";
      const vs = vfsState.vfs.statSync(target, { throwIfNoEntry: false });
      return vs
        ? makeInstallerStats(vs, target, false, Boolean(opts?.bigint))
        : (fs.statSync(target, opts as never) as never);
    }),
    spy("readSync", handleReadSync),
    spy("writeSync", handleWriteSync),
    spy("appendFileSync", (p: fs.PathOrFileDescriptor, d: string | Uint8Array) => {
      const target = normPath(String(p));
      checkWriteAccess(target);
      const prev = vfsState.vfs.existsSync(target) ? vfsState.vfs.readFileSync(target, "utf8") : "";
      vfsState.vfs.writeFileSync(
        target,
        prev + (typeof d === "string" ? d : Buffer.from(d as Uint8Array).toString("utf8")),
      );
    }),
    spy("fsyncSync", () => {}),
    spy("realpathSync", (p: fs.PathLike) => resolveVirtualPath(normPath(String(p)))),
  ];
}
