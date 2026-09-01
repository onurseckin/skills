import { spyOn, type Mock } from "bun:test";
import type * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import { dirname } from "node:path";
import { normPath, resolveVirtualPath, vfsState } from "./virtual-state.ts";
import {
  copyDirRecursive,
  handleCreateSymlink,
  handleLstat,
  handleRenameSync,
  handleStat,
} from "./fs-handlers.ts";
import { checkWriteAccess } from "./virtual-stats.ts";

export function createAsyncFsSpies(): Array<
  Mock<(...args: unknown[]) => unknown> | { mockRestore: () => void }
> {
  const spyP = <K extends keyof typeof fsPromises>(k: K, fn: unknown) =>
    spyOn(fsPromises, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  return [
    spyP("mkdir", async (p: fs.PathLike, opts?: fs.MakeDirectoryOptions | boolean) => {
      const target = resolveVirtualPath(normPath(String(p)));
      vfsState.vfs.mkdirSync(target, opts as Parameters<typeof vfsState.vfs.mkdirSync>[1]);
      if (typeof opts === "object" && opts !== null && typeof opts.mode === "number") {
        vfsState.customModes.set(target, opts.mode);
      }
      return undefined as never;
    }),
    spyP(
      "writeFile",
      async (p: fs.PathLike, d: string | Uint8Array, opts?: fs.WriteFileOptions) => {
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
    spyP(
      "readFile",
      async (p: fs.PathLike, opts?: { encoding?: BufferEncoding } | BufferEncoding | null) => {
        const norm = normPath(String(p));
        const resolved = resolveVirtualPath(norm);
        const lookup = vfsState.vfs.existsSync(resolved)
          ? resolved
          : vfsState.vfs.existsSync(norm)
            ? norm
            : norm;
        if (!vfsState.vfs.existsSync(lookup)) {
          const err = new Error(`ENOENT: no such file or directory, open '${norm}'`);
          (err as unknown as { code: string }).code = "ENOENT";
          throw err;
        }
        return (
          typeof opts === "string" || (typeof opts === "object" && opts?.encoding)
            ? vfsState.vfs.readFileSync(lookup, "utf8")
            : Buffer.from(vfsState.vfs.readFileSync(lookup))
        ) as never;
      },
    ),
    spyP(
      "readdir",
      async (p: fs.PathLike, opts?: { withFileTypes?: boolean } | BufferEncoding | null) => {
        const s = String(p);
        const norm = normPath(s);
        const resolved = resolveVirtualPath(norm);
        const lookup = vfsState.vfs.existsSync(resolved) ? resolved : norm;
        return (typeof opts === "object" && opts?.withFileTypes
          ? vfsState.vfs.readdirSync(lookup, { withFileTypes: true })
          : vfsState.vfs.readdirSync(lookup)) as unknown as fs.Dirent[] & string[];
      },
    ),
    spyP(
      "rename",
      async (src: fs.PathLike, dst: fs.PathLike) => handleRenameSync(src, dst) as never,
    ),
    spyP(
      "lstat",
      async (p: fs.PathLike, opts?: { bigint?: boolean }) => handleLstat(p, opts) as never,
    ),
    spyP(
      "stat",
      async (p: fs.PathLike, opts?: { bigint?: boolean }) => handleStat(p, opts) as never,
    ),
    spyP("realpath", async (p: fs.PathLike) => resolveVirtualPath(normPath(String(p)))),
    spyP("symlink", async (t: fs.PathLike, p: fs.PathLike) => {
      handleCreateSymlink(String(t), String(p));
    }),
    spyP("readlink", async (p: fs.PathLike) => {
      const target = vfsState.symlinks.get(normPath(String(p)));
      if (!target) throw new Error("ENOENT: no such file or directory");
      return target;
    }),
    spyP("rm", async (p: fs.PathLike, opts?: fs.RmOptions) => {
      const norm = normPath(String(p));
      vfsState.inodeMap.delete(norm);
      vfsState.symlinks.delete(norm);
      vfsState.customModes.delete(norm);
      vfsState.customMtimes.delete(norm);
      vfsState.specialFiles.delete(norm);
      vfsState.vfs.rmSync(norm, opts as Parameters<typeof vfsState.vfs.rmSync>[1]);
    }),
    spyP("unlink", async (p: fs.PathLike) => {
      const norm = normPath(String(p));
      vfsState.inodeMap.delete(norm);
      vfsState.symlinks.delete(norm);
      vfsState.customModes.delete(norm);
      vfsState.customMtimes.delete(norm);
      vfsState.specialFiles.delete(norm);
      vfsState.vfs.unlinkSync(norm);
    }),
    spyP("chmod", async (p: fs.PathLike, m: fs.Mode) => {
      vfsState.customModes.set(normPath(String(p)), typeof m === "string" ? parseInt(m, 8) : m);
    }),
    spyP("cp", async (src: string, dst: string) => {
      const srcStr = normPath(src);
      const dstStr = normPath(dst);
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
  ];
}
