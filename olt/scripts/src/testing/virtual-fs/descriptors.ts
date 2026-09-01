import * as fs from "node:fs";
import * as path from "node:path";
import { isVirtualPath, normPath, type VirtualFSSpyState } from "./handlers.ts";

export const origOpenSync = fs.openSync;
export const origReadSync = fs.readSync;
export const origWriteSync = fs.writeSync;
export const origCloseSync = fs.closeSync;

export function mockOpen(state: VirtualFSSpyState, p: fs.PathLike, flags: string | number): number {
  const target = normPath(String(p));
  const flagStr = typeof flags === "string" ? flags : "";
  const numFlags = typeof flags === "number" ? flags : 0;
  const isWrite =
    (numFlags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0 ||
    flagStr.includes("w") ||
    flagStr.includes("a") ||
    flagStr.includes("+");
  if ((numFlags & (fs.constants.O_NOFOLLOW ?? 0)) !== 0 && state.symlinks.has(target)) {
    throw Object.assign(new Error(`ELOOP: too many levels of symbolic links, open '${target}'`), {
      code: "ELOOP",
    });
  }
  if (isWrite && state.vfs.statSync(target, { throwIfNoEntry: false })?.isDirectory()) {
    throw Object.assign(new Error(`EISDIR: illegal operation on a directory, open '${target}'`), {
      code: "EISDIR",
    });
  }
  if (!isWrite && !state.vfs.existsSync(target) && !state.symlinks.has(target)) {
    try {
      return origOpenSync(p, flags);
    } catch {}
  }
  if (isWrite && !(numFlags & (fs.constants.O_DIRECTORY ?? 0))) {
    const parent = path.dirname(target);
    const parentMode = state.customModes.get(parent);
    if (parentMode !== undefined && (parentMode & 0o200) === 0) {
      throw Object.assign(new Error(`EACCES: permission denied, open '${target}'`), {
        code: "EACCES",
      });
    }
    if (!state.vfs.existsSync(parent)) state.vfs.mkdirSync(parent, { recursive: true });
    if (!state.vfs.existsSync(target)) state.vfs.writeFileSync(target, "");
  }
  const isAppend = (numFlags & fs.constants.O_APPEND) !== 0 || flagStr.includes("a");
  const existingLen =
    state.vfs.existsSync(target) &&
    !state.vfs.statSync(target, { throwIfNoEntry: false })?.isDirectory()
      ? state.vfs.readFileSync(target).length
      : 0;
  const fd = state.nextFd.value++;
  state.openDescriptors.set(fd, {
    path: target,
    position: isAppend ? existingLen : 0,
    flags: numFlags,
  });
  return fd;
}

export function mockRead(
  state: VirtualFSSpyState,
  fd: number,
  buffer: NodeJS.ArrayBufferView,
  offset: number,
  length: number,
  position?: number | bigint | null,
): number {
  const entry = state.openDescriptors.get(fd);
  if (!entry) {
    return origReadSync(fd, buffer as NodeJS.ArrayBufferView, offset, length, position ?? null);
  }
  if (state.vfs.statSync(entry.path, { throwIfNoEntry: false })?.isDirectory()) {
    throw Object.assign(
      new Error(`EISDIR: illegal operation on a directory, read '${entry.path}'`),
      { code: "EISDIR" },
    );
  }
  const data = state.vfs.readFileSync(entry.path);
  const pos = position !== null && position !== undefined ? Number(position) : entry.position;
  const readLen = Math.min(length, Math.max(0, data.length - pos));
  const targetBuf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer);
  Buffer.from(data)
    .subarray(pos, pos + readLen)
    .copy(targetBuf, offset, 0, readLen);
  entry.position = pos + readLen;
  return readLen;
}

export function mockWrite(
  state: VirtualFSSpyState,
  fd: number,
  buffer: NodeJS.ArrayBufferView | string,
  offset?: number | null,
  length?: number | null,
  position?: number | bigint | null,
): number {
  const entry = state.openDescriptors.get(fd);
  if (!entry) {
    return typeof buffer === "string"
      ? (origWriteSync as (...args: unknown[]) => number)(
          fd,
          buffer,
          position as number | undefined,
        )
      : (origWriteSync as (...args: unknown[]) => number)(
          fd,
          buffer,
          offset ?? undefined,
          length ?? undefined,
          position ?? undefined,
        );
  }
  const byteBuf =
    typeof buffer === "string"
      ? Buffer.from(buffer)
      : Buffer.isBuffer(buffer)
        ? buffer
        : Buffer.from(buffer.buffer);
  const off = typeof offset === "number" ? offset : 0;
  const len = typeof length === "number" ? length : byteBuf.length;
  const slice = byteBuf.subarray(off, off + len);
  const existing = state.vfs.existsSync(entry.path)
    ? Buffer.from(state.vfs.readFileSync(entry.path))
    : Buffer.alloc(0);
  const isAppend = entry.flags !== undefined && (entry.flags & fs.constants.O_APPEND) !== 0;
  const pos = typeof position === "number" ? position : isAppend ? existing.length : entry.position;
  const newBuf = Buffer.alloc(Math.max(existing.length, pos + slice.length));
  existing.copy(newBuf);
  slice.copy(newBuf, pos);
  state.vfs.writeFileSync(entry.path, newBuf);
  entry.position = pos + slice.length;
  return slice.length;
}
