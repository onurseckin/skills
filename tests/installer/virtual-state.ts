import { ptr } from "bun:ffi";
import { resolve } from "node:path";
import { VirtualMemoryFS } from "../../olt/scripts/src/testing/virtual-fs/index.ts";

export const vfsState = {
  vfs: new VirtualMemoryFS(),
  customMtimes: new Map<string, number>(),
  customModes: new Map<string, number>(),
  symlinks: new Map<string, string>(),
  openDescriptors: new Map<number, { path: string; position: number; flags?: number }>(),
  inodeMap: new Map<string, number>(),
  specialFiles: new Map<string, "socket" | "fifo" | "character">(),
  inodeLockOwners: new Map<number, number>(),
  errnoBuf: new Int32Array(1),
  get errnoPtr() {
    return ptr(this.errnoBuf);
  },
  nextFd: 3000,
  nextIno: 5000,
  fixtureCount: 0,
};

export function normPath(p: string | number): string {
  return resolve(String(p)).replace(/\\/g, "/");
}

export function resolveVirtualPath(p: string | number): string {
  const norm = normPath(p);
  if (vfsState.symlinks.has(norm)) {
    return resolveVirtualPath(vfsState.symlinks.get(norm)!);
  }
  const parts = norm.split("/").filter(Boolean);
  let current = "";
  for (let i = 0; i < parts.length; i++) {
    current += "/" + parts[i];
    if (vfsState.symlinks.has(current)) {
      const target = vfsState.symlinks.get(current)!;
      const rest = parts.slice(i + 1).join("/");
      return resolveVirtualPath(rest ? `${target}/${rest}` : target);
    }
  }
  return norm;
}

export function isVirtualInstallerPath(s: string): boolean {
  const norm = normPath(s);
  return (
    norm.startsWith("/virtual") ||
    norm.includes("scratch") ||
    norm.includes("coverage") ||
    norm.includes("tmp") ||
    norm.includes("harness-installer-repair-") ||
    norm.includes(".agents") ||
    norm.includes(".olt") ||
    vfsState.vfs.existsSync(norm) ||
    vfsState.symlinks.has(norm)
  );
}

export function getInode(targetPath: string): number {
  const norm = normPath(targetPath);
  let ino = vfsState.inodeMap.get(norm);
  if (ino === undefined) {
    ino = vfsState.nextIno++;
    vfsState.inodeMap.set(norm, ino);
  }
  return ino;
}

export function registerSpecialFile(
  path: string,
  type: "socket" | "fifo" | "character" = "socket",
): void {
  vfsState.specialFiles.set(normPath(path), type);
}
