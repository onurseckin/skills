/**
 * @file runtime-fixture.ts
 * In-memory test sandbox and virtual fs harness for tests/runtime domain
 */

import { spyOn } from "bun:test";
import * as fs from "node:fs";
import { dirname, join, normalize } from "node:path";
import * as flockFfi from "../../../olt/scripts/src/platform/fs/flock-ffi.ts";

export interface RuntimeFsHarness {
  readonly files: Map<string, string>;
  readonly dirs: Set<string>;
  readonly symlinks: Set<string>;
  readonly fileNlinks: Map<string, number>;
  restore(): void;
}

export function createRuntimeFsHarness(): RuntimeFsHarness {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const symlinks = new Set<string>();
  const fileNlinks = new Map<string, number>();
  const descriptors = new Map<
    number,
    { path: string; buffer: Buffer; nlink: number; isDirectory: boolean }
  >();
  let nextFd = 5000;

  const originalExists = fs.existsSync.bind(fs);
  const originalStat = fs.statSync.bind(fs);
  const originalLstat = fs.lstatSync.bind(fs);
  const originalReadFileSync = fs.readFileSync.bind(fs);
  const originalOpenSync = fs.openSync.bind(fs);
  const originalFstatSync = fs.fstatSync.bind(fs);
  const originalReadSync = fs.readSync.bind(fs);
  const originalWriteSync = fs.writeSync.bind(fs);
  const originalCloseSync = fs.closeSync.bind(fs);
  const originalReaddirSync = fs.readdirSync.bind(fs);

  const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
    const s = normalize(String(p));
    if (!s.startsWith("/virtual/")) return originalExists(p);
    return files.has(s) || dirs.has(s) || symlinks.has(s);
  });

  const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation((p) => {
    let curr = normalize(String(p));
    dirs.add(curr);
    while (curr && curr !== "/" && curr !== ".") {
      dirs.add(curr);
      curr = dirname(curr);
    }
    return undefined as unknown as string;
  });

  const writeSpy = spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
    const s = normalize(String(p));
    dirs.add(dirname(s));
    files.set(
      s,
      typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"),
    );
  });

  const readSpy = spyOn(fs, "readFileSync").mockImplementation((p, options) => {
    if (typeof p === "number") {
      const handle = descriptors.get(p);
      if (!handle) throw Object.assign(new Error(`EBADF: read '${p}'`), { code: "EBADF" });
      return options === "utf8" || options === "utf-8"
        ? handle.buffer.toString("utf8")
        : handle.buffer;
    }
    const s = normalize(String(p));
    if (!s.startsWith("/virtual/")) return originalReadFileSync(p, options);
    const val = files.get(s);
    if (val === undefined)
      throw Object.assign(new Error(`ENOENT: open '${s}'`), { code: "ENOENT" });
    const isUtf8 =
      options === "utf8" ||
      options === "utf-8" ||
      (typeof options === "object" && options?.encoding === "utf8");
    return isUtf8 ? val : Buffer.from(val, "utf8");
  });

  const lstatSpy = spyOn(fs, "lstatSync").mockImplementation((p) => {
    const s = normalize(String(p));
    if (!s.startsWith("/virtual/")) return originalLstat(p);
    const isSym = symlinks.has(s);
    const isD = dirs.has(s);
    const isF = files.has(s);
    if (!isD && !isF && !isSym)
      throw Object.assign(new Error(`ENOENT: lstat '${s}'`), { code: "ENOENT" });
    const content = files.get(s) ?? "";
    const nlink = fileNlinks.get(s) ?? 1;
    return {
      isFile: () => isF && !isSym,
      isDirectory: () => isD && !isSym,
      isSymbolicLink: () => isSym,
      size: Buffer.byteLength(content),
      nlink,
      ino: 12345,
      dev: 1,
      mtimeMs: Date.now(),
    } as unknown as fs.Stats;
  });

  const statSpy = spyOn(fs, "statSync").mockImplementation((p) => {
    const s = normalize(String(p));
    if (!s.startsWith("/virtual/")) return originalStat(p);
    const isD = dirs.has(s);
    const isF = files.has(s);
    if (!isD && !isF) throw Object.assign(new Error(`ENOENT: stat '${s}'`), { code: "ENOENT" });
    const content = files.get(s) ?? "";
    const nlink = fileNlinks.get(s) ?? 1;
    return {
      isFile: () => isF,
      isDirectory: () => isD,
      isSymbolicLink: () => false,
      size: Buffer.byteLength(content),
      nlink,
      ino: 12345,
      dev: 1,
      mtimeMs: Date.now(),
    } as unknown as fs.Stats;
  });

  const openSpy = spyOn(fs, "openSync").mockImplementation((p, flags) => {
    const s = normalize(String(p));
    if (!s.startsWith("/virtual/")) return originalOpenSync(p, flags);
    const isD = dirs.has(s);
    if (!files.has(s) && !isD) files.set(s, "");
    const val = files.get(s) ?? "";
    const fd = nextFd++;
    const nlink = fileNlinks.get(s) ?? 1;
    descriptors.set(fd, { path: s, buffer: Buffer.from(val, "utf8"), nlink, isDirectory: isD });
    return fd;
  });

  const fstatSpy = spyOn(fs, "fstatSync").mockImplementation((fd) => {
    if ((fd as number) < 5000) return originalFstatSync(fd);
    const handle = descriptors.get(fd as number);
    if (!handle) throw Object.assign(new Error("EBADF: fstat"), { code: "EBADF" });
    return {
      isFile: () => !handle.isDirectory,
      isDirectory: () => handle.isDirectory,
      isSymbolicLink: () => false,
      size: handle.buffer.length,
      nlink: handle.nlink,
      ino: 12345,
      dev: 1,
      mtimeMs: Date.now(),
    } as unknown as fs.Stats;
  });

  const readSyncSpy = spyOn(fs, "readSync").mockImplementation(
    (fd, buffer, offset, length, position) => {
      if ((fd as number) < 5000) return originalReadSync(fd, buffer, offset, length, position);
      const handle = descriptors.get(fd as number);
      if (!handle) throw Object.assign(new Error("EBADF: read"), { code: "EBADF" });
      const readPos = typeof position === "number" && position >= 0 ? position : 0;
      const available = handle.buffer.length - readPos;
      if (available <= 0) return 0;
      const count = Math.min(length, available);
      handle.buffer.copy(buffer as Buffer, offset, readPos, readPos + count);
      return count;
    },
  );

  const writeSyncSpy = spyOn(fs, "writeSync").mockImplementation((fd, data, offset, length) => {
    if ((fd as number) < 5000) return originalWriteSync(fd, data, offset, length);
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
    files.set(handle.path, handle.buffer.toString("utf8"));
    return chunk.length;
  });

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

  const chmodSpy = spyOn(fs, "chmodSync").mockImplementation(() => undefined);
  const closeSpy = spyOn(fs, "closeSync").mockImplementation((fd) => {
    if ((fd as number) < 5000) return originalCloseSync(fd);
    descriptors.delete(fd as number);
  });
  const fsyncSpy = spyOn(fs, "fsyncSync").mockImplementation(() => undefined);

  const readdirSpy = spyOn(fs, "readdirSync").mockImplementation((p, options) => {
    const s = normalize(String(p));
    if (!s.startsWith("/virtual/")) return originalReaddirSync(p, options as never);
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
        isSymbolicLink: () => symlinks.has(join(s, name)),
      })) as unknown as fs.Dirent[];
    }
    return arr as unknown as string[];
  });

  const flockSpy = spyOn(flockFfi, "tryExclusiveFlock").mockReturnValue(true);
  const releaseFlockSpy = spyOn(flockFfi, "releaseFlock").mockReturnValue(undefined as never);

  return {
    files,
    dirs,
    symlinks,
    fileNlinks,
    restore() {
      existsSpy.mockRestore();
      mkdirSpy.mockRestore();
      writeSpy.mockRestore();
      readSpy.mockRestore();
      lstatSpy.mockRestore();
      statSpy.mockRestore();
      openSpy.mockRestore();
      fstatSpy.mockRestore();
      readSyncSpy.mockRestore();
      writeSyncSpy.mockRestore();
      renameSpy.mockRestore();
      chmodSpy.mockRestore();
      closeSpy.mockRestore();
      fsyncSpy.mockRestore();
      readdirSpy.mockRestore();
      flockSpy.mockRestore();
      releaseFlockSpy.mockRestore();
    },
  };
}

export function sampleMetadata(agentId: string): Record<string, unknown> {
  return {
    agent_id: agentId,
    role: "implementer",
    tier: 3,
    write_scope: ["olt/scripts/src/runtime/index.ts"],
    allowed_read_scope: ["olt/scripts/src/runtime"],
    can_execute_shell: true,
    spawned_at: "2026-08-26T00:00:00.000Z",
  };
}

export function writeVirtualMetadata(
  harness: RuntimeFsHarness,
  root: string,
  agentId: string,
  value: unknown,
): string {
  const path = join(root, "runtime", `agent-${agentId}.json`);
  harness.dirs.add(root);
  harness.dirs.add(join(root, "runtime"));
  harness.files.set(path, JSON.stringify(value));
  return path;
}
