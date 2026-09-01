import { spyOn } from "bun:test";
import * as fs from "node:fs";
import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  createFdSpies,
  customModes,
  customMtimes,
  makeErr,
  makeFsStats,
  openDescriptors,
  origExistsSync,
  origLstat,
  origReadFile,
  origReaddir,
  origStat,
  renameVirtualEntry,
  virtualSymlinks,
} from "./browser-vfs-helpers.ts";
import { createFspSpies, createProcessSpies } from "./browser-vfs-proc.ts";

let vfs = new VirtualMemoryFS();
let spies: Array<{ mockRestore: () => void }> = [];
let dirCounter = 0;
export const deletedPaths = new Set<string>();

function createCoreIoSpies(memFs: VirtualMemoryFS) {
  const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
    const s = String(p);
    if (deletedPaths.has(s)) return false;
    if (memFs.existsSync(s)) return true;
    if (s.startsWith("/virtual")) return false;
    try {
      return origExistsSync(p);
    } catch {
      return false;
    }
  });

  const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation((p, opts) => {
    const s = String(p);
    deletedPaths.delete(s);
    return memFs.mkdirSync(s, opts as Parameters<typeof memFs.mkdirSync>[1]);
  });

  const writeFileSpy = spyOn(fs, "writeFileSync").mockImplementation((p, data, opts) => {
    const target = String(p);
    deletedPaths.delete(target);
    const lastSlash = target.lastIndexOf("/");
    if (lastSlash > 0) {
      const parent = target.substring(0, lastSlash);
      if (!memFs.existsSync(parent)) memFs.mkdirSync(parent, { recursive: true });
    }
    memFs.writeFileSync(target, typeof data === "string" ? data : Buffer.from(data as Uint8Array));
    if (typeof opts === "object" && opts !== null && typeof opts.mode === "number")
      customModes.set(target, opts.mode);
  });

  const appendFileSpy = spyOn(fs, "appendFileSync").mockImplementation((p, data) => {
    const target = String(p);
    deletedPaths.delete(target);
    const buf = typeof data === "string" ? Buffer.from(data) : Buffer.from(data as Uint8Array);
    let existing = Buffer.alloc(0);
    try {
      existing = Buffer.from(memFs.readFileSync(target));
    } catch {}
    memFs.writeFileSync(target, Buffer.concat([existing, buf]));
  });

  const readFileSpy = spyOn(fs, "readFileSync").mockImplementation((p, opts) => {
    const target = typeof p === "number" ? (openDescriptors.get(p)?.path ?? "") : String(p);
    if (deletedPaths.has(target))
      throw makeErr("ENOENT", `ENOENT: no such file or directory, open '${target}'`);
    if (memFs.existsSync(target)) {
      return typeof opts === "string" || (typeof opts === "object" && opts?.encoding)
        ? memFs.readFileSync(target, "utf8")
        : memFs.readFileSync(target);
    }
    if (!target.startsWith("/virtual")) {
      try {
        return origReadFile(target, opts as Parameters<typeof origReadFile>[1]) as string | Buffer;
      } catch {
        return memFs.readFileSync(target);
      }
    }
    return memFs.readFileSync(target);
  });

  const readdirSpy = spyOn(fs, "readdirSync").mockImplementation((p, opts) => {
    const target = String(p);
    if (deletedPaths.has(target))
      throw makeErr("ENOENT", `ENOENT: no such file or directory, scandir '${target}'`);
    if (memFs.existsSync(target)) {
      return (typeof opts === "object" && opts?.withFileTypes
        ? memFs.readdirSync(target, { withFileTypes: true })
        : memFs.readdirSync(target)) as unknown as string[];
    }
    if (!target.startsWith("/virtual"))
      return origReaddir(p, opts as Parameters<typeof origReaddir>[1]) as unknown as string[];
    return memFs.readdirSync(target) as unknown as string[];
  });

  const opendirSpy = spyOn(fs, "opendirSync").mockImplementation((p) => {
    const s = String(p);
    const dirents = (memFs.existsSync(s)
      ? memFs.readdirSync(s, { withFileTypes: true })
      : []) as unknown as fs.Dirent[];
    let idx = 0;
    return {
      path: s,
      readSync: () => (idx >= dirents.length ? null : dirents[idx++]),
      closeSync: () => {},
      [Symbol.iterator]: function* () {
        while (idx < dirents.length) yield dirents[idx++];
      },
    } as unknown as fs.Dir;
  });

  const statHelper = (p: fs.PathLike, isLstat: boolean, opts?: unknown) => {
    const s = String(p);
    const isBigInt =
      typeof opts === "object" && opts !== null && Boolean((opts as { bigint?: boolean }).bigint);
    if (deletedPaths.has(s))
      throw makeErr(
        "ENOENT",
        `ENOENT: no such file or directory, ${isLstat ? "lstat" : "stat"} '${s}'`,
      );
    if (memFs.existsSync(s)) {
      const st = memFs.statSync(s);
      if (st) return makeFsStats(st, s, isBigInt) as fs.Stats;
    }
    if (!s.startsWith("/virtual")) {
      try {
        return (
          isLstat
            ? origLstat(p, opts as Parameters<typeof origLstat>[1])
            : origStat(p, opts as Parameters<typeof origStat>[1])
        ) as fs.Stats;
      } catch {}
    }
    const st = memFs.statSync(s);
    if (!st)
      throw makeErr(
        "ENOENT",
        `ENOENT: no such file or directory, ${isLstat ? "lstat" : "stat"} '${s}'`,
      );
    return makeFsStats(st, s, isBigInt) as fs.Stats;
  };

  const statSpy = spyOn(fs, "statSync").mockImplementation((p, opts) => statHelper(p, false, opts));
  const lstatSpy = spyOn(fs, "lstatSync").mockImplementation((p, opts) =>
    statHelper(p, true, opts),
  );

  const utimesSpy = spyOn(fs, "utimesSync").mockImplementation((p, _atime, mtime) => {
    customMtimes.set(
      String(p),
      typeof mtime === "number" ? mtime : mtime instanceof Date ? mtime.getTime() : Date.now(),
    );
  });

  const renameSpy = spyOn(fs, "renameSync").mockImplementation((src, dst) => {
    const srcStr = String(src);
    const dstStr = String(dst);
    deletedPaths.delete(dstStr);
    renameVirtualEntry(memFs, srcStr, dstStr);
  });

  const chmodSpy = spyOn(fs, "chmodSync").mockImplementation((p, mode) => {
    customModes.set(String(p), typeof mode === "string" ? parseInt(mode, 8) : mode);
  });

  const rmSpy = spyOn(fs, "rmSync").mockImplementation((p, opts) => {
    const s = String(p);
    deletedPaths.add(s);
    if (memFs.existsSync(s)) memFs.rmSync(s, opts as Parameters<typeof memFs.rmSync>[1]);
  });

  const unlinkSpy = spyOn(fs, "unlinkSync").mockImplementation((p) => {
    const s = String(p);
    deletedPaths.add(s);
    if (memFs.existsSync(s)) memFs.unlinkSync(s);
  });

  const linkSpy = spyOn(fs, "linkSync").mockImplementation((src, dst) => {
    deletedPaths.delete(String(dst));
    memFs.writeFileSync(String(dst), memFs.readFileSync(String(src)));
  });

  const symlinkSpy = spyOn(fs, "symlinkSync").mockImplementation((target, p) => {
    const s = String(p);
    deletedPaths.delete(s);
    virtualSymlinks.set(s, String(target));
    memFs.writeFileSync(s, "");
  });

  const copyFileSpy = spyOn(fs, "copyFileSync").mockImplementation((src, dst) => {
    deletedPaths.delete(String(dst));
    memFs.writeFileSync(String(dst), memFs.readFileSync(String(src)));
  });

  return {
    spies: [
      existsSpy,
      mkdirSpy,
      writeFileSpy,
      appendFileSpy,
      readFileSpy,
      readdirSpy,
      opendirSpy,
      statSpy,
      lstatSpy,
      utimesSpy,
      renameSpy,
      chmodSpy,
      rmSpy,
      unlinkSpy,
      linkSpy,
      symlinkSpy,
      copyFileSpy,
    ],
    statSpy,
    lstatSpy,
    mkdirSpy,
    writeFileSpy,
    readFileSpy,
    rmSpy,
  };
}

export function setupVirtualBrowserFS(): VirtualMemoryFS {
  cleanupVirtualBrowserFS();
  vfs = new VirtualMemoryFS();
  customMtimes.clear();
  customModes.clear();
  virtualSymlinks.clear();
  deletedPaths.clear();
  openDescriptors.clear();
  const core = createCoreIoSpies(vfs);
  spies = [
    ...core.spies,
    ...createFdSpies(vfs, core.statSpy),
    ...createFspSpies(core),
    ...createProcessSpies(),
  ];
  return vfs;
}

export function cleanupVirtualBrowserFS(): void {
  for (const s of spies) s.mockRestore();
  spies = [];
  customMtimes.clear();
  customModes.clear();
  virtualSymlinks.clear();
  deletedPaths.clear();
  openDescriptors.clear();
  vfs = new VirtualMemoryFS();
}

export function tempDir(name: string): string {
  if (spies.length === 0) setupVirtualBrowserFS();
  const dir = `/virtual/scratch/runs/${name}-${Date.now()}-${dirCounter++}`;
  vfs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function cleanupTempDirs(): void {
  cleanupVirtualBrowserFS();
}

export function setVirtualMtime(path: string, at: number): void {
  customMtimes.set(path, at);
}
