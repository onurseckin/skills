/**
 * @file bootstrap-fixture.ts
 * In-memory test sandbox fixture for tests/bootstrap domain
 */

import { spyOn } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";

export interface MemoryFsHarness {
  readonly files: Map<string, string | Buffer>;
  readonly dirs: Set<string>;
  restore(): void;
}

let activeHarness: MemoryFsHarness | null = null;
let counter = 0;

export function scratchRoot(callerPath = "boot-test", label = "test"): string {
  counter += 1;
  const hash = createHash("sha256")
    .update(`${callerPath}:${label}:${counter}`)
    .digest("hex")
    .slice(0, 8);
  const path = `/virtual/bootstrap/${label}-${counter}-${hash}`;
  activeHarness?.dirs.add(path);
  return path;
}

export function createSandboxDir(label = "sandbox"): string {
  return scratchRoot("sandbox", label);
}

export function createMemoryFsHarness(initialDirs: string[] = []): MemoryFsHarness {
  const files = new Map<string, string | Buffer>();
  const dirs = new Set<string>(initialDirs.map((d) => normalize(d)));
  const descriptors = new Map<
    number,
    { path: string; buffer: Buffer; position: number; isDirectory: boolean }
  >();
  let nextFd = 1000;

  const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
    const s = normalize(String(p));
    return files.has(s) || dirs.has(s);
  });

  const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation((p) => {
    let curr = normalize(String(p));
    dirs.add(curr);
    while (curr && curr !== "/" && curr !== ".") {
      curr = join(curr, "..");
      dirs.add(curr);
    }
    return undefined as unknown as string;
  });

  const writeSpy = spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
    const s = normalize(String(p));
    dirs.add(dirname(s));
    files.set(s, typeof data === "string" ? data : Buffer.from(data as Uint8Array));
  });

  const appendSpy = spyOn(fs, "appendFileSync").mockImplementation((p, data) => {
    const s = normalize(String(p));
    dirs.add(dirname(s));
    const prev = files.get(s) ?? "";
    const prevStr = typeof prev === "string" ? prev : prev.toString("utf8");
    const dataStr =
      typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8");
    files.set(s, prevStr + dataStr);
  });

  const readSpy = spyOn(fs, "readFileSync").mockImplementation((p, options) => {
    let val: string | Buffer | undefined;
    if (typeof p === "number") {
      const handle = descriptors.get(p);
      if (!handle) throw Object.assign(new Error(`EBADF: read '${p}'`), { code: "EBADF" });
      val = handle.buffer;
    } else {
      const s = normalize(String(p));
      val = files.get(s);
      if (val === undefined)
        throw Object.assign(new Error(`ENOENT: open '${s}'`), { code: "ENOENT" });
    }
    const isUtf8 =
      options === "utf8" ||
      options === "utf-8" ||
      (typeof options === "object" && options?.encoding === "utf8");
    return isUtf8
      ? typeof val === "string"
        ? val
        : val.toString("utf8")
      : typeof val === "string"
        ? Buffer.from(val, "utf8")
        : val;
  });

  const lstatSpy = spyOn(fs, "lstatSync").mockImplementation((p) => {
    const s = normalize(String(p));
    const isD = dirs.has(s);
    const isF = files.has(s);
    if (!isD && !isF) throw Object.assign(new Error(`ENOENT: lstat '${s}'`), { code: "ENOENT" });
    const buf = files.get(s);
    const size = isF ? (typeof buf === "string" ? Buffer.byteLength(buf) : (buf?.length ?? 0)) : 0;
    return {
      isFile: () => isF,
      isDirectory: () => isD,
      isSymbolicLink: () => false,
      size,
      mtimeMs: Date.now(),
    } as unknown as fs.Stats;
  });

  const statSpy = spyOn(fs, "statSync").mockImplementation((p) => {
    const s = normalize(String(p));
    const isD = dirs.has(s);
    const isF = files.has(s);
    if (!isD && !isF) throw Object.assign(new Error(`ENOENT: stat '${s}'`), { code: "ENOENT" });
    const buf = files.get(s);
    const size = isF ? (typeof buf === "string" ? Buffer.byteLength(buf) : (buf?.length ?? 0)) : 0;
    return {
      isFile: () => isF,
      isDirectory: () => isD,
      isSymbolicLink: () => false,
      size,
      mtimeMs: Date.now(),
    } as unknown as fs.Stats;
  });

  const realpathSpy = spyOn(fs, "realpathSync").mockImplementation((p) =>
    resolve(normalize(String(p))),
  );

  const renameSpy = spyOn(fs, "renameSync").mockImplementation((oldP, newP) => {
    const sOld = normalize(String(oldP));
    const sNew = normalize(String(newP));
    const val = files.get(sOld);
    if (val !== undefined) {
      files.set(sNew, val);
      files.delete(sOld);
    }
    if (dirs.has(sOld)) {
      dirs.delete(sOld);
      dirs.add(sNew);
    }
  });

  const readdirSpy = spyOn(fs, "readdirSync").mockImplementation((p, options) => {
    const s = normalize(String(p));
    const names = new Set<string>();
    for (const f of files.keys()) {
      if (f.startsWith(s) && f !== s) {
        const first = f
          .slice(s.length)
          .replace(/^[/\\]+/, "")
          .split(/[/\\]/)[0];
        if (first) names.add(first);
      }
    }
    for (const d of dirs) {
      if (d.startsWith(s) && d !== s) {
        const first = d
          .slice(s.length)
          .replace(/^[/\\]+/, "")
          .split(/[/\\]/)[0];
        if (first) names.add(first);
      }
    }
    const arr = [...names];
    if (
      typeof options === "object" &&
      options !== null &&
      (options as { withFileTypes?: boolean }).withFileTypes
    ) {
      return arr.map((name) => ({
        name,
        isDirectory: () => dirs.has(join(s, name)),
        isFile: () => files.has(join(s, name)),
        isSymbolicLink: () => false,
      })) as unknown as fs.Dirent[];
    }
    return arr as unknown as string[];
  });

  const rmSpy = spyOn(fs, "rmSync").mockImplementation((p) => {
    const s = normalize(String(p));
    files.delete(s);
    dirs.delete(s);
    for (const k of files.keys()) if (k.startsWith(s)) files.delete(k);
    for (const d of dirs) if (d.startsWith(s)) dirs.delete(d);
  });

  const unlinkSpy = spyOn(fs, "unlinkSync").mockImplementation((p) => {
    files.delete(normalize(String(p)));
  });

  const openSpy = spyOn(fs, "openSync").mockImplementation((p) => {
    const s = normalize(String(p));
    const isDir = dirs.has(s);
    if (!files.has(s) && !isDir) files.set(s, Buffer.alloc(0));
    const cur = files.get(s);
    const buf =
      cur === undefined
        ? Buffer.alloc(0)
        : typeof cur === "string"
          ? Buffer.from(cur, "utf8")
          : cur;
    const fd = nextFd++;
    descriptors.set(fd, { path: s, buffer: buf, position: 0, isDirectory: isDir });
    return fd;
  });

  const fstatSpy = spyOn(fs, "fstatSync").mockImplementation((fd) => {
    const handle = descriptors.get(fd as number);
    if (!handle) throw Object.assign(new Error("EBADF: fstat"), { code: "EBADF" });
    return {
      isFile: () => !handle.isDirectory,
      isDirectory: () => handle.isDirectory,
      isSymbolicLink: () => false,
      size: handle.buffer.length,
      mtimeMs: Date.now(),
    } as unknown as fs.Stats;
  });

  const writeSyncSpy = spyOn(fs, "writeSync").mockImplementation((fd, data, offset, length) => {
    const handle = descriptors.get(fd as number);
    if (!handle) throw Object.assign(new Error("EBADF: write"), { code: "EBADF" });
    const src = Buffer.isBuffer(data)
      ? data
      : data instanceof Uint8Array
        ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        : Buffer.from(String(data), "utf8");
    const off = typeof offset === "number" ? offset : 0;
    const len = typeof length === "number" ? length : src.length - off;
    const chunk = src.subarray(off, off + len);
    handle.buffer = Buffer.concat([handle.buffer, chunk]);
    files.set(handle.path, handle.buffer);
    return chunk.length;
  });

  const readSyncSpy = spyOn(fs, "readSync").mockImplementation(
    (fd, buffer, offset, length, position) => {
      const handle = descriptors.get(fd as number);
      if (!handle) throw Object.assign(new Error("EBADF: read"), { code: "EBADF" });
      const readPos = typeof position === "number" && position >= 0 ? position : handle.position;
      const available = handle.buffer.length - readPos;
      if (available <= 0) return 0;
      const count = Math.min(length, available);
      handle.buffer.copy(buffer as Buffer, offset, readPos, readPos + count);
      if (position === null || position === undefined || position < 0) handle.position += count;
      return count;
    },
  );

  const chmodSpy = spyOn(fs, "chmodSync").mockImplementation(() => undefined);
  const closeSpy = spyOn(fs, "closeSync").mockImplementation((fd) => {
    descriptors.delete(fd as number);
  });
  const fsyncSpy = spyOn(fs, "fsyncSync").mockImplementation(() => undefined);

  const harness: MemoryFsHarness = {
    files,
    dirs,
    restore() {
      if (activeHarness === harness) activeHarness = null;
      existsSpy.mockRestore();
      mkdirSpy.mockRestore();
      writeSpy.mockRestore();
      appendSpy.mockRestore();
      readSpy.mockRestore();
      lstatSpy.mockRestore();
      statSpy.mockRestore();
      realpathSpy.mockRestore();
      renameSpy.mockRestore();
      readdirSpy.mockRestore();
      rmSpy.mockRestore();
      unlinkSpy.mockRestore();
      openSpy.mockRestore();
      fstatSpy.mockRestore();
      writeSyncSpy.mockRestore();
      readSyncSpy.mockRestore();
      chmodSpy.mockRestore();
      closeSpy.mockRestore();
      fsyncSpy.mockRestore();
    },
  };

  activeHarness = harness;
  return harness;
}
