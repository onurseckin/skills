import { spyOn, type Mock } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { dirname } from "node:path";
import * as platform from "../../olt/scripts/src/platform/index.ts";
import { VirtualStats } from "../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  clearInMemoryCursors,
  clearInMemoryMailboxStore,
  clearInMemoryQuarantines,
  resetInMemoryMailboxDirs,
  setInMemoryStreamMode,
} from "../../olt/scripts/src/communication/mailbox/index.ts";
import {
  resetInMemoryLocks,
  setInMemoryLocking,
} from "../../olt/scripts/src/communication/locking/safe-lock.ts";
import {
  customMtimes,
  getNextTmpId,
  handleFlock,
  handleMkdirSync,
  handleOpenSync,
  handleReadSync,
  handleReleaseFlock,
  handleRenameSync,
  handleWriteSync,
  inodeLockOwners,
  inodeMap,
  makeStats,
  normPath,
  openDescriptors,
  vfs,
} from "./virtual-state.ts";

export { normPath, getInode, makeStats, vfs } from "./virtual-state.ts";

const origReadFileSync = fs.readFileSync.bind(fs);
const origStatSync = fs.statSync.bind(fs);
const origExistsSync = fs.existsSync.bind(fs);

let spies: Array<Mock<(...args: unknown[]) => unknown> | { mockRestore: () => void }> = [];

export function setupVirtualCommunicationFS() {
  cleanupVirtualCommunicationFS();
  customMtimes.clear();
  openDescriptors.clear();
  inodeMap.clear();
  inodeLockOwners.clear();

  const spy = <K extends keyof typeof fs>(k: K, fn: unknown) =>
    spyOn(fs, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  const spyP = <K extends keyof typeof fsp>(k: K, fn: unknown) =>
    spyOn(fsp, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  spies = [
    spy("existsSync", (p: fs.PathLike) => {
      const norm = normPath(String(p));
      return vfs.existsSync(norm) || origExistsSync(p);
    }),
    spy("mkdirSync", (p: fs.PathLike, opts?: fs.MakeDirectoryOptions | boolean) =>
      handleMkdirSync(p, opts),
    ),
    spy("mkdtempSync", (prefix: string) => {
      const id = getNextTmpId();
      const target = `/tmp/mock-tmp-${normPath(prefix).replace(/[/:]/g, "-")}-${id}`;
      vfs.mkdirSync(target, { recursive: true });
      return target;
    }),
    spy("writeFileSync", (p: fs.PathOrFileDescriptor, d: string | NodeJS.ArrayBufferView) => {
      const target = normPath(String(p));
      const parent = dirname(target);
      if (!vfs.existsSync(parent)) handleMkdirSync(parent, { recursive: true });
      vfs.writeFileSync(target, typeof d === "string" ? d : Buffer.from(d as Uint8Array));
    }),
    spy(
      "readFileSync",
      (
        p: fs.PathOrFileDescriptor,
        opts?: { encoding?: BufferEncoding | null } | BufferEncoding | null,
      ) => {
        if (typeof p === "number") {
          const entry = openDescriptors.get(p);
          if (!entry || !vfs.existsSync(entry.path)) return "";
          return typeof opts === "string" || (typeof opts === "object" && opts?.encoding)
            ? vfs.readFileSync(entry.path, "utf8")
            : Buffer.from(vfs.readFileSync(entry.path));
        }
        const norm = normPath(String(p));
        if (vfs.existsSync(norm)) {
          if (vfs.statSync(norm, { throwIfNoEntry: false })?.isDirectory()) {
            const err = new Error(`EISDIR: illegal operation on a directory, read '${norm}'`);
            (err as unknown as { code: string }).code = "EISDIR";
            throw err;
          }
          return typeof opts === "string" || (typeof opts === "object" && opts?.encoding)
            ? vfs.readFileSync(norm, "utf8")
            : Buffer.from(vfs.readFileSync(norm));
        }
        try {
          return origReadFileSync(
            p as Parameters<typeof origReadFileSync>[0],
            opts as Parameters<typeof origReadFileSync>[1],
          );
        } catch {
          const err = new Error(`ENOENT: no such file or directory, open '${norm}'`);
          (err as unknown as { code: string }).code = "ENOENT";
          throw err;
        }
      },
    ),
    spy(
      "readdirSync",
      (p: fs.PathLike, opts?: { withFileTypes?: boolean } | BufferEncoding | null) => {
        const norm = normPath(String(p));
        return (typeof opts === "object" && opts?.withFileTypes
          ? vfs.readdirSync(norm, { withFileTypes: true })
          : vfs.readdirSync(norm)) as unknown as fs.Dirent[] & string[];
      },
    ),
    spy("statSync", (p: fs.PathLike) => {
      const norm = normPath(String(p));
      const s = vfs.statSync(norm, { throwIfNoEntry: false });
      if (s) return makeStats(s, norm);
      try {
        return origStatSync(p);
      } catch {
        const err = new Error(`ENOENT: no such file or directory, stat '${norm}'`);
        (err as unknown as { code: string }).code = "ENOENT";
        throw err;
      }
    }),
    spy("lstatSync", (p: fs.PathLike) => {
      const norm = normPath(String(p));
      const s = vfs.statSync(norm, { throwIfNoEntry: false });
      if (s) return makeStats(s, norm);
      try {
        return origStatSync(p);
      } catch {
        const err = new Error(`ENOENT: no such file or directory, lstat '${norm}'`);
        (err as unknown as { code: string }).code = "ENOENT";
        throw err;
      }
    }),
    spy("utimesSync", (p: fs.PathLike, _a: unknown, m: number | string | Date) => {
      const mtimeMs = typeof m === "number" ? m : m instanceof Date ? m.getTime() : Date.now();
      customMtimes.set(normPath(String(p)), mtimeMs);
    }),
    spy("renameSync", handleRenameSync),
    spy("unlinkSync", (p: fs.PathLike) => {
      const norm = normPath(String(p));
      inodeMap.delete(norm);
      customMtimes.delete(norm);
      vfs.unlinkSync(norm);
    }),
    spy("openSync", handleOpenSync),
    spy("closeSync", (fd: number) => {
      if (!openDescriptors.has(fd)) {
        const err = new Error(`EBADF: bad file descriptor, close`);
        (err as unknown as { code: string }).code = "EBADF";
        throw err;
      }
      handleReleaseFlock(fd);
      openDescriptors.delete(fd);
    }),
    spy("fstatSync", (fd: number) => {
      const entry = openDescriptors.get(fd);
      const target = entry?.path ?? "/virtual";
      const s =
        vfs.statSync(target, { throwIfNoEntry: false }) ??
        new VirtualStats({ isDir: false, size: 0 });
      return makeStats(s, target);
    }),
    spy("ftruncateSync", (fd: number, len = 0) => {
      const entry = openDescriptors.get(fd);
      if (entry && vfs.existsSync(entry.path)) {
        const data = Buffer.from(vfs.readFileSync(entry.path)).subarray(0, len);
        vfs.writeFileSync(entry.path, data);
        entry.position = Math.min(entry.position, len);
      }
    }),
    spy("truncateSync", (p: fs.PathLike, len = 0) => {
      const norm = normPath(String(p));
      if (vfs.existsSync(norm)) {
        const data = Buffer.from(vfs.readFileSync(norm)).subarray(0, len);
        vfs.writeFileSync(norm, data);
      }
    }),
    spy("readSync", handleReadSync),
    spy("writeSync", handleWriteSync),
    spy("appendFileSync", (p: fs.PathOrFileDescriptor, d: string | Uint8Array) => {
      const target = normPath(String(p));
      const parent = dirname(target);
      if (!vfs.existsSync(parent)) handleMkdirSync(parent, { recursive: true });
      const prev = vfs.existsSync(target) ? vfs.readFileSync(target, "utf8") : "";
      vfs.writeFileSync(
        target,
        prev + (typeof d === "string" ? d : Buffer.from(d as Uint8Array).toString("utf8")),
      );
    }),
    spy("fsyncSync", () => {}),
    spy("rmSync", (p: fs.PathLike, opts?: fs.RmOptions) => {
      const norm = normPath(String(p));
      inodeMap.delete(norm);
      customMtimes.delete(norm);
      vfs.rmSync(norm, opts as Parameters<typeof vfs.rmSync>[1]);
    }),
    spyP("mkdir", async (p: fs.PathLike, opts?: fs.MakeDirectoryOptions | boolean) => {
      handleMkdirSync(p, opts);
    }),
    spyP("writeFile", async (p: fs.PathLike, d: string | Uint8Array) => {
      const target = normPath(String(p));
      const parent = dirname(target);
      if (!vfs.existsSync(parent)) handleMkdirSync(parent, { recursive: true });
      vfs.writeFileSync(target, typeof d === "string" ? d : Buffer.from(d as Uint8Array));
    }),
    spyP(
      "readFile",
      async (p: fs.PathLike, opts?: { encoding?: BufferEncoding } | BufferEncoding | null) => {
        const norm = normPath(String(p));
        if (vfs.existsSync(norm)) {
          return (
            typeof opts === "string" || (typeof opts === "object" && opts?.encoding)
              ? vfs.readFileSync(norm, "utf8")
              : Buffer.from(vfs.readFileSync(norm))
          ) as never;
        }
        return origReadFileSync(
          p as Parameters<typeof origReadFileSync>[0],
          opts as Parameters<typeof origReadFileSync>[1],
        ) as never;
      },
    ),
    spyP(
      "readdir",
      async (p: fs.PathLike, opts?: { withFileTypes?: boolean } | BufferEncoding | null) => {
        const norm = normPath(String(p));
        return (typeof opts === "object" && opts?.withFileTypes
          ? vfs.readdirSync(norm, { withFileTypes: true })
          : vfs.readdirSync(norm)) as unknown as fs.Dirent[] & string[];
      },
    ),
    spyP("rm", async (p: fs.PathLike, opts?: fs.RmOptions) => {
      const norm = normPath(String(p));
      inodeMap.delete(norm);
      customMtimes.delete(norm);
      vfs.rmSync(norm, opts as Parameters<typeof vfs.rmSync>[1]);
    }),
    spyOn(platform, "tryExclusiveFlock").mockImplementation(handleFlock as never),
    spyOn(platform, "releaseFlock").mockImplementation(handleReleaseFlock as never),
  ];

  return vfs;
}

export function cleanupVirtualCommunicationFS(): void {
  for (const s of spies) {
    try {
      s.mockRestore();
    } catch {}
  }
  spies = [];
  openDescriptors.clear();
  customMtimes.clear();
  inodeMap.clear();
  inodeLockOwners.clear();
  vfs.reset();
  clearInMemoryCursors();
  clearInMemoryMailboxStore();
  resetInMemoryMailboxDirs();
  clearInMemoryQuarantines();
  resetInMemoryLocks();
  setInMemoryLocking(false);
  setInMemoryStreamMode(false);
}
