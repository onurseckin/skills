/**
 * @file spies.ts
 * Interceptor spies for node:fs path operations for tests/store domain.
 */

import { spyOn, type Mock } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createDescriptorSpies } from "./descriptor-spies.ts";
import {
  checkReadPermission,
  checkTraversePermission,
  handleCp,
  handleRename,
  handleRw,
  isVirtualPath,
  makeFsStats,
  makeSymlinkStats,
  norm,
} from "./handlers.ts";
import { orig, type VirtualStoreState } from "./types.ts";

export function createStoreFsSpies(s: VirtualStoreState): Array<{ mockRestore: () => void }> {
  const spy = <K extends keyof typeof fs>(k: K, fn: unknown) =>
    spyOn(fs, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  const pathSpies: Array<{ mockRestore: () => void }> = [
    spy("existsSync", (p: fs.PathLike) => {
      const t = norm(String(p));
      if (s.symlinks.has(t)) return s.vfs.existsSync(s.symlinks.get(t)!);
      return s.vfs.existsSync(t) || s.hardlinks.has(t) || (!isVirtualPath(t) && orig.existsSync(t));
    }),
    spy("mkdirSync", (p: fs.PathLike, opts?: fs.MakeDirectoryOptions | boolean) => {
      const t = norm(String(p));
      if (isVirtualPath(t) || s.vfs.existsSync(t)) {
        s.vfs.mkdirSync(t, opts as Parameters<typeof s.vfs.mkdirSync>[1]);
        return t;
      }
      return orig.mkdirSync(t, opts as Parameters<typeof orig.mkdirSync>[1]);
    }),
    spy(
      "writeFileSync",
      (
        p: fs.PathOrFileDescriptor,
        d: string | NodeJS.ArrayBufferView,
        opts?: fs.WriteFileOptions,
      ) => {
        if (typeof p === "number") {
          handleRw(s, p, d, 0, (d as { length?: number })?.length ?? 0, null, true);
          return;
        }
        const t = norm(String(p));
        const parent = path.dirname(t);
        if (parent && !s.vfs.existsSync(parent)) s.vfs.mkdirSync(parent, { recursive: true });
        s.vfs.writeFileSync(t, typeof d === "string" ? d : Buffer.from(d as Uint8Array));
        if (typeof opts === "object" && opts !== null && typeof opts.mode === "number") {
          s.customModes.set(t, opts.mode);
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
          const e = s.openDescriptors.get(p);
          const t = e ? e.path : "";
          return typeof opts === "string" ||
            (typeof opts === "object" && (opts as { encoding?: string })?.encoding)
            ? s.vfs.readFileSync(t, "utf8")
            : s.vfs.readFileSync(t);
        }
        const t = norm(String(p));
        checkReadPermission(s, t);
        if (s.symlinks.has(t)) {
          const target = s.symlinks.get(t)!;
          if (!s.vfs.existsSync(target)) {
            const err = new Error(`ENOENT: no such file or directory, open '${t}'`);
            (err as unknown as { code: string }).code = "ENOENT";
            throw err;
          }
          return s.vfs.readFileSync(target, opts as Parameters<typeof s.vfs.readFileSync>[1]);
        }
        if (s.vfs.existsSync(t)) {
          if (s.vfs.statSync(t)?.isDirectory()) {
            const err = new Error(`EISDIR: illegal operation on a directory, read '${t}'`);
            (err as unknown as { code: string }).code = "EISDIR";
            throw err;
          }
          return s.vfs.readFileSync(t, opts as Parameters<typeof s.vfs.readFileSync>[1]);
        }
        return !isVirtualPath(t)
          ? orig.readFileSync(t, opts as BufferEncoding)
          : s.vfs.readFileSync(t, opts as Parameters<typeof s.vfs.readFileSync>[1]);
      },
    ),
    spy(
      "readdirSync",
      (p: fs.PathLike, opts?: { withFileTypes?: boolean } | BufferEncoding | null) => {
        const t = norm(String(p));
        checkReadPermission(s, t);
        if (s.vfs.existsSync(t)) {
          const vResults =
            typeof opts === "object" && opts?.withFileTypes
              ? (s.vfs.readdirSync(t, { withFileTypes: true }) as unknown as fs.Dirent[])
              : (s.vfs.readdirSync(t) as unknown as string[]);
          const linkNames = new Set<string>();
          for (const linkPath of s.symlinks.keys()) {
            if (path.dirname(linkPath) === t) linkNames.add(path.basename(linkPath));
          }
          if (linkNames.size === 0) return vResults as never;
          if (typeof opts === "object" && opts?.withFileTypes) {
            const list = [...(vResults as unknown as fs.Dirent[])];
            const existing = new Set(list.map((e) => e.name));
            for (const name of linkNames) {
              if (!existing.has(name)) {
                list.push({
                  name,
                  isFile: () => false,
                  isDirectory: () => false,
                  isSymbolicLink: () => true,
                  isBlockDevice: () => false,
                  isCharacterDevice: () => false,
                  isFIFO: () => false,
                  isSocket: () => false,
                } as unknown as fs.Dirent);
              }
            }
            return list as never;
          }
          const list = [...(vResults as unknown as string[])];
          for (const name of linkNames) {
            if (!list.includes(name)) list.push(name);
          }
          return list.sort() as never;
        }
        return !isVirtualPath(t)
          ? orig.readdirSync(t, opts as Parameters<typeof orig.readdirSync>[1])
          : (s.vfs.readdirSync(t) as unknown as string[]);
      },
    ),
    spy("statSync", (p: fs.PathLike) => {
      const t = norm(String(p));
      checkTraversePermission(s, t);
      if (s.symlinks.has(t)) {
        const target = s.symlinks.get(t)!;
        const vs = s.vfs.existsSync(target) ? s.vfs.statSync(target) : undefined;
        if (vs) return makeFsStats(s, vs, target);
        const err = new Error(`ENOENT: no such file or directory, stat '${t}'`);
        (err as unknown as { code: string }).code = "ENOENT";
        throw err;
      }
      const vs = s.vfs.existsSync(t) ? s.vfs.statSync(t) : undefined;
      if (vs) return makeFsStats(s, vs, t);
      if (!isVirtualPath(t)) return orig.statSync(t);
      const err = new Error(`ENOENT: no such file or directory, stat '${t}'`);
      (err as unknown as { code: string }).code = "ENOENT";
      throw err;
    }),
    spy("lstatSync", (p: fs.PathLike) => {
      const t = norm(String(p));
      checkTraversePermission(s, t);
      if (s.symlinks.has(t)) return makeSymlinkStats(s, t);
      const vs = s.vfs.existsSync(t) ? s.vfs.statSync(t) : undefined;
      if (vs) return makeFsStats(s, vs, t);
      if (!isVirtualPath(t)) return orig.lstatSync(t);
      const err = new Error(`ENOENT: no such file or directory, lstat '${t}'`);
      (err as unknown as { code: string }).code = "ENOENT";
      throw err;
    }),
    spy("rmSync", (p: fs.PathLike, opts?: fs.RmOptions) => {
      const t = norm(String(p));
      s.symlinks.delete(t);
      s.hardlinks.delete(t);
      s.customModes.delete(t);
      s.customMtimes.delete(t);
      if (s.vfs.existsSync(t)) s.vfs.rmSync(t, opts as Parameters<typeof s.vfs.rmSync>[1]);
      else if (!isVirtualPath(t)) orig.rmSync(t, opts);
    }),
    spy("unlinkSync", (p: fs.PathLike) => {
      const t = norm(String(p));
      s.symlinks.delete(t);
      s.hardlinks.delete(t);
      s.customModes.delete(t);
      s.customMtimes.delete(t);
      if (s.vfs.existsSync(t)) s.vfs.unlinkSync(t);
      else if (!isVirtualPath(t)) orig.unlinkSync(t);
    }),
    spy("symlinkSync", (target: fs.PathLike, link: fs.PathLike) => {
      s.symlinks.set(norm(String(link)), norm(String(target)));
    }),
    spy("readlinkSync", (p: fs.PathLike) => {
      const t = norm(String(p));
      if (s.symlinks.has(t)) return s.symlinks.get(t)!;
      return orig.readlinkSync(t);
    }),
    spy("linkSync", (src: fs.PathLike, dst: fs.PathLike) => {
      const sStr = norm(String(src));
      const dStr = norm(String(dst));
      s.hardlinks.set(dStr, sStr);
      if (s.vfs.existsSync(sStr)) {
        const parent = path.dirname(dStr);
        if (parent && !s.vfs.existsSync(parent)) s.vfs.mkdirSync(parent, { recursive: true });
        s.vfs.writeFileSync(dStr, s.vfs.readFileSync(sStr));
        const mode = s.customModes.get(sStr);
        if (mode !== undefined) s.customModes.set(dStr, mode);
        return;
      }
      if (!isVirtualPath(sStr) && !isVirtualPath(dStr)) orig.linkSync(sStr, dStr);
    }),
    spy("chmodSync", (p: fs.PathLike, m: fs.Mode) => {
      s.customModes.set(norm(String(p)), typeof m === "string" ? parseInt(m, 8) : m);
    }),
    spy("realpathSync", (p: fs.PathLike) => {
      const t = norm(String(p));
      return isVirtualPath(t) || s.vfs.existsSync(t) || s.symlinks.has(t)
        ? (s.symlinks.get(t) ?? t)
        : orig.realpathSync(t);
    }),
    spy("renameSync", (src: fs.PathLike, dst: fs.PathLike) => {
      const sStr = norm(String(src));
      const dStr = norm(String(dst));
      if (s.vfs.existsSync(sStr)) {
        handleRename(s, sStr, dStr);
        return;
      }
      orig.renameSync(sStr, dStr);
    }),
    spy("cpSync", (src: string | URL, dst: string | URL) => {
      const sStr = norm(String(src));
      const dStr = norm(String(dst));
      if (s.vfs.existsSync(sStr)) {
        handleCp(s, sStr, dStr);
        return;
      }
      orig.cpSync(sStr, dStr);
    }),
    spy("copyFileSync", (src: fs.PathLike, dst: fs.PathLike) => {
      const sStr = norm(String(src));
      const dStr = norm(String(dst));
      if (s.vfs.existsSync(sStr)) {
        const parent = path.dirname(dStr);
        if (parent && !s.vfs.existsSync(parent)) s.vfs.mkdirSync(parent, { recursive: true });
        s.vfs.writeFileSync(dStr, s.vfs.readFileSync(sStr));
        const mode = s.customModes.get(sStr);
        if (mode !== undefined) s.customModes.set(dStr, mode);
        return;
      }
      orig.copyFileSync(sStr, dStr);
    }),
    spy("utimesSync", (p: fs.PathLike, _a: unknown, m: number | string | Date) => {
      s.customMtimes.set(
        norm(String(p)),
        typeof m === "number" ? m : m instanceof Date ? m.getTime() : Date.now(),
      );
    }),
    spy("appendFileSync", (p: fs.PathOrFileDescriptor, d: string | Uint8Array) => {
      const t = norm(String(p));
      const cur = s.vfs.existsSync(t) ? s.vfs.readFileSync(t, "utf8") : "";
      s.vfs.writeFileSync(t, cur + (typeof d === "string" ? d : Buffer.from(d).toString("utf8")));
    }),
    spy("mkdtempSync", (prefix: string) => {
      const dir = norm(`${prefix}${Date.now()}-${s.nextInode++}`);
      s.vfs.mkdirSync(dir, { recursive: true });
      return dir;
    }),
  ];

  return [...pathSpies, ...createDescriptorSpies(s)];
}
