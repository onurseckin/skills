import * as fs from "node:fs";
import type { VirtualStats } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { orig, noent, type VirtualFsState } from "./virtual-fs-state.ts";
import { handleRename, handleRw } from "./virtual-fs-rw.ts";

export { orig, type VirtualFsState, noent };

export function makeHandlers(s: VirtualFsState) {
  const stat = (p: fs.PathLike): fs.Stats => {
    const t = s.norm(String(p));
    if (s.symlinks.has(t)) {
      const res = s.symlinks.get(t)!;
      const vs = s.vfs.existsSync(res) ? s.vfs.statSync(res) : undefined;
      if (vs) return s.makeStats(vs, res);
    }
    const vs = s.vfs.existsSync(t) ? s.vfs.statSync(t) : undefined;
    if (vs) return s.makeStats(vs, t);
    return !s.isVirtualPath(t) ? orig.stat(t) : noent("stat", t);
  };

  const lstat = (p: fs.PathLike): fs.Stats => {
    const t = s.norm(String(p));
    if (s.symlinks.has(t))
      return s.makeStats(
        {
          isFile: () => false,
          isDirectory: () => false,
          size: 0,
          mtime: new Date(),
        } as VirtualStats,
        t,
        true,
      );
    const vs = s.vfs.existsSync(t) ? s.vfs.statSync(t) : undefined;
    if (vs) return s.makeStats(vs, t);
    return !s.isVirtualPath(t) ? orig.lstat(t) : noent("lstat", t);
  };

  const read = (p: unknown, opts: unknown): string | Buffer => {
    if (typeof p === "number") {
      const e = s.openDescriptors.get(p);
      const t = e ? e.path : "";
      return typeof opts === "string" ||
        (typeof opts === "object" && (opts as { encoding?: string })?.encoding)
        ? s.vfs.readFileSync(t, "utf8")
        : s.vfs.readFileSync(t);
    }
    const str = s.norm(String(p));
    if (s.vfs.existsSync(str)) {
      if (s.vfs.statSync(str)?.isDirectory()) {
        const err = new Error(`EISDIR: illegal operation on a directory, read '${str}'`);
        (err as unknown as { code: string }).code = "EISDIR";
        throw err;
      }
      return typeof opts === "string" ||
        (typeof opts === "object" && (opts as { encoding?: string })?.encoding)
        ? s.vfs.readFileSync(str, "utf8")
        : s.vfs.readFileSync(str);
    }
    return !s.isVirtualPath(str)
      ? orig.read(str, opts as BufferEncoding)
      : s.vfs.readFileSync(str, opts as Parameters<typeof s.vfs.readFileSync>[1]);
  };

  const open = (p: fs.PathLike, flags: unknown): number => {
    const t = s.norm(String(p));
    if (!s.isVirtualPath(t)) return orig.open(t, flags as Parameters<typeof orig.open>[1]);
    const numFlags = typeof flags === "number" ? flags : 0;
    const isW =
      (numFlags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0;
    const isA = (numFlags & fs.constants.O_APPEND) !== 0;
    if (!isW && !s.vfs.existsSync(t)) noent("open", t);
    if (isW && !s.vfs.existsSync(t) && (numFlags & (fs.constants.O_DIRECTORY ?? 0)) === 0)
      s.vfs.writeFileSync(t, "");
    const len =
      s.vfs.existsSync(t) && !s.vfs.statSync(t)?.isDirectory() ? s.vfs.readFileSync(t).length : 0;
    const fd = s.nextFd();
    s.openDescriptors.set(fd, { path: t, position: isA ? len : 0, flags: numFlags });
    return fd;
  };

  return {
    exists: (p: fs.PathLike) =>
      s.symlinks.has(s.norm(String(p))) ||
      s.hardlinks.has(s.norm(String(p))) ||
      s.vfs.existsSync(s.norm(String(p))) ||
      (!s.isVirtualPath(s.norm(String(p))) && orig.exists(s.norm(String(p)))),
    mkdir: (p: fs.PathLike, opts?: unknown) => {
      const str = s.norm(String(p));
      if (s.isVirtualPath(str)) {
        s.vfs.mkdirSync(str, opts as Parameters<typeof s.vfs.mkdirSync>[1]);
        return undefined as unknown as string;
      }
      return orig.mkdir(str, opts as Parameters<typeof orig.mkdir>[1]);
    },
    write: (p: fs.PathLike, data: unknown, opts?: unknown) => {
      const t = s.norm(String(p));
      if (s.isVirtualPath(t)) {
        s.vfs.writeFileSync(t, typeof data === "string" ? data : Buffer.from(data as Uint8Array));
        if (
          typeof opts === "object" &&
          opts !== null &&
          typeof (opts as { mode?: number }).mode === "number"
        )
          s.customModes.set(t, (opts as { mode: number }).mode);
        return;
      }
      orig.write(t, data as string, opts as Parameters<typeof orig.write>[2]);
    },
    read,
    readdir: (p: fs.PathLike, opts?: unknown) => {
      const str = s.norm(String(p));
      if (s.vfs.existsSync(str))
        return typeof opts === "object" && (opts as { withFileTypes?: boolean })?.withFileTypes
          ? (s.vfs.readdirSync(str, { withFileTypes: true }) as unknown as fs.Dirent[])
          : (s.vfs.readdirSync(str) as unknown as string[]);
      return !s.isVirtualPath(str)
        ? orig.readdir(str, opts as Parameters<typeof orig.readdir>[1])
        : (s.vfs.readdirSync(str) as unknown as string[]);
    },
    stat,
    lstat,
    rm: (p: fs.PathLike, opts?: unknown) => {
      const str = s.norm(String(p));
      if (s.isVirtualPath(str)) {
        s.symlinks.delete(str);
        s.hardlinks.delete(str);
        if (s.vfs.existsSync(str)) s.vfs.rmSync(str, opts as Parameters<typeof s.vfs.rmSync>[1]);
        return;
      }
      orig.rm(str, opts as Parameters<typeof orig.rm>[1]);
    },
    unlink: (p: fs.PathLike) => {
      const str = s.norm(String(p));
      if (s.isVirtualPath(str)) {
        s.symlinks.delete(str);
        s.hardlinks.delete(str);
        if (s.vfs.existsSync(str)) s.vfs.unlinkSync(str);
        return;
      }
      orig.unlink(str);
    },
    symlink: (t: fs.PathLike, l: fs.PathLike) => {
      const strL = s.norm(String(l));
      if (s.isVirtualPath(strL)) {
        s.symlinks.set(strL, String(t));
        return;
      }
      orig.symlink(String(t), strL);
    },
    link: (src: fs.PathLike, dst: fs.PathLike) => {
      const sStr = s.norm(String(src)),
        dStr = s.norm(String(dst));
      if (s.isVirtualPath(dStr)) {
        s.hardlinks.set(dStr, sStr);
        if (s.vfs.existsSync(sStr)) s.vfs.writeFileSync(dStr, s.vfs.readFileSync(sStr));
        return;
      }
      orig.link(sStr, dStr);
    },
    open,
    close: (fd: number) => {
      if (s.openDescriptors.has(fd)) {
        s.openDescriptors.delete(fd);
        return;
      }
      orig.close(fd);
    },
    readSync: (fd: number, b: unknown, o: unknown, l: unknown, pos: unknown) =>
      handleRw(s, fd, b, o, l, pos, false),
    writeSync: (fd: number, b: unknown, o: unknown, l: unknown, pos: unknown) =>
      handleRw(s, fd, b, o, l, pos, true),
    fsync: (fd: number) => {
      if (!s.openDescriptors.has(fd)) orig.fsync(fd);
    },
    fstat: (fd: number) => {
      const e = s.openDescriptors.get(fd);
      return e ? stat(e.path) : orig.fstat(fd);
    },
    realpath: (p: fs.PathLike) => {
      const t = s.norm(String(p));
      return s.isVirtualPath(t) ? (s.symlinks.get(t) ?? t) : orig.realpath(t);
    },
    rename: (src: fs.PathLike, dst: fs.PathLike) => handleRename(s, src, dst),
    chmod: (p: fs.PathLike, mode: unknown) => {
      const t = s.norm(String(p));
      if (s.isVirtualPath(t)) {
        s.customModes.set(t, typeof mode === "string" ? parseInt(mode, 8) : Number(mode));
        return;
      }
      orig.chmod(t, mode as fs.Mode);
    },
    utimes: (p: fs.PathLike, atime: unknown, mtime: unknown) => {
      const t = s.norm(String(p));
      if (s.isVirtualPath(t)) {
        s.customMtimes.set(
          t,
          typeof mtime === "number" ? mtime : mtime instanceof Date ? mtime.getTime() : Date.now(),
        );
        return;
      }
      orig.utimes(
        t,
        atime as Parameters<typeof orig.utimes>[1],
        mtime as Parameters<typeof orig.utimes>[2],
      );
    },
    appendFile: (p: fs.PathLike, data: unknown, opts?: unknown) => {
      const t = s.norm(String(p));
      if (s.isVirtualPath(t)) {
        const b =
          typeof data === "string"
            ? Buffer.from(data)
            : Buffer.isBuffer(data)
              ? data
              : Buffer.from(data as Uint8Array);
        const cur = s.vfs.existsSync(t) ? Buffer.from(s.vfs.readFileSync(t)) : Buffer.alloc(0);
        s.vfs.writeFileSync(t, Buffer.concat([cur, b]));
        return;
      }
      orig.appendFile(t, data as string, opts as Parameters<typeof orig.appendFile>[2]);
    },
  };
}
