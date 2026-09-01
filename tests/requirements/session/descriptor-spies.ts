/**
 * @file descriptor-spies.ts
 * Spies for open descriptors, truncation, fstat, and platform flock for requirements domain.
 */

import { spyOn, type Mock } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as platform from "../../../olt/scripts/src/platform/index.ts";
import * as flockFfi from "../../../olt/scripts/src/platform/fs/flock-ffi.ts";
import { handleRw, isVirtualPath, makeFsStats, norm } from "./handlers.ts";
import { orig, type VirtualRequirementsState } from "./types.ts";

export function createDescriptorSpies(
  s: VirtualRequirementsState,
): Array<{ mockRestore: () => void }> {
  const spy = <K extends keyof typeof fs>(k: K, fn: unknown) =>
    spyOn(fs, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  return [
    spy("openSync", (p: fs.PathLike, flags: string | number) => {
      const t = norm(String(p));
      if (!isVirtualPath(t) && !s.vfs.existsSync(t)) {
        return orig.openSync(t, flags as Parameters<typeof orig.openSync>[1]);
      }
      const numFlags = typeof flags === "number" ? flags : 0;
      const isW =
        (numFlags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0;
      const isA = (numFlags & fs.constants.O_APPEND) !== 0;
      if (!isW && !s.vfs.existsSync(t)) {
        const err = new Error(`ENOENT: no such file or directory, open '${t}'`);
        (err as unknown as { code: string }).code = "ENOENT";
        throw err;
      }
      if (isW && !s.vfs.existsSync(t) && (numFlags & (fs.constants.O_DIRECTORY ?? 0)) === 0) {
        const parent = path.dirname(t);
        if (parent && !s.vfs.existsSync(parent)) {
          s.vfs.mkdirSync(parent, { recursive: true });
        }
        s.vfs.writeFileSync(t, "");
      }
      const len =
        s.vfs.existsSync(t) && !s.vfs.statSync(t)?.isDirectory() ? s.vfs.readFileSync(t).length : 0;
      const fd = s.nextFd++;
      s.openDescriptors.set(fd, { path: t, position: isA ? len : 0, flags: numFlags });
      return fd;
    }),
    spy("closeSync", (fd: number) => {
      if (s.openDescriptors.has(fd)) {
        s.openDescriptors.delete(fd);
        return;
      }
      orig.closeSync(fd);
    }),
    spy("readSync", (fd: number, b: unknown, o: unknown, l: unknown, pos: unknown) =>
      handleRw(s, fd, b, o, l, pos, false),
    ),
    spy("writeSync", (fd: number, b: unknown, o: unknown, l: unknown, pos: unknown) =>
      handleRw(s, fd, b, o, l, pos, true),
    ),
    spy("ftruncateSync", (fd: number, len?: number | null) => {
      const entry = s.openDescriptors.get(fd);
      if (!entry) return orig.ftruncateSync(fd, len ?? 0);
      const targetLen = typeof len === "number" ? len : 0;
      const data = s.vfs.existsSync(entry.path)
        ? Buffer.from(s.vfs.readFileSync(entry.path))
        : Buffer.alloc(0);
      const newBuf = Buffer.alloc(targetLen);
      data.copy(newBuf, 0, 0, Math.min(data.length, targetLen));
      s.vfs.writeFileSync(entry.path, newBuf);
      entry.position = Math.min(entry.position, targetLen);
    }),
    spy("truncateSync", (p: fs.PathLike, len?: number | null) => {
      const t = norm(String(p));
      if (isVirtualPath(t) || s.vfs.existsSync(t)) {
        const targetLen = typeof len === "number" ? len : 0;
        const data = s.vfs.existsSync(t) ? Buffer.from(s.vfs.readFileSync(t)) : Buffer.alloc(0);
        const newBuf = Buffer.alloc(targetLen);
        data.copy(newBuf, 0, 0, Math.min(data.length, targetLen));
        s.vfs.writeFileSync(t, newBuf);
        return;
      }
      orig.truncateSync(t, len ?? 0);
    }),
    spy("fstatSync", (fd: number) => {
      const e = s.openDescriptors.get(fd);
      if (e) {
        const vs = s.vfs.statSync(e.path);
        if (vs) return makeFsStats(s, vs, e.path);
      }
      return orig.fstatSync(fd);
    }),
    spy("fchmodSync", (fd: number, m: fs.Mode) => {
      const entry = s.openDescriptors.get(fd);
      if (entry) s.customModes.set(entry.path, typeof m === "string" ? parseInt(m, 8) : m);
      else orig.fchmodSync(fd, m);
    }),
    spy("futimesSync", (fd: number, _a: unknown, m: number | string | Date) => {
      const entry = s.openDescriptors.get(fd);
      if (entry) {
        s.customMtimes.set(
          entry.path,
          typeof m === "number" ? m : m instanceof Date ? m.getTime() : Date.now(),
        );
      } else {
        orig.futimesSync(
          fd,
          _a as Parameters<typeof orig.futimesSync>[1],
          m as Parameters<typeof orig.futimesSync>[2],
        );
      }
    }),
    spy("fsyncSync", (fd: number) => {
      if (!s.openDescriptors.has(fd)) {
        orig.fsyncSync(fd);
      }
    }),
    spyOn(platform, "tryExclusiveFlock").mockReturnValue(true) as never,
    spyOn(platform, "releaseFlock").mockImplementation(() => {}) as never,
    spyOn(flockFfi, "tryExclusiveFlock").mockReturnValue(true) as never,
    spyOn(flockFfi, "releaseFlock").mockImplementation(() => {}) as never,
  ];
}
