import { spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import * as durableWriteModule from "../../../../olt/scripts/src/core/durable-write.ts";
import * as platform from "../../../../olt/scripts/src/platform/index.ts";
import * as flockFfi from "../../../../olt/scripts/src/platform/fs/flock-ffi.ts";
import * as taskQueueLocks from "../../../../olt/scripts/src/task/queue/locks.ts";

export interface AtomicDispatchTestSession {
  testRoot: string;
  feedbackFile: string;
  taskQueueFile: string;
  mockFiles: Map<string, string>;
  mockDirs: Set<string>;
  cleanup: () => void;
}

export function setupAtomicDispatchTestSession(): AtomicDispatchTestSession {
  const testRoot = `${process.cwd()}/.olt/virtual-exec-atomic-dispatch`;
  const feedbackFile = join(testRoot, ".olt", "capsules", "FEEDBACK_QUEUE.jsonl");
  const taskQueueFile = join(testRoot, ".olt", "capsules", "TASK_QUEUE.jsonl");
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];

  mockFiles.clear();
  mockDirs.clear();
  mockDirs.add(testRoot);
  mockDirs.add(join(testRoot, ".olt"));
  mockDirs.add(join(testRoot, ".olt", "capsules"));

  let fdCounter = 100;
  const fdMap = new Map<number, string>();
  const origExists = fs.existsSync;
  const origRead = fs.readFileSync;

  const getIno = (p: string) => {
    let h = 0;
    for (let i = 0; i < p.length; i++) h = (h * 31 + p.charCodeAt(i)) | 0;
    return Math.abs(h) + 10;
  };

  spies.push(
    spyOn(taskQueueLocks, "acquireTaskQueueFlock").mockImplementation(() => true) as unknown as {
      mockRestore: () => void;
    },
    spyOn(taskQueueLocks, "releaseTaskQueueFlock").mockImplementation(
      () => undefined,
    ) as unknown as { mockRestore: () => void },
    spyOn(platform, "tryExclusiveFlock").mockImplementation(() => true) as unknown as {
      mockRestore: () => void;
    },
    spyOn(platform, "releaseFlock").mockImplementation(() => undefined) as unknown as {
      mockRestore: () => void;
    },
    spyOn(flockFfi, "tryExclusiveFlock").mockImplementation(() => true) as unknown as {
      mockRestore: () => void;
    },
    spyOn(flockFfi, "releaseFlock").mockImplementation(() => undefined) as unknown as {
      mockRestore: () => void;
    },
    spyOn(fs, "existsSync").mockImplementation(((p: fs.PathLike) => {
      const s = String(p);
      return mockFiles.has(s) || mockDirs.has(s) || origExists(p);
    }) as unknown as typeof fs.existsSync) as unknown as { mockRestore: () => void },
    spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike) => {
      const s = String(p);
      const fd = ++fdCounter;
      fdMap.set(fd, s);
      return fd;
    }) as unknown as typeof fs.openSync) as unknown as { mockRestore: () => void },
    spyOn(fs, "closeSync").mockImplementation(((fd: number) => {
      fdMap.delete(fd);
    }) as unknown as typeof fs.closeSync) as unknown as { mockRestore: () => void },
    spyOn(fs, "lstatSync").mockImplementation(((p: fs.PathLike) => {
      const s = String(p);
      const ino = getIno(s);
      if (mockFiles.has(s))
        return {
          isFile: () => true,
          isDirectory: () => false,
          nlink: 1,
          dev: 1,
          ino,
        } as unknown as fs.Stats;
      if (s.endsWith(".jsonl") || s.endsWith(".tmp") || s.includes(".tmp")) {
        const err = new Error(`ENOENT: no such file or directory, lstat '${s}'`) as Error & {
          code: string;
        };
        err.code = "ENOENT";
        throw err;
      }
      return {
        isFile: () => false,
        isDirectory: () => true,
        nlink: 1,
        dev: 1,
        ino,
      } as unknown as fs.Stats;
    }) as unknown as typeof fs.lstatSync) as unknown as { mockRestore: () => void },
    spyOn(fs, "fstatSync").mockImplementation(((fd: number) => {
      const s = fdMap.get(fd) ?? "";
      const ino = getIno(s);
      if (mockFiles.has(s))
        return {
          isFile: () => true,
          isDirectory: () => false,
          nlink: 1,
          dev: 1,
          ino,
        } as unknown as fs.Stats;
      return {
        isFile: () => false,
        isDirectory: () => true,
        nlink: 1,
        dev: 1,
        ino,
      } as unknown as fs.Stats;
    }) as unknown as typeof fs.fstatSync) as unknown as { mockRestore: () => void },
    spyOn(fs, "writeSync").mockImplementation(((
      fd: number,
      buffer: NodeJS.ArrayBufferView,
      _o?: number,
      length?: number,
    ) => {
      const s = fdMap.get(fd) ?? "";
      const text = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).toString(
        "utf8",
      );
      mockFiles.set(s, (mockFiles.get(s) ?? "") + text);
      return length ?? buffer.byteLength;
    }) as unknown as typeof fs.writeSync) as unknown as { mockRestore: () => void },
    spyOn(fs, "fsyncSync").mockImplementation(
      (() => undefined) as unknown as typeof fs.fsyncSync,
    ) as unknown as { mockRestore: () => void },
    spyOn(fs, "renameSync").mockImplementation(((oldP: fs.PathLike, newP: fs.PathLike) => {
      mockFiles.set(String(newP), mockFiles.get(String(oldP)) ?? "");
      mockFiles.delete(String(oldP));
    }) as unknown as typeof fs.renameSync) as unknown as { mockRestore: () => void },
    spyOn(fs, "unlinkSync").mockImplementation(((p: fs.PathLike) => {
      mockFiles.delete(String(p));
    }) as unknown as typeof fs.unlinkSync) as unknown as { mockRestore: () => void },
    spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor) => {
      const s = typeof p === "number" ? (fdMap.get(p) ?? "") : String(p);
      const val = mockFiles.get(s);
      if (val !== undefined) return val;
      try {
        return origRead(p as string, "utf8");
      } catch {
        const err = new Error(`ENOENT: no such file or directory, open '${s}'`) as Error & {
          code: string;
        };
        err.code = "ENOENT";
        throw err;
      }
    }) as unknown as typeof fs.readFileSync) as unknown as { mockRestore: () => void },
    spyOn(fs, "writeFileSync").mockImplementation(((
      p: fs.PathOrFileDescriptor,
      data: string | NodeJS.ArrayBufferView,
    ) => {
      const s = typeof p === "number" ? (fdMap.get(p) ?? "") : String(p);
      mockFiles.set(
        s,
        typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8"),
      );
    }) as unknown as typeof fs.writeFileSync) as unknown as { mockRestore: () => void },
    spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike) => {
      mockDirs.add(String(p));
      return undefined as unknown as string;
    }) as unknown as typeof fs.mkdirSync) as unknown as { mockRestore: () => void },
    spyOn(durableWriteModule, "atomicWriteBytes").mockImplementation(((
      targetPath: string,
      bytes: Uint8Array,
    ) => {
      mockFiles.set(targetPath, new TextDecoder().decode(bytes));
    }) as unknown as typeof durableWriteModule.atomicWriteBytes) as unknown as {
      mockRestore: () => void;
    },
  );

  const cleanup = () => {
    while (spies.length > 0) spies.pop()?.mockRestore();
    mockFiles.clear();
    mockDirs.clear();
  };

  return {
    testRoot,
    feedbackFile,
    taskQueueFile,
    mockFiles,
    mockDirs,
    cleanup,
  };
}
