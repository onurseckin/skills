import { Buffer } from "node:buffer";
import * as fs from "node:fs";
import type { IVirtualFileSystem } from "./types.ts";
import {
  type VirtualFSSpyState,
  fsErr,
  getInode,
  isVirtualPath,
  NOOP_FALSE,
  normPath,
  origOpendir,
  remapPrefix,
} from "./handlers-base.ts";
export const origCopyFile = fs.copyFileSync;

export function copyDirRecursive(
  vfs: IVirtualFileSystem,
  srcStr: string,
  dstStr: string,
  state?: VirtualFSSpyState,
): void {
  vfs.mkdirSync(dstStr, { recursive: true });
  for (const entry of vfs.readdirSync(srcStr, { recursive: true }) as string[]) {
    const cSrc = `${srcStr}/${entry}`;
    const cDst = `${dstStr}/${entry}`;
    if (vfs.statSync(cSrc, { throwIfNoEntry: false })?.isDirectory()) {
      vfs.mkdirSync(cDst, { recursive: true });
    } else if (vfs.statSync(cSrc, { throwIfNoEntry: false })?.isFile()) {
      vfs.writeFileSync(cDst, vfs.readFileSync(cSrc));
      if (state) {
        const m = state.customModes.get(normPath(cSrc));
        if (m !== undefined) state.customModes.set(normPath(cDst), m);
      }
    }
  }
}

export function mockRename(state: VirtualFSSpyState, src: fs.PathLike, dst: fs.PathLike): void {
  const srcStr = normPath(String(src));
  const dstStr = normPath(String(dst));
  if (state.symlinks.has(srcStr)) {
    const target = state.symlinks.get(srcStr)!;
    state.symlinks.delete(srcStr);
    state.symlinks.set(dstStr, target);
    state.vfs.writeFileSync(dstStr, Buffer.from(target));
    if (state.vfs.existsSync(srcStr)) state.vfs.unlinkSync(srcStr);
    return;
  }
  const stat = state.vfs.statSync(srcStr, { throwIfNoEntry: false });
  if (!stat) {
    throw fsErr("ENOENT", `no such file or directory, rename '${srcStr}' -> '${dstStr}'`);
  }
  remapPrefix(state.customModes, srcStr, dstStr);
  remapPrefix(state.customMtimes, srcStr, dstStr);
  const srcIno = state.inodeMap.get(srcStr);
  state.inodeMap.delete(srcStr);
  state.inodeMap.set(dstStr, srcIno ?? state.nextIno.value++);
  if (stat.isDirectory()) {
    copyDirRecursive(state.vfs, srcStr, dstStr, state);
    state.vfs.rmSync(srcStr, { recursive: true, force: true });
  } else {
    state.vfs.writeFileSync(dstStr, state.vfs.readFileSync(srcStr));
    state.vfs.unlinkSync(srcStr);
  }
}

export function mockLink(state: VirtualFSSpyState, src: fs.PathLike, dst: fs.PathLike): void {
  const srcStr = normPath(String(src));
  const dstStr = normPath(String(dst));
  const stat = state.vfs.statSync(srcStr, { throwIfNoEntry: false });
  if (!stat) {
    throw fsErr("ENOENT", `no such file or directory, link '${srcStr}' -> '${dstStr}'`);
  }
  state.vfs.writeFileSync(dstStr, state.vfs.readFileSync(srcStr));
  const ino = getInode(state, srcStr);
  state.inodeMap.set(dstStr, ino);
  if (!state.hardlinks) state.hardlinks = new Map();
  state.hardlinks.set(ino, (state.hardlinks.get(ino) ?? 1) + 1);
}

export function mockCp(state: VirtualFSSpyState, src: string | URL, dst: string | URL): void {
  const srcStr = normPath(String(src));
  const dstStr = normPath(String(dst));
  const stat = state.vfs.statSync(srcStr, { throwIfNoEntry: false });
  if (!stat) {
    throw fsErr("ENOENT", `no such file or directory, cp '${srcStr}' -> '${dstStr}'`);
  }
  if (stat.isDirectory()) {
    copyDirRecursive(state.vfs, srcStr, dstStr, state);
  } else {
    state.vfs.writeFileSync(dstStr, state.vfs.readFileSync(srcStr));
    const m = state.customModes.get(srcStr);
    if (m !== undefined) state.customModes.set(dstStr, m);
  }
}

export function mockOpendir(
  state: VirtualFSSpyState,
  p: fs.PathLike,
  opts?: fs.OpenDirOptions,
): fs.Dir {
  const s = String(p);
  const norm = normPath(s);
  const lookup = state.vfs.existsSync(norm) ? norm : s;
  if (state.vfs.existsSync(lookup)) {
    const entries = state.vfs.readdirSync(lookup) as string[];
    let idx = 0;
    let closed = false;
    const isBuf = (opts as { encoding?: string } | undefined)?.encoding === "buffer";
    const dirObj = {
      path: s,
      readSync(): fs.Dirent | null {
        if (closed || idx >= entries.length) return null;
        const name = entries[idx++]!;
        const ep = `${lookup}/${name}`;
        const vs = state.vfs.statSync(ep, { throwIfNoEntry: false });
        const isSym = state.symlinks.has(normPath(ep));
        return {
          name: isBuf ? Buffer.from(name) : name,
          isDirectory: () => (vs?.isDirectory() ?? false) && !isSym,
          isFile: () => (vs?.isFile() ?? false) && !isSym,
          isSymbolicLink: () => isSym,
          isBlockDevice: NOOP_FALSE,
          isCharacterDevice: NOOP_FALSE,
          isFIFO: NOOP_FALSE,
          isSocket: NOOP_FALSE,
        } as unknown as fs.Dirent;
      },
      closeSync(): void {
        closed = true;
      },
      async read(): Promise<fs.Dirent | null> {
        return dirObj.readSync();
      },
      async close(): Promise<void> {
        dirObj.closeSync();
      },
      async *[Symbol.asyncIterator]() {
        let e: fs.Dirent | null;
        while ((e = dirObj.readSync()) !== null) yield e;
      },
      *[Symbol.iterator]() {
        let e: fs.Dirent | null;
        while ((e = dirObj.readSync()) !== null) yield e;
      },
    };
    return dirObj as unknown as fs.Dir;
  }
  if (!isVirtualPath(s) && !isVirtualPath(norm)) {
    try {
      return origOpendir(s, opts as fs.OpenDirOptions);
    } catch {}
  }
  throw fsErr("ENOENT", `no such file or directory, opendir '${lookup}'`);
}
