import { spyOn } from "bun:test";
import * as fs from "node:fs";
import {
  type VirtualMemoryFS,
  type VirtualStats,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const origExistsSync = fs.existsSync;
export const origReadFile = fs.readFileSync;
export const origStat = fs.statSync;
export const origLstat = fs.lstatSync;
export const origReaddir = fs.readdirSync;
export const origRealpath = fs.realpathSync;

export const customMtimes = new Map<string, number>();
export const customModes = new Map<string, number>();
export const virtualSymlinks = new Map<string, string>();
export const openDescriptors = new Map<
  number,
  { path: string; position: number; isAppend?: boolean }
>();
let nextFd = 1000;

export function makeErr(code: string, msg: string): Error {
  const err = new Error(msg);
  (err as NodeJS.ErrnoException).code = code;
  return err;
}

export function computeInode(path: string): number {
  let ino = 0;
  for (let i = 0; i < path.length; i++) ino = (ino * 31 + path.charCodeAt(i)) | 0;
  return Math.abs(ino) + 1;
}

export function makeFsStats(
  s: VirtualStats,
  p: string,
  isBigInt = false,
): fs.Stats | fs.BigIntStats {
  const mtimeMs = customMtimes.get(p) ?? s.mtimeMs;
  const isSymlink = virtualSymlinks.has(p);
  const n = (v: number) => (isBigInt ? BigInt(v) : v);
  const falseFn = () => false;
  const res: Record<string, unknown> = {
    isFile: () => !isSymlink && s.isFile(),
    isDirectory: () => !isSymlink && s.isDirectory(),
    isSymbolicLink: () => isSymlink,
    isBlockDevice: falseFn,
    isCharacterDevice: falseFn,
    isFIFO: falseFn,
    isSocket: falseFn,
    size: n(s.size),
    mtime: new Date(mtimeMs),
    mtimeMs: n(mtimeMs),
    birthtime: s.birthtime,
    birthtimeMs: n(s.birthtimeMs),
    atime: s.atime,
    atimeMs: n(s.atimeMs),
    ctime: s.ctime,
    ctimeMs: n(s.ctimeMs),
    mode: n(customModes.get(p) ?? s.mode),
    dev: n(1),
    ino: n(computeInode(p)),
    nlink: n(1),
    uid: n(0),
    gid: n(0),
    rdev: n(0),
    blksize: n(4096),
    blocks: n(Math.ceil(s.size / 512)),
  };
  if (isBigInt) {
    const toNs = (ms: number) => BigInt(ms) * 1000000n;
    res.mtimeNs = toNs(mtimeMs);
    res.atimeNs = toNs(s.atimeMs);
    res.ctimeNs = toNs(s.ctimeMs);
    res.birthtimeNs = toNs(s.birthtimeMs);
  }
  return res as unknown as fs.Stats;
}

export function moveVirtualDir(memFs: VirtualMemoryFS, sourceDir: string, destDir: string): void {
  memFs.mkdirSync(destDir, { recursive: true });
  for (const entry of memFs.readdirSync(sourceDir, {
    withFileTypes: true,
  }) as unknown as fs.Dirent[]) {
    const sChild = `${sourceDir}/${entry.name}`;
    const dChild = `${destDir}/${entry.name}`;
    if (entry.isDirectory()) moveVirtualDir(memFs, sChild, dChild);
    else {
      memFs.writeFileSync(dChild, memFs.readFileSync(sChild));
      const m = customModes.get(sChild);
      if (m !== undefined) customModes.set(dChild, m);
      const t = customMtimes.get(sChild);
      if (t !== undefined) customMtimes.set(dChild, t);
    }
  }
}

export function renameVirtualEntry(memFs: VirtualMemoryFS, src: string, dst: string): void {
  const stat = memFs.statSync(src);
  if (stat && stat.isDirectory()) {
    moveVirtualDir(memFs, src, dst);
    memFs.rmSync(src, { recursive: true, force: true });
    return;
  }
  const data = memFs.readFileSync(src);
  memFs.unlinkSync(src);
  const ct = customMtimes.get(src);
  if (ct !== undefined) {
    customMtimes.delete(src);
    customMtimes.set(dst, ct);
  }
  const cm = customModes.get(src);
  if (cm !== undefined) {
    customModes.delete(src);
    customModes.set(dst, cm);
  }
  memFs.writeFileSync(dst, data);
}

export function createFdSpies(
  vfs: VirtualMemoryFS,
  statSpy: { getMockImplementation: () => Parameters<typeof fs.statSync>[0] | undefined },
) {
  const openSpy = spyOn(fs, "openSync").mockImplementation((p, flags) => {
    const fd = nextFd++;
    const pathStr = String(p);
    const flagsNum = typeof flags === "number" ? flags : 0;
    const isAppend =
      (flagsNum & fs.constants.O_APPEND) !== 0 ||
      (typeof flags === "string" && flags.includes("a"));
    if (
      (flagsNum & fs.constants.O_CREAT || flagsNum & fs.constants.O_WRONLY || isAppend) &&
      !vfs.existsSync(pathStr)
    )
      vfs.writeFileSync(pathStr, "");
    let initPos = 0;
    if (isAppend && vfs.existsSync(pathStr)) {
      try {
        initPos = vfs.readFileSync(pathStr).byteLength;
      } catch {}
    }
    openDescriptors.set(fd, { path: pathStr, position: initPos, isAppend });
    return fd;
  });

  const closeSpy = spyOn(fs, "closeSync").mockImplementation((fd) => {
    openDescriptors.delete(fd);
  });

  const writeSpy = spyOn(fs, "writeSync").mockImplementation(
    (fd, data, offset, length, position) => {
      const entry = openDescriptors.get(fd);
      if (!entry) throw makeErr("EBADF", `EBADF: bad file descriptor, write '${fd}'`);
      const buf = typeof data === "string" ? Buffer.from(data) : Buffer.from(data as Uint8Array);
      const start = typeof offset === "number" ? offset : 0;
      const len = typeof length === "number" ? length : buf.byteLength - start;
      const chunk = buf.subarray(start, start + len);
      let existing = Buffer.alloc(0);
      try {
        existing = Buffer.from(vfs.readFileSync(entry.path));
      } catch {}
      const pos = entry.isAppend
        ? existing.byteLength
        : typeof position === "number" && position !== null && position >= 0
          ? position
          : entry.position;
      let combined: Buffer;
      if (pos >= existing.byteLength)
        combined = Buffer.concat([existing, Buffer.alloc(pos - existing.byteLength), chunk]);
      else {
        combined = Buffer.alloc(Math.max(existing.byteLength, pos + chunk.byteLength));
        existing.copy(combined, 0);
        chunk.copy(combined, pos);
      }
      vfs.writeFileSync(entry.path, combined);
      entry.position = pos + chunk.byteLength;
      return chunk.byteLength;
    },
  );

  const readSyncSpy = spyOn(fs, "readSync").mockImplementation(
    (fd, buffer, offset, length, position) => {
      const entry = openDescriptors.get(fd);
      if (!entry) throw makeErr("EBADF", `EBADF: bad file descriptor, read '${fd}'`);
      let fileBytes: Uint8Array | Buffer;
      if (vfs.existsSync(entry.path)) fileBytes = vfs.readFileSync(entry.path);
      else if (!entry.path.startsWith("/virtual")) {
        try {
          fileBytes = origReadFile(entry.path);
        } catch {
          fileBytes = vfs.readFileSync(entry.path);
        }
      } else fileBytes = vfs.readFileSync(entry.path);
      const data = Buffer.from(fileBytes);
      const pos =
        typeof position === "number" && position !== null && position >= 0
          ? position
          : entry.position;
      if (pos >= data.byteLength) return 0;
      const start = typeof offset === "number" ? offset : 0;
      const len = typeof length === "number" ? length : buffer.byteLength - start;
      const toRead = Math.min(len, data.byteLength - pos);
      data.copy(buffer as Buffer, start, pos, pos + toRead);
      entry.position = pos + toRead;
      return toRead;
    },
  );

  const fstatSpy = spyOn(fs, "fstatSync").mockImplementation((fd, opts) =>
    (statSpy.getMockImplementation() as unknown as typeof fs.statSync)(
      openDescriptors.get(fd)?.path ?? "/virtual",
      opts as Parameters<typeof fs.statSync>[1],
    ),
  );

  const ftruncateSpy = spyOn(fs, "ftruncateSync").mockImplementation((fd, len) => {
    const entry = openDescriptors.get(fd);
    if (!entry) throw makeErr("EBADF", `EBADF: bad file descriptor, ftruncate '${fd}'`);
    vfs.writeFileSync(
      entry.path,
      Buffer.from(vfs.readFileSync(entry.path)).subarray(0, typeof len === "number" ? len : 0),
    );
  });

  const fchmodSpy = spyOn(fs, "fchmodSync").mockImplementation((fd, mode) => {
    const entry = openDescriptors.get(fd);
    if (!entry) throw makeErr("EBADF", `EBADF: bad file descriptor, fchmod '${fd}'`);
    customModes.set(entry.path, typeof mode === "string" ? parseInt(mode, 8) : mode);
  });

  const fsyncSpy = spyOn(fs, "fsyncSync").mockImplementation(() => {});

  const realpathSpy = spyOn(fs, "realpathSync").mockImplementation((p) => {
    const s = String(p);
    if (s.startsWith("/virtual")) return s;
    try {
      return origRealpath(p);
    } catch {
      return s;
    }
  });

  return [
    openSpy,
    closeSpy,
    writeSpy,
    readSyncSpy,
    fstatSpy,
    ftruncateSpy,
    fchmodSpy,
    fsyncSpy,
    realpathSpy,
  ];
}
