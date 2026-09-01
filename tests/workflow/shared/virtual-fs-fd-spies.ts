import { spyOn, type Mock } from "bun:test";
import * as fs from "node:fs";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { norm, isVirtualPath, makeStats, orig, type OpenDescriptor } from "./virtual-fs-state.ts";

let nextFd = 2000;

export function createFdFsSpies(
  vfs: VirtualMemoryFS,
  openDescriptors: Map<number, OpenDescriptor>,
  spies: Mock<(...args: unknown[]) => unknown>[],
): void {
  const spy = <K extends keyof typeof fs>(k: K, fn: unknown) => {
    const s = spyOn(fs, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;
    spies.push(s);
    return s;
  };

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
      const exLen =
        vfs.existsSync(target) && !vfs.statSync(target)?.isDirectory()
          ? vfs.readFileSync(target).length
          : 0;
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

  spy(
    "readSync",
    (
      fd: number,
      buf: NodeJS.ArrayBufferView,
      off: number,
      len: number,
      pos?: number | bigint | null,
    ) => {
      const entry = openDescriptors.get(fd);
      if (!entry) return orig.readSync(fd, buf, off, len, pos);
      const data = vfs.existsSync(entry.path) ? vfs.readFileSync(entry.path) : new Uint8Array();
      const p = pos !== null && pos !== undefined ? Number(pos) : entry.position;
      const rLen = Math.min(len, Math.max(0, data.length - p));
      const targetBuf = Buffer.isBuffer(buf)
        ? buf
        : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
      Buffer.from(data)
        .subarray(p, p + rLen)
        .copy(targetBuf, off, 0, rLen);
      entry.position = p + rLen;
      return rLen;
    },
  );

  spy(
    "writeSync",
    (
      fd: number,
      buf: NodeJS.ArrayBufferView | string,
      off?: number | null,
      len?: number | null,
      pos?: number | bigint | null,
    ) => {
      const entry = openDescriptors.get(fd);
      if (!entry) return orig.writeSync(fd, buf as never, off as never, len as never, pos as never);
      const byteBuf =
        typeof buf === "string"
          ? Buffer.from(buf)
          : Buffer.isBuffer(buf)
            ? buf
            : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
      const o = typeof off === "number" ? off : 0;
      const l = typeof len === "number" ? len : byteBuf.length;
      const slice = byteBuf.subarray(o, o + l);
      const isAppend = (entry.flags & fs.constants.O_APPEND) !== 0;
      const ex = vfs.existsSync(entry.path)
        ? Buffer.from(vfs.readFileSync(entry.path))
        : Buffer.alloc(0);
      const p = typeof pos === "number" ? pos : isAppend ? ex.length : entry.position;
      const newBuf = Buffer.alloc(Math.max(ex.length, p + slice.length));
      ex.copy(newBuf);
      slice.copy(newBuf, p);
      vfs.writeFileSync(entry.path, newBuf);
      entry.position = p + slice.length;
      return slice.length;
    },
  );
}
