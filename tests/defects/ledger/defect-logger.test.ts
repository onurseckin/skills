import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  compactDefectLogFile,
  readDefectLogFile,
  recordKeyedDefect,
} from "../../../olt/scripts/src/logging/defect-logger.ts";
import { setDefectLogDependenciesForTesting } from "../../../olt/scripts/src/logging/lock.ts";

export const defectLoggerSuiteName = "Keyed Defect Logger & Compaction File Engine";

interface VirtualNode {
  isDir: boolean;
  content?: string;
}

const vfs = new Map<string, VirtualNode>();
const spies: Array<{ mockRestore: () => void }> = [];
let restoreDeps: (() => void) | null = null;

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
  const getStats = (p: fs.PathLike): fs.Stats => {
    const s = String(p).replace(/\/+$/, "");
    const n = vfs.get(s);
    const isDir = n ? n.isDir : true;
    return {
      dev: 1,
      ino: 1,
      nlink: 1,
      isFile: () => !isDir,
      isDirectory: () => isDir,
      isSymbolicLink: () => false,
      mode: isDir ? 0o755 : 0o644,
      size: n?.content ? Buffer.byteLength(n.content) : 0,
      mtimeMs: Date.now(),
    } as fs.Stats;
  };
  const lstatSpy = spyOn(fs, "lstatSync").mockImplementation(getStats);
  const statSpy = spyOn(fs, "statSync").mockImplementation(getStats);
  const fstatSpy = spyOn(fs, "fstatSync").mockImplementation(getStats);
  const openSpy = spyOn(fs, "openSync").mockImplementation(() => 101);
  const closeSpy = spyOn(fs, "closeSync").mockImplementation(() => {});
  const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation((p) => {
    vfs.set(String(p), { isDir: true });
    return undefined;
  });

  spies.push(existsSpy, lstatSpy, statSpy, fstatSpy, openSpy, closeSpy, mkdirSpy);

  restoreDeps = setDefectLogDependenciesForTesting({
    atomicWrite: (p: string, bytes: Uint8Array) => {
      vfs.set(p, { content: new TextDecoder().decode(bytes), isDir: false });
    },
    readFile: (p: string) => {
      const n = vfs.get(String(p));
      if (!n || n.content === undefined) {
        const err = new Error(`ENOENT: ${p}`) as Error & { code: string };
        err.code = "ENOENT";
        throw err;
      }
      return n.content;
    },
  });
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  if (restoreDeps) {
    restoreDeps();
    restoreDeps = null;
  }
  vfs.clear();
});

describe(defectLoggerSuiteName, () => {
  test("records and aggregates defects live on disk", () => {
    setupVirtualFs();
    const dir = "/virtual/defect-logger-test";
    const filePath = join(dir, "defects.jsonl");
    vfs.set(dir, { isDir: true });

    const r1 = recordKeyedDefect(
      {
        id: "b-log-1",
        type: "main_thread_direct_execution",
        observation: "Direct execution without subagent",
        agent_id: "orch-01",
      },
      { filePath },
    );

    expect(r1.isNew).toBeTrue();
    expect(r1.recorded.count).toBe(1);
    expect(fs.existsSync(filePath)).toBeTrue();

    const r2 = recordKeyedDefect(
      {
        id: "b-log-2",
        type: "main_thread_direct_execution",
        observation: "Direct execution without subagent",
        agent_id: "orch-01",
      },
      { filePath },
    );

    expect(r2.isNew).toBeFalse();
    expect(r2.recorded.count).toBe(2);

    const entries = readDefectLogFile(filePath);
    expect(entries.length).toBe(1);
    expect(entries[0]?.count).toBe(2);
    expect(entries[0]?.type).toBe("main_thread_direct_execution");
  });

  test("compacts existing noisy defect files into aggregated format", () => {
    setupVirtualFs();
    const dir = "/virtual/defect-logger-test";
    const filePath = join(dir, "defects.jsonl");
    vfs.set(dir, { isDir: true });

    const lines: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      lines.push(
        JSON.stringify({
          id: `b-spam-${i}`,
          type: "repeated_failure",
          observation: "Same failure across loop",
          agent_id: "impl-01",
          timestamp: `2026-08-22T08:${i < 10 ? "0" + i : i}:00.000Z`,
        }),
      );
    }
    lines.push(
      JSON.stringify({
        id: "b-distinct",
        type: "distinct_error",
        observation: "Different error",
        agent_id: "impl-01",
        timestamp: "2026-08-22T08:30:00.000Z",
      }),
    );

    vfs.set(filePath, { content: `${lines.join("\n")}\n`, isDir: false });

    const result = compactDefectLogFile(filePath);
    expect(result.totalBefore).toBe(21);
    expect(result.totalAfter).toBe(2);

    const compacted = readDefectLogFile(filePath);
    expect(compacted.length).toBe(2);

    const repeated = compacted.find((c) => c.type === "repeated_failure");
    expect(repeated !== undefined).toBeTrue();
    if (repeated) {
      expect(repeated.count).toBe(20);
    }
  });

  test("handles nonexistent file reading gracefully", () => {
    setupVirtualFs();
    const entries = readDefectLogFile("/path/does/not/exist/defects.jsonl");
    expect(entries).toEqual([]);
  });
});
