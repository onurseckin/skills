import { spyOn, type Mock } from "bun:test";
import * as fs from "node:fs";
import { dirname, resolve } from "node:path";
import { VirtualMemoryFS, VirtualStats } from "../../olt/scripts/src/testing/virtual-fs/index.ts";

export const vfs = new VirtualMemoryFS();
export const customModes = new Map<string, number>();
export const customMtimes = new Map<string, number>();
export const deletedPaths = new Set<string>();

let tmpCounter = 0;
let spies: Array<Mock<(...args: unknown[]) => unknown> | { mockRestore: () => void }> = [];

const origExistsSync = fs.existsSync.bind(fs);
const origReadFileSync = fs.readFileSync.bind(fs);
const origReaddirSync = fs.readdirSync.bind(fs);
const origStatSync = fs.statSync.bind(fs);
const origLstatSync = fs.lstatSync.bind(fs);
const origRealpathSync = fs.realpathSync.bind(fs);

export const normPath = (p: string | number): string => resolve(String(p)).replace(/\\/g, "/");

function makeFsError(msg: string, code: string): Error {
  return Object.assign(new Error(msg), { code });
}

export function makeStats(s: VirtualStats, targetPath: string): fs.Stats {
  const norm = normPath(targetPath);
  const mtimeMs = customMtimes.get(norm) ?? s.mtimeMs;
  const atimeMs = s.atimeMs,
    ctimeMs = s.ctimeMs,
    birthtimeMs = s.birthtimeMs;
  const mode = customModes.get(norm) ?? (s.isDirectory() ? 0o755 : 0o644);
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const gid = typeof process.getgid === "function" ? process.getgid() : 0;

  return {
    isFile: () => s.isFile(),
    isDirectory: () => s.isDirectory(),
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 1,
    ino: 1,
    mode,
    nlink: 1,
    uid,
    gid,
    rdev: 0,
    size: s.size,
    blksize: 4096,
    blocks: Math.ceil(s.size / 512),
    atimeMs,
    mtimeMs,
    ctimeMs,
    birthtimeMs,
    atime: new Date(atimeMs),
    mtime: new Date(mtimeMs),
    ctime: new Date(ctimeMs),
    birthtime: new Date(birthtimeMs),
  } as unknown as fs.Stats;
}

export function handleRenameSync(src: fs.PathLike, dst: fs.PathLike): void {
  const srcStr = normPath(String(src)),
    dstStr = normPath(String(dst));
  const stat = vfs.statSync(srcStr, { throwIfNoEntry: false });
  if (!stat) {
    throw makeFsError(
      `ENOENT: no such file or directory, rename '${srcStr}' -> '${dstStr}'`,
      "ENOENT",
    );
  }
  const cMode = customModes.get(srcStr),
    cTime = customMtimes.get(srcStr);
  if (cMode !== undefined) {
    customModes.delete(srcStr);
    customModes.set(dstStr, cMode);
  }
  if (cTime !== undefined) {
    customMtimes.delete(srcStr);
    customMtimes.set(dstStr, cTime);
  }
  if (stat.isDirectory()) {
    vfs.mkdirSync(dstStr, { recursive: true });
    for (const entry of vfs.readdirSync(srcStr, { recursive: true }) as string[]) {
      const cSrc = `${srcStr}/${entry}`,
        cDst = `${dstStr}/${entry}`;
      if (vfs.statSync(cSrc, { throwIfNoEntry: false })?.isDirectory()) {
        vfs.mkdirSync(cDst, { recursive: true });
      } else {
        vfs.writeFileSync(cDst, vfs.readFileSync(cSrc));
      }
    }
    vfs.rmSync(srcStr, { recursive: true, force: true });
  } else {
    const parent = dirname(dstStr);
    if (!vfs.existsSync(parent)) vfs.mkdirSync(parent, { recursive: true });
    vfs.writeFileSync(dstStr, vfs.readFileSync(srcStr));
    vfs.unlinkSync(srcStr);
  }
}

function handleStat(p: fs.PathLike, opts?: fs.StatOptions, isLstat = false): fs.Stats | undefined {
  const norm = normPath(String(p));
  const throwIfNoEntry =
    typeof opts === "object" && opts !== null && "throwIfNoEntry" in opts
      ? Boolean(opts.throwIfNoEntry)
      : true;
  if (deletedPaths.has(norm)) {
    if (!throwIfNoEntry) return undefined;
    throw makeFsError(`ENOENT: no such file or directory, stat '${norm}'`, "ENOENT");
  }
  const s = vfs.statSync(norm, { throwIfNoEntry: false });
  if (s) return makeStats(s, norm);
  if (!norm.startsWith("/virtual")) {
    try {
      return isLstat
        ? origLstatSync(p, opts as Parameters<typeof origLstatSync>[1])
        : origStatSync(p, opts as Parameters<typeof origStatSync>[1]);
    } catch (e) {
      if (!throwIfNoEntry) return undefined;
      throw e;
    }
  }
  if (!throwIfNoEntry) return undefined;
  throw makeFsError(`ENOENT: no such file or directory, stat '${norm}'`, "ENOENT");
}

export function setupVirtualHealthFS(): VirtualMemoryFS {
  cleanupVirtualHealthFS();
  vfs.reset();
  customModes.clear();
  customMtimes.clear();
  deletedPaths.clear();

  const spy = <K extends keyof typeof fs>(k: K, fn: unknown) =>
    spyOn(fs, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  spies = [
    spy("existsSync", (p: fs.PathLike) => {
      const norm = normPath(String(p));
      if (deletedPaths.has(norm)) return false;
      if (vfs.existsSync(norm)) return true;
      if (norm.startsWith("/virtual")) return false;
      try {
        return origExistsSync(p);
      } catch {
        return false;
      }
    }),
    spy("mkdirSync", (p: fs.PathLike, opts?: fs.MakeDirectoryOptions | boolean) => {
      const norm = normPath(String(p));
      deletedPaths.delete(norm);
      const res = vfs.mkdirSync(norm, opts as Parameters<typeof vfs.mkdirSync>[1]);
      if (typeof opts === "object" && opts !== null && typeof opts.mode === "number") {
        customModes.set(norm, opts.mode);
      }
      return res;
    }),
    spy("mkdtempSync", (prefix: string) => {
      const id = ++tmpCounter;
      const target = `/virtual/health-${normPath(prefix).replace(/[/:]/g, "-")}-${id}`;
      deletedPaths.delete(target);
      vfs.mkdirSync(target, { recursive: true });
      return target;
    }),
    spy("writeFileSync", (p: fs.PathOrFileDescriptor, d: string | NodeJS.ArrayBufferView) => {
      const target = normPath(String(p));
      deletedPaths.delete(target);
      const parent = dirname(target);
      if (!vfs.existsSync(parent)) vfs.mkdirSync(parent, { recursive: true });
      vfs.writeFileSync(target, typeof d === "string" ? d : Buffer.from(d as Uint8Array));
    }),
    spy(
      "readFileSync",
      (
        p: fs.PathOrFileDescriptor,
        opts?: { encoding?: BufferEncoding | null } | BufferEncoding | null,
      ) => {
        const norm = normPath(String(p));
        if (deletedPaths.has(norm)) {
          throw makeFsError(`ENOENT: no such file or directory, open '${norm}'`, "ENOENT");
        }
        if (vfs.existsSync(norm)) {
          if (vfs.statSync(norm, { throwIfNoEntry: false })?.isDirectory()) {
            throw makeFsError(`EISDIR: illegal operation on a directory, read '${norm}'`, "EISDIR");
          }
          return typeof opts === "string" || (typeof opts === "object" && opts?.encoding)
            ? vfs.readFileSync(norm, "utf8")
            : Buffer.from(vfs.readFileSync(norm));
        }
        if (!norm.startsWith("/virtual")) {
          try {
            return origReadFileSync(
              p as Parameters<typeof origReadFileSync>[0],
              opts as Parameters<typeof origReadFileSync>[1],
            );
          } catch {}
        }
        throw makeFsError(`ENOENT: no such file or directory, open '${norm}'`, "ENOENT");
      },
    ),
    spy(
      "readdirSync",
      (p: fs.PathLike, opts?: { withFileTypes?: boolean } | BufferEncoding | null) => {
        const norm = normPath(String(p));
        if (deletedPaths.has(norm)) {
          throw makeFsError(`ENOENT: no such file or directory, scandir '${norm}'`, "ENOENT");
        }
        if (vfs.existsSync(norm)) {
          return (typeof opts === "object" && opts?.withFileTypes
            ? vfs.readdirSync(norm, { withFileTypes: true })
            : vfs.readdirSync(norm)) as unknown as fs.Dirent[] & string[];
        }
        if (!norm.startsWith("/virtual")) {
          try {
            return origReaddirSync(
              p,
              opts as Parameters<typeof origReaddirSync>[1],
            ) as unknown as fs.Dirent[] & string[];
          } catch {}
        }
        throw makeFsError(`ENOENT: no such file or directory, scandir '${norm}'`, "ENOENT");
      },
    ),
    spy("statSync", (p: fs.PathLike, opts?: fs.StatOptions) => handleStat(p, opts, false)),
    spy("lstatSync", (p: fs.PathLike, opts?: fs.StatOptions) => handleStat(p, opts, true)),
    spy("realpathSync", (p: fs.PathLike) => {
      const norm = normPath(String(p));
      if (norm.startsWith("/virtual") || vfs.existsSync(norm)) return norm;
      try {
        return origRealpathSync(p);
      } catch {
        return norm;
      }
    }),
    spy("renameSync", handleRenameSync),
    spy("unlinkSync", (p: fs.PathLike) => {
      const norm = normPath(String(p));
      deletedPaths.add(norm);
      customModes.delete(norm);
      customMtimes.delete(norm);
      if (vfs.existsSync(norm)) vfs.unlinkSync(norm);
    }),
    spy("copyFileSync", (src: fs.PathLike, dst: fs.PathLike) => {
      const srcStr = normPath(String(src)),
        dstStr = normPath(String(dst));
      deletedPaths.delete(dstStr);
      const parent = dirname(dstStr);
      if (!vfs.existsSync(parent)) vfs.mkdirSync(parent, { recursive: true });
      vfs.writeFileSync(dstStr, vfs.readFileSync(srcStr));
    }),
    spy("chmodSync", (p: fs.PathLike, mode: fs.Mode) => {
      customModes.set(normPath(String(p)), typeof mode === "number" ? mode : 0o644);
    }),
    spy("utimesSync", (p: fs.PathLike, _a: unknown, m: number | string | Date) => {
      const mtimeMs = typeof m === "number" ? m : m instanceof Date ? m.getTime() : Date.now();
      customMtimes.set(normPath(String(p)), mtimeMs);
    }),
    spy("rmSync", (p: fs.PathLike, opts?: fs.RmOptions) => {
      const norm = normPath(String(p));
      deletedPaths.add(norm);
      customModes.delete(norm);
      customMtimes.delete(norm);
      if (vfs.existsSync(norm)) vfs.rmSync(norm, opts as Parameters<typeof vfs.rmSync>[1]);
    }),
  ];

  return vfs;
}

export function ensureVirtualHealthFS(): VirtualMemoryFS {
  return spies.length === 0 ? setupVirtualHealthFS() : vfs;
}

export function cleanupVirtualHealthFS(): void {
  for (const s of spies) {
    try {
      s.mockRestore();
    } catch {}
  }
  spies = [];
  vfs.reset();
  customModes.clear();
  customMtimes.clear();
  deletedPaths.clear();
}
