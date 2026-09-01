import { spyOn, type Mock } from "bun:test";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as ts from "typescript";
import * as platform from "../../../olt/scripts/src/platform/index.ts";
import * as flockFfi from "../../../olt/scripts/src/platform/fs/flock-ffi.ts";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { norm, isVirtualPath, makeStats, resetInodeMap, setCustomMode, transferCustomMode, orig, type OpenDescriptor } from "./virtual-fs-state.ts";

let vCounter = 1;

export function createWorkflowFsSpies(
  vfs: VirtualMemoryFS,
  openDescriptors: Map<number, OpenDescriptor>,
): { spies: Mock<(...args: unknown[]) => unknown>[]; cleanup: () => void } {
  const spies: Mock<(...args: unknown[]) => unknown>[] = [];
  let nextFd = 2000;

  const spy = <K extends keyof typeof fs>(k: K, fn: unknown) => {
    const s = spyOn(fs, k).mockImplementation(fn as never) as unknown as Mock<(...args: unknown[]) => unknown>;
    spies.push(s);
    return s;
  };
  const spyP = <K extends keyof typeof fsPromises>(k: K, fn: unknown) => {
    const s = spyOn(fsPromises, k).mockImplementation(fn as never) as unknown as Mock<(...args: unknown[]) => unknown>;
    spies.push(s);
    return s;
  };

  spy("existsSync", (p: fs.PathLike) => {
    const t = norm(String(p));
    return vfs.existsSync(t) || (!isVirtualPath(t) && orig.existsSync(t));
  });
  spy("mkdirSync", (p: fs.PathLike, o?: fs.MakeDirectoryOptions | boolean) => {
    const t = norm(String(p));
    if (isVirtualPath(t) || vfs.existsSync(t)) {
      vfs.mkdirSync(t, typeof o === "boolean" ? { recursive: o } : o);
      return undefined as unknown as string;
    }
    return orig.mkdirSync(t, o);
  });
  spy("writeFileSync", (p: fs.PathOrFileDescriptor, d: string | NodeJS.ArrayBufferView) => {
    if (typeof p === "number") {
      const entry = openDescriptors.get(p);
      if (!entry) return orig.writeFileSync(p, d);
      vfs.writeFileSync(entry.path, typeof d === "string" ? d : Buffer.from(d as Uint8Array));
      return;
    }
    const target = norm(String(p));
    if (isVirtualPath(target) || vfs.existsSync(target)) {
      vfs.writeFileSync(target, typeof d === "string" ? d : Buffer.from(d as Uint8Array));
      return;
    }
    return orig.writeFileSync(target, d);
  });
  spy("appendFileSync", (p: fs.PathOrFileDescriptor, d: string | Uint8Array) => {
    if (typeof p === "number") {
      const entry = openDescriptors.get(p);
      if (!entry) return orig.appendFileSync(p, d);
      const cur = vfs.existsSync(entry.path) ? vfs.readFileSync(entry.path, "utf8") : "";
      vfs.writeFileSync(entry.path, cur + (typeof d === "string" ? d : Buffer.from(d).toString("utf8")));
      return;
    }
    const target = norm(String(p));
    if (isVirtualPath(target) || vfs.existsSync(target)) {
      const cur = vfs.existsSync(target) ? vfs.readFileSync(target, "utf8") : "";
      vfs.writeFileSync(target, cur + (typeof d === "string" ? d : Buffer.from(d).toString("utf8")));
      return;
    }
    return orig.appendFileSync(p, d);
  });
  spy("readFileSync", (p: fs.PathOrFileDescriptor, o?: unknown) => {
    if (typeof p === "number") {
      const entry = openDescriptors.get(p);
      if (!entry) return orig.readFileSync(p, o as BufferEncoding);
      const isUtf = o === "utf8" || (typeof o === "object" && (o as { encoding?: string })?.encoding === "utf8");
      return isUtf ? vfs.readFileSync(entry.path, "utf8") : Buffer.from(vfs.readFileSync(entry.path));
    }
    const target = norm(String(p));
    if (vfs.existsSync(target)) {
      const isUtf = o === "utf8" || (typeof o === "object" && (o as { encoding?: string })?.encoding === "utf8");
      return isUtf ? vfs.readFileSync(target, "utf8") : Buffer.from(vfs.readFileSync(target));
    }
    if (isVirtualPath(target)) {
      const err = new Error(`ENOENT: no such file or directory, open '${target}'`);
      (err as unknown as { code: string }).code = "ENOENT";
      throw err;
    }
    return orig.readFileSync(p, o as BufferEncoding);
  });
  spy("readdirSync", (p: fs.PathLike, o?: unknown) => {
    const target = norm(String(p));
    if (vfs.existsSync(target)) return vfs.readdirSync(target) as unknown as string[];
    if (isVirtualPath(target)) {
      const err = new Error(`ENOENT: no such file or directory, scandir '${target}'`);
      (err as unknown as { code: string }).code = "ENOENT";
      throw err;
    }
    return orig.readdirSync(target, o as BufferEncoding);
  });
  const getStat = (p: fs.PathLike, isLstat = false): fs.Stats => {
    const target = norm(String(p));
    if (vfs.existsSync(target)) {
      const vs = vfs.statSync(target);
      if (vs) return makeStats(vs, target);
    }
    if (isVirtualPath(target)) {
      const op = isLstat ? "lstat" : "stat";
      const err = new Error(`ENOENT: no such file or directory, ${op} '${target}'`);
      (err as unknown as { code: string }).code = "ENOENT";
      throw err;
    }
    return isLstat ? orig.lstatSync(target) : orig.statSync(target);
  };
  spy("statSync", (p: fs.PathLike) => getStat(p, false));
  spy("lstatSync", (p: fs.PathLike) => getStat(p, true));
  spy("rmSync", (p: fs.PathLike, o?: fs.RmOptions) => {
    const target = norm(String(p));
    if (vfs.existsSync(target) || isVirtualPath(target)) {
      if (vfs.existsSync(target)) vfs.rmSync(target, { recursive: o?.recursive, force: o?.force });
      return;
    }
    return orig.rmSync(target, o);
  });
  spy("unlinkSync", (p: fs.PathLike) => {
    const target = norm(String(p));
    if (vfs.existsSync(target) || isVirtualPath(target)) {
      if (vfs.existsSync(target)) vfs.rmSync(target, { force: true });
      return;
    }
    return orig.unlinkSync(target);
  });
  spy("chmodSync", (p: fs.PathLike, m: fs.Mode) => {
    const t = norm(String(p));
    if (vfs.existsSync(t) || isVirtualPath(t)) setCustomMode(t, typeof m === "number" ? m : 0o644);
    else orig.chmodSync(t, m);
  });
  spy("utimesSync", (p: fs.PathLike) => {
    const t = norm(String(p));
    if (!vfs.existsSync(t) && !isVirtualPath(t)) orig.utimesSync(t, Date.now(), Date.now());
  });
  spy("fsyncSync", () => {});
  spy("openSync", (p: fs.PathLike, flags: string | number) => {
    const target = norm(String(p));
    if (isVirtualPath(target) || vfs.existsSync(target)) {
      const nf = typeof flags === "number" ? flags : 0;
      const isW = (nf & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0;
      if (!isW && !vfs.existsSync(target)) {
        const err = new Error(`ENOENT: no such file or directory, open '${target}'`);
        (err as unknown as { code: string }).code = "ENOENT";
        throw err;
      }
      if (isW && !vfs.existsSync(target)) vfs.writeFileSync(target, "");
      const isAppend = (nf & fs.constants.O_APPEND) !== 0;
      const exLen = vfs.existsSync(target) && !vfs.statSync(target)?.isDirectory() ? vfs.readFileSync(target).length : 0;
      const fd = nextFd++;
      openDescriptors.set(fd, { path: target, position: isAppend ? exLen : 0, flags: nf });
      return fd;
    }
    return orig.openSync(target, flags);
  });
  spy("closeSync", (fd: number) => {
    if (openDescriptors.has(fd)) openDescriptors.delete(fd);
    else orig.closeSync(fd);
  });
  spy("fstatSync", (fd: number) => {
    const entry = openDescriptors.get(fd);
    if (entry) {
      const vs = vfs.statSync(entry.path);
      if (vs) return makeStats(vs, entry.path);
    }
    return orig.fstatSync(fd);
  });
  spy("readSync", (fd: number, buf: NodeJS.ArrayBufferView, off: number, len: number, pos?: number | bigint | null) => {
    const entry = openDescriptors.get(fd);
    if (entry) {
      const data = vfs.existsSync(entry.path) ? vfs.readFileSync(entry.path) : new Uint8Array();
      const p = pos !== null && pos !== undefined ? Number(pos) : entry.position;
      const rLen = Math.min(len, Math.max(0, data.length - p));
      const targetBuf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
      Buffer.from(data).subarray(p, p + rLen).copy(targetBuf, off, 0, rLen);
      entry.position = p + rLen;
      return rLen;
    }
    return orig.readSync(fd, buf, off, len, pos);
  });
  spy("writeSync", (fd: number, buf: NodeJS.ArrayBufferView | string, off?: number | null, len?: number | null, pos?: number | bigint | null) => {
    const entry = openDescriptors.get(fd);
    if (entry) {
      const byteBuf = typeof buf === "string" ? Buffer.from(buf) : Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
      const o = typeof off === "number" ? off : 0;
      const l = typeof len === "number" ? len : byteBuf.length;
      const slice = byteBuf.subarray(o, o + l);
      const isAppend = (entry.flags & fs.constants.O_APPEND) !== 0;
      const ex = vfs.existsSync(entry.path) ? Buffer.from(vfs.readFileSync(entry.path)) : Buffer.alloc(0);
      const p = typeof pos === "number" ? pos : isAppend ? ex.length : entry.position;
      const newBuf = Buffer.alloc(Math.max(ex.length, p + slice.length));
      ex.copy(newBuf);
      slice.copy(newBuf, p);
      vfs.writeFileSync(entry.path, newBuf);
      entry.position = p + slice.length;
      return slice.length;
    }
    return orig.writeSync(fd, buf as never, off as never, len as never, pos as never);
  });
  spy("realpathSync", (p: fs.PathLike) => {
    const t = norm(String(p));
    return vfs.existsSync(t) || isVirtualPath(t) ? t : orig.realpathSync(t);
  });
  spy("renameSync", (src: fs.PathLike, dst: fs.PathLike) => {
    const s = norm(String(src));
    const d = norm(String(dst));
    if (vfs.existsSync(s) || isVirtualPath(s) || isVirtualPath(d)) {
      vfs.writeFileSync(d, vfs.readFileSync(s));
      vfs.rmSync(s, { force: true });
      transferCustomMode(s, d);
      return;
    }
    orig.renameSync(s, d);
  });
  spy("mkdtempSync", (prefix: string) => {
    const vPath = norm(`/virtual/tmp/${prefix.replace(/[^a-zA-Z0-9_-]/g, "_")}${vCounter++}`);
    vfs.mkdirSync(vPath, { recursive: true });
    return vPath;
  });

  // Async fsPromises spies
  spyP("mkdir", async (p: fs.PathLike, o?: fs.MakeDirectoryOptions | boolean) => {
    const t = norm(String(p));
    if (isVirtualPath(t) || vfs.existsSync(t)) {
      vfs.mkdirSync(t, typeof o === "boolean" ? { recursive: o } : o);
      return undefined;
    }
    return orig.mkdir(t, o as never);
  });
  spyP("mkdtemp", async (prefix: string) => {
    const vPath = norm(`/virtual/tmp/${prefix.replace(/[^a-zA-Z0-9_-]/g, "_")}${vCounter++}`);
    vfs.mkdirSync(vPath, { recursive: true });
    return vPath;
  });
  spyP("writeFile", async (p: fs.PathOrFileDescriptor | fsPromises.FileHandle, d: string | NodeJS.ArrayBufferView) => {
    const t = norm(String(p));
    if (isVirtualPath(t) || vfs.existsSync(t)) {
      vfs.writeFileSync(t, typeof d === "string" ? d : Buffer.from(d as Uint8Array));
      return;
    }
    return orig.writeFile(t, d);
  });
  spyP("readFile", async (p: fs.PathOrFileDescriptor | fsPromises.FileHandle, o?: unknown) => {
    const t = norm(String(p));
    if (vfs.existsSync(t)) {
      const isUtf = o === "utf8" || (typeof o === "object" && (o as { encoding?: string })?.encoding === "utf8");
      return (isUtf ? vfs.readFileSync(t, "utf8") : Buffer.from(vfs.readFileSync(t))) as never;
    }
    if (isVirtualPath(t)) {
      const err = new Error(`ENOENT: no such file or directory, open '${t}'`);
      (err as unknown as { code: string }).code = "ENOENT";
      throw err;
    }
    return orig.readFile(t, o as BufferEncoding) as never;
  });
  spyP("rm", async (p: fs.PathLike, o?: fs.RmOptions) => {
    const t = norm(String(p));
    if (vfs.existsSync(t) || isVirtualPath(t)) {
      if (vfs.existsSync(t)) vfs.rmSync(t, { recursive: o?.recursive, force: o?.force });
      return;
    }
    return orig.rm(t, o);
  });

  // ts.sys hooks
  ts.sys.readFile = (filePath: string, encoding?: string) => {
    const t = norm(filePath);
    return vfs.existsSync(t) ? vfs.readFileSync(t, (encoding as BufferEncoding) ?? "utf8") : orig.tsReadFile(filePath, encoding);
  };
  ts.sys.fileExists = (filePath: string) => {
    const t = norm(filePath);
    return vfs.existsSync(t) || (!isVirtualPath(t) && orig.tsFileExists(filePath));
  };
  ts.sys.directoryExists = (dirPath: string) => {
    const t = norm(dirPath);
    return vfs.existsSync(t) ? (vfs.statSync(t)?.isDirectory() ?? false) : (!isVirtualPath(t) && orig.tsDirectoryExists(dirPath));
  };

  // Platform flock mocks
  spies.push(
    spyOn(platform, "tryExclusiveFlock").mockReturnValue(true) as never,
    spyOn(platform, "releaseFlock").mockImplementation(() => {}) as never,
    spyOn(flockFfi, "tryExclusiveFlock").mockReturnValue(true) as never,
    spyOn(flockFfi, "releaseFlock").mockImplementation(() => {}) as never,
  );

  const cleanup = () => {
    for (const s of spies) s.mockRestore();
    spies.length = 0;
    openDescriptors.clear();
    resetInodeMap();
    ts.sys.readFile = orig.tsReadFile;
    ts.sys.fileExists = orig.tsFileExists;
    ts.sys.directoryExists = orig.tsDirectoryExists;
    ts.sys.getDirectories = orig.tsGetDirectories;
    ts.sys.readDirectory = orig.tsReadDirectory;
  };

  return { spies, cleanup };
}
