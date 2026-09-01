import { spyOn } from "bun:test";
import type { BigIntStats } from "node:fs";
import * as fsp from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { resolve } from "node:path";

export const vPlanFs = new Map<string, Uint8Array>();
export const vPlanDirs = new Set<string>();
export const vPlanSymlinks = new Map<string, string>();
let planDirCounter = 0;
const vPlanSpies: Array<{ mockRestore: () => void }> = [];

export const normPlanPath = (p: string): string => resolve(p).replace(/\/+$/, "");

export function getNextPlanDir(): string {
  planDirCounter += 1;
  const dir = `/virtual/plan-dir-${planDirCounter}`;
  vPlanDirs.add(dir);
  return dir;
}

export function installPlanFsSpies(): void {
  if (vPlanSpies.length > 0) return;
  const olstat = fsp.lstat.bind(fsp),
    oopen = fsp.open.bind(fsp);
  const owrite = fsp.writeFile.bind(fsp),
    osymlink = fsp.symlink.bind(fsp),
    orm = fsp.rm.bind(fsp);

  vPlanSpies.push(
    spyOn(fsp, "mkdtemp").mockImplementation(async () => {
      return getNextPlanDir();
    }),
    spyOn(fsp, "writeFile").mockImplementation(async (path, data) => {
      const s = normPlanPath(String(path));
      if (s.startsWith("/virtual/")) {
        vPlanFs.set(
          s,
          typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data as Uint8Array),
        );
        return;
      }
      return owrite(path, data);
    }),
    spyOn(fsp, "symlink").mockImplementation(async (target, path) => {
      const s = normPlanPath(String(path));
      if (s.startsWith("/virtual/")) {
        vPlanSymlinks.set(s, String(target));
        return;
      }
      return osymlink(target, path);
    }),
    spyOn(fsp, "rm").mockImplementation(async (path) => {
      const s = normPlanPath(String(path));
      if (s.startsWith("/virtual/")) {
        vPlanFs.delete(s);
        vPlanDirs.delete(s);
        vPlanSymlinks.delete(s);
        for (const k of Array.from(vPlanFs.keys())) if (k.startsWith(`${s}/`)) vPlanFs.delete(k);
        for (const d of Array.from(vPlanDirs)) if (d.startsWith(`${s}/`)) vPlanDirs.delete(d);
        return;
      }
      return orm(path, { force: true, recursive: true });
    }),
    spyOn(fsp, "lstat").mockImplementation(async (path, options?: unknown) => {
      const s = normPlanPath(String(path));
      if (s.startsWith("/virtual/")) {
        if (vPlanSymlinks.has(s))
          return {
            isSymbolicLink: () => true,
            isFile: () => false,
            isDirectory: () => false,
            dev: 1n,
            ino: 2n,
            mode: 0o120000n,
            size: 0n,
            mtimeNs: 0n,
          } as unknown as BigIntStats;
        if (vPlanDirs.has(s))
          return {
            isSymbolicLink: () => false,
            isFile: () => false,
            isDirectory: () => true,
            dev: 1n,
            ino: 3n,
            mode: 0o040755n,
            size: 0n,
            mtimeNs: 0n,
          } as unknown as BigIntStats;
        const file = vPlanFs.get(s);
        if (!file) {
          const err = new Error(`ENOENT: ${s}`) as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        return {
          isSymbolicLink: () => false,
          isFile: () => true,
          isDirectory: () => false,
          dev: 1n,
          ino: 1n,
          mode: 0o100644n,
          size: BigInt(file.length),
          mtimeNs: 0n,
        } as unknown as BigIntStats;
      }
      return olstat(path, options as Parameters<typeof olstat>[1]);
    }),
    spyOn(fsp, "open").mockImplementation(async (path, flags) => {
      const s = normPlanPath(String(path));
      if (s.startsWith("/virtual/")) {
        if (vPlanSymlinks.has(s)) {
          const err = new Error(
            `ELOOP: symbolic link encountered, open '${s}'`,
          ) as NodeJS.ErrnoException;
          err.code = "ELOOP";
          throw err;
        }
        const file = vPlanFs.get(s);
        if (!file) {
          const err = new Error(`ENOENT: ${s}`) as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        return {
          stat: async () =>
            ({
              isSymbolicLink: () => false,
              isFile: () => true,
              isDirectory: () => false,
              dev: 1n,
              ino: 1n,
              mode: 0o100644n,
              size: BigInt(file.length),
              mtimeNs: 0n,
            }) as unknown as BigIntStats,
          read: async (buf: Uint8Array, offset: number, length: number, position: number) => {
            const slice = file.subarray(position, position + length);
            buf.set(slice, offset);
            return { bytesRead: slice.length, buffer: buf };
          },
          close: async () => {},
        } as unknown as FileHandle;
      }
      return oopen(path, flags);
    }),
  );
}

export function clearPlanFs(): void {
  for (const s of vPlanSpies.splice(0)) s.mockRestore();
  vPlanFs.clear();
  vPlanDirs.clear();
  vPlanSymlinks.clear();
}
