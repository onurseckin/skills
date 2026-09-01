import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  cleanseDanglingLocks,
  isProcessAlive,
} from "../../../olt/scripts/src/reporting/doctor/lock-cleaner.ts";

export const lockCleanerSuiteName = "Wave 1 - Task 1.2: Dangling Flock Lock Cleanser";

interface VirtualNode {
  isDir: boolean;
  content?: string;
}

const vfs = new Map<string, VirtualNode>();
const spies: Array<{ mockRestore: () => void }> = [];

function setupVirtualFs(): void {
  vfs.clear();
  const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
    const s = String(p).replace(/\/+$/, "");
    if (vfs.has(s)) return true;
    const prefix = `${s}/`;
    for (const k of vfs.keys()) {
      if (k.startsWith(prefix)) return true;
    }
    return false;
  });
  const readdirSpy = spyOn(fs, "readdirSync").mockImplementation((p, options) => {
    const dir = String(p).replace(/\/+$/, "");
    const prefix = `${dir}/`;
    const entries = new Map<string, boolean>();
    for (const [k, v] of vfs.entries()) {
      if (k.startsWith(prefix) && k.length > prefix.length) {
        const rest = k.slice(prefix.length);
        const segment = rest.split("/")[0];
        if (segment && !entries.has(segment)) entries.set(segment, rest.includes("/") || v.isDir);
      }
    }
    const withTypes = typeof options === "object" && options !== null && "withFileTypes" in options;
    if (withTypes) {
      return Array.from(entries.entries()).map(([name, isDir]) => ({
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
        isSymbolicLink: () => false,
      })) as unknown as fs.Dirent[];
    }
    return Array.from(entries.keys()) as unknown as fs.Dirent[];
  });
  const lstatSpy = spyOn(fs, "lstatSync").mockImplementation((p) => {
    const s = String(p);
    const n = vfs.get(s);
    if (!n) throw new Error(`ENOENT: ${s}`);
    return {
      dev: 1,
      ino: 1,
      nlink: 1,
      isFile: () => !n.isDir,
      isDirectory: () => n.isDir,
      isSymbolicLink: () => false,
      mode: n.isDir ? 0o755 : 0o644,
      size: n.content ? Buffer.byteLength(n.content) : 0,
      mtimeMs: Date.now(),
    } as fs.Stats;
  });
  const readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
    const s = String(p);
    const n = vfs.get(s);
    if (!n || n.content === undefined) throw new Error(`ENOENT: ${s}`);
    return n.content;
  });
  const unlinkSpy = spyOn(fs, "unlinkSync").mockImplementation((p) => {
    vfs.delete(String(p));
  });

  spies.push(existsSpy, readdirSpy, lstatSpy, readSpy, unlinkSpy);
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
});

describe(lockCleanerSuiteName, () => {
  test("isProcessAlive accurately detects current process and non-existent PID", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(9999999)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
  });

  test("cleanseDanglingLocks clears lock files belonging to dead PIDs", () => {
    setupVirtualFs();
    const tempDir = "/virtual/lock-cleaner-test";
    const locksDir = join(tempDir, ".locks");
    vfs.set(tempDir, { isDir: true });
    vfs.set(locksDir, { isDir: true });

    const deadPidLock = join(locksDir, "dead-process.lock");
    vfs.set(deadPidLock, {
      content: JSON.stringify({ pid: 9999999, created_at: new Date().toISOString() }),
      isDir: false,
    });

    const livePidLock = join(locksDir, "live-process.lock");
    vfs.set(livePidLock, {
      content: JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }),
      isDir: false,
    });

    const cleared = cleanseDanglingLocks({ repoRoot: tempDir, lockDirs: [".locks"] });

    expect(cleared.length).toBe(1);
    expect(cleared[0]).toContain("dead-process.lock");
    expect(vfs.has(deadPidLock)).toBe(false);
    expect(vfs.has(livePidLock)).toBe(true);
  });
});
