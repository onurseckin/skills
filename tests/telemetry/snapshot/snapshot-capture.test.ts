import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as cp from "node:child_process";
import { join } from "node:path";
import {
  STANDARD_SUPERVISORY_CRONS,
  captureDagSnapshot,
  formatDagSnapshotMarkdown,
  type QuotaDagSnapshot,
} from "../../../olt/scripts/src/telemetry/snapshot/index.ts";
import type { CircuitBreakerEvaluation } from "../../../olt/scripts/src/telemetry/circuit-breaker.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

export const snapshotCaptureSuiteName = "Telemetry Quota DAG Snapshot Capture Suite";

const vfs = new Map<string, { isDir: boolean; content?: string }>();
const spies: Array<{ mockRestore: () => void }> = [];

function setupVirtualFs(): void {
  vfs.clear();
  vfs.set(process.cwd(), { isDir: true });
  vfs.set(join(process.cwd(), ".git"), { isDir: true });
  vfs.set(join(process.cwd(), "package.json"), { content: "{}", isDir: false });

  const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
    const s = String(p).replace(/\/+$/, "");
    if (vfs.has(s)) return true;
    const prefix = `${s}/`;
    for (const k of vfs.keys()) {
      if (k.startsWith(prefix)) return true;
    }
    return false;
  });
  const statSpy = spyOn(fs, "statSync").mockImplementation((p) => {
    const s = String(p).replace(/\/+$/, "");
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
  const lstatSpy = spyOn(fs, "lstatSync").mockImplementation((p) => {
    const s = String(p).replace(/\/+$/, "");
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
  const realpathSpy = spyOn(fs, "realpathSync").mockImplementation((p) => String(p));
  const readSpy = spyOn(fs, "readFileSync").mockImplementation((p, options) => {
    const s = String(p);
    const n = vfs.get(s);
    if (!n || n.content === undefined) {
      const err = new Error(`ENOENT: ${s}`) as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    }
    const enc =
      typeof options === "string"
        ? options
        : (options as { encoding?: string } | undefined)?.encoding;
    return enc === "utf-8" || enc === "utf8"
      ? n.content
      : (Buffer.from(n.content) as unknown as string);
  });
  const writeSpy = spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
    vfs.set(String(p), {
      content: typeof data === "string" ? data : new TextDecoder().decode(data as Uint8Array),
      isDir: false,
    });
  });
  const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation((p) => {
    vfs.set(String(p), { isDir: true });
    return undefined;
  });
  const spawnSpy = spyOn(cp, "spawnSync").mockImplementation(() => ({
    status: 0,
    stdout: "" as unknown as Buffer,
    stderr: "" as unknown as Buffer,
    pid: 1234,
    output: [null, "" as unknown as Buffer, "" as unknown as Buffer],
    signal: null,
  }));

  spies.push(existsSpy, statSpy, lstatSpy, realpathSpy, readSpy, writeSpy, mkdirSpy, spawnSpy);
}

describe(snapshotCaptureSuiteName, () => {
  let testDir: string;

  beforeEach(() => {
    setupVirtualFs();
    testDir = "/virtual/snapshot-capture";
    vfs.set(testDir, { isDir: true });
    vfs.set(join(testDir, ".git"), { isDir: true });
  });

  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
    vfs.clear();
  });

  function createTestSnapshot(
    repoRoot = testDir,
    runRoot = testDir,
    lowestQuotaObserved = 5,
  ): QuotaDagSnapshot {
    return {
      version: "2",
      repositoryRoot: repoRoot,
      runRoot,
      frozenAt: "2026-01-01T00:00:00.000Z",
      status: "frozen",
      tasks: [],
      agents: [],
      cronsSuspended: STANDARD_SUPERVISORY_CRONS,
      uncommittedFiles: [],
      lowestQuotaObserved,
      constrainedModels: ["claude-3-opus"],
      autoWakeSchedule: {
        resetTime: "2026-01-01T01:00:00.000Z",
        resumeTime: "2026-01-01T01:01:00.000Z",
      },
    };
  }

  it("captures valid snapshot without memory.json", async () => {
    const snap = await captureDagSnapshot({
      runRoot: testDir,
      repositoryRoot: testDir,
      lowestQuotaObserved: 10,
      constrainedModels: ["gpt-4"],
      resetTime: "2026-01-01T02:00:00.000Z",
    });

    expect(snap.version).toBe("2");
    expect(snap.status).toBe("frozen");
    expect(snap.lowestQuotaObserved).toBe(10);
    expect(snap.constrainedModels).toEqual(["gpt-4"]);
    expect(snap.cronsSuspended).toEqual(STANDARD_SUPERVISORY_CRONS);
    expect(snap.autoWakeSchedule.resumeTime).toBe("2026-01-01T02:01:00.000Z");
  });

  it("parses memory.json when present in runRoot", async () => {
    const memoryData = {
      tasks: [{ id: "task-1", status: "running", effortMath: "3 Work", dependencies: [] }],
      agents: [{ id: "agent-alpha", role: "implementer", status: "busy" }],
      activeWave: { waveId: "wave-001", status: "in_progress", lanes: ["lane-a", "lane-b"] },
    };
    vfs.set(join(testDir, "memory.json"), { content: JSON.stringify(memoryData), isDir: false });

    const snap = await captureDagSnapshot({
      runRoot: testDir,
      repositoryRoot: testDir,
      lowestQuotaObserved: null,
      constrainedModels: [],
      resetTime: "2026-01-01T03:00:00.000Z",
    });

    expect(snap.tasks).toHaveLength(1);
    expect(snap.tasks[0]?.id).toBe("task-1");
    expect(snap.agents).toHaveLength(1);
    expect(snap.agents[0]?.id).toBe("agent-alpha");
    expect(snap.activeWave?.waveId).toBe("wave-001");
    expect(snap.activeWave?.lanes).toEqual(["lane-a", "lane-b"]);
  });

  it("throws HarnessError on invalid lowestQuotaObserved or invalid resetTime", async () => {
    expect(
      captureDagSnapshot({
        runRoot: testDir,
        repositoryRoot: testDir,
        lowestQuotaObserved: -5,
        constrainedModels: [],
        resetTime: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(HarnessError);

    expect(
      captureDagSnapshot({
        runRoot: testDir,
        repositoryRoot: testDir,
        lowestQuotaObserved: 5,
        constrainedModels: [],
        resetTime: "not-a-valid-date",
      }),
    ).rejects.toThrow(HarnessError);
  });

  it("formats snapshot markdown summary and detailed outputs", () => {
    const snap = createTestSnapshot();
    snap.tasks = [{ id: "t-1", status: "done", effortMath: "1 Work", dependencies: [] }];
    snap.uncommittedFiles = ["src/test.ts"];

    const evalData: CircuitBreakerEvaluation = {
      status: "constrained",
      isTriggered: true,
      lowestRemainingQuota: 5,
      constrainedModels: [{ modelName: "claude-3-opus" }],
      breakerStates: [],
    };

    const summaryMd = formatDagSnapshotMarkdown(snap, evalData, false);
    expect(summaryMd).toContain("## Quota DAG Snapshot");
    expect(summaryMd).toContain("5%");
    expect(summaryMd).not.toContain("src/test.ts");

    const detailedMd = formatDagSnapshotMarkdown(snap, evalData, true);
    expect(detailedMd).toContain("src/test.ts");
    expect(detailedMd).toContain("t-1");
  });
});
