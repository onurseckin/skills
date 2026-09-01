/**
 * @file spies.ts
 * Path-level interceptor spies for node:fs operations for tests/watchdog domain.
 */

import { spyOn, type Mock } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createDescriptorSpies } from "./descriptor-spies.ts";
import {
  checkReadPermission,
  copyDirRecursive,
  handleRw,
  isVirtualPath,
  makeFsStats,
  makeSymlinkStats,
  norm,
} from "./handlers.ts";
import { orig, type VirtualWatchdogState } from "./types.ts";

export function createWatchdogFsSpies(s: VirtualWatchdogState): Array<{ mockRestore: () => void }> {
  const spy = <K extends keyof typeof fs>(k: K, fn: unknown) =>
    spyOn(fs, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  const pathSpies = [
    spy("existsSync", (p: fs.PathLike) => {
      const t = norm(String(p));
      if (s.symlinks.has(t)) return true;
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
        if (!isVirtualPath(t) && !s.vfs.existsSync(t)) {
          orig.writeFileSync(t, d, opts);
          return;
        }
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
          return s.vfs.readFileSync(target, opts as Parameters<typeof s.vfs.readFileSync>[1]);
        }
        if (s.vfs.existsSync(t)) {
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
        if (s.vfs.existsSync(t)) {
          return typeof opts === "object" && opts?.withFileTypes
            ? (s.vfs.readdirSync(t, { withFileTypes: true }) as unknown as fs.Dirent[])
            : (s.vfs.readdirSync(t) as unknown as string[]);
        }
        return !isVirtualPath(t)
          ? orig.readdirSync(t, opts as Parameters<typeof orig.readdirSync>[1])
          : (s.vfs.readdirSync(t) as unknown as string[]);
      },
    ),
    spy("statSync", (p: fs.PathLike) => {
      const t = norm(String(p));
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
      for (const k of Array.from(s.hardlinks.keys())) {
        if (k.startsWith(t + "/") || s.hardlinks.get(k)?.startsWith(t + "/")) s.hardlinks.delete(k);
      }
      for (const k of Array.from(s.symlinks.keys())) {
        if (k.startsWith(t + "/")) s.symlinks.delete(k);
      }
      for (const k of Array.from(s.customModes.keys())) {
        if (k.startsWith(t + "/")) s.customModes.delete(k);
      }
      for (const k of Array.from(s.customMtimes.keys())) {
        if (k.startsWith(t + "/")) s.customMtimes.delete(k);
      }
      if (s.vfs.existsSync(t)) s.vfs.rmSync(t, opts as Parameters<typeof s.vfs.rmSync>[1]);
      else if (!isVirtualPath(t)) orig.rmSync(t, opts);
    }),
    spy("unlinkSync", (p: fs.PathLike) => {
      const t = norm(String(p));
      s.symlinks.delete(t);
      s.hardlinks.delete(t);
      s.customModes.delete(t);
      s.customMtimes.delete(t);
      for (const [child, parent] of Array.from(s.hardlinks.entries())) {
        if (parent === t) s.hardlinks.delete(child);
      }
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
        const st = s.vfs.statSync(sStr);
        if (st?.isDirectory()) {
          copyDirRecursive(s.vfs, sStr, dStr, s);
          s.vfs.rmSync(sStr, { recursive: true, force: true });
        } else {
          const parent = path.dirname(dStr);
          if (parent && !s.vfs.existsSync(parent)) s.vfs.mkdirSync(parent, { recursive: true });
          s.vfs.writeFileSync(dStr, s.vfs.readFileSync(sStr));
          s.vfs.unlinkSync(sStr);
          const mode = s.customModes.get(sStr);
          if (mode !== undefined) {
            s.customModes.delete(sStr);
            s.customModes.set(dStr, mode);
          }
          const mtime = s.customMtimes.get(sStr);
          if (mtime !== undefined) {
            s.customMtimes.delete(sStr);
            s.customMtimes.set(dStr, mtime);
          }
        }
        return;
      }
      orig.renameSync(sStr, dStr);
    }),
    spy("cpSync", (src: string | URL, dst: string | URL) => {
      const sStr = norm(String(src));
      const dStr = norm(String(dst));
      if (s.vfs.existsSync(sStr)) {
        const st = s.vfs.statSync(sStr);
        if (st?.isDirectory()) copyDirRecursive(s.vfs, sStr, dStr, s);
        else {
          const parent = path.dirname(dStr);
          if (parent && !s.vfs.existsSync(parent)) s.vfs.mkdirSync(parent, { recursive: true });
          s.vfs.writeFileSync(dStr, s.vfs.readFileSync(sStr));
          const mode = s.customModes.get(sStr);
          if (mode !== undefined) s.customModes.set(dStr, mode);
        }
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
      if (typeof p === "number") {
        handleRw(s, p, d, 0, (d as { length?: number })?.length ?? 0, null, true);
        return;
      }
      const t = norm(String(p));
      if (!isVirtualPath(t) && !s.vfs.existsSync(t)) {
        orig.appendFileSync(t, d);
        return;
      }
      const cur = s.vfs.existsSync(t) ? s.vfs.readFileSync(t, "utf8") : "";
      s.vfs.writeFileSync(t, cur + (typeof d === "string" ? d : Buffer.from(d).toString("utf8")));
    }),
    spy("mkdtempSync", (prefix: string) => {
      if (isVirtualPath(prefix)) {
        const dir = norm(`${prefix}${Date.now()}-${s.nextInode++}`);
        s.vfs.mkdirSync(dir, { recursive: true });
        return dir;
      }
      return orig.mkdtempSync(prefix);
    }),
  ];

  return [...pathSpies, ...createDescriptorSpies(s)];
}
