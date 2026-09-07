import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { join } from "node:path";
import {
  persistDagSnapshot,
  loadDagSnapshot,
  resumeDagSnapshot,
  STANDARD_SUPERVISORY_CRONS,
  type QuotaDagSnapshot,
} from "../../../olt/scripts/src/telemetry/dag-snapshot.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import * as flockFfi from "../../../olt/scripts/src/platform/fs/flock-ffi.ts";

export const snapshotResumeSuiteName = "DAG Snapshot Resume & Recovery";

describe(snapshotResumeSuiteName, () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;
  let tmpDir: string;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    spyOn(flockFfi, "tryExclusiveFlock").mockReturnValue(true);
    spyOn(flockFfi, "releaseFlock").mockReturnValue(undefined);
    tmpDir = "/virtual/snap-resume";
    vfs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  function frozenSnapshot(
    repositoryRoot = tmpDir,
    runRoot = tmpDir,
    lowestQuotaObserved = 1,
  ): QuotaDagSnapshot {
    return {
      version: "2",
      repositoryRoot,
      runRoot,
      frozenAt: "2024-01-01T00:00:00Z",
      status: "frozen",
      tasks: [],
      agents: [],
      cronsSuspended: STANDARD_SUPERVISORY_CRONS,
      uncommittedFiles: [],
      lowestQuotaObserved,
      constrainedModels: [],
      autoWakeSchedule: {
        resetTime: "2024-01-01T01:00:00Z",
        resumeTime: "2024-01-01T01:01:00Z",
      },
    };
  }

  it("rejects missing snapshots and resumes valid snapshots updating status", async () => {
    const missingRepo = join(tmpDir, "missing-repo");
    vfs.mkdirSync(missingRepo, { recursive: true });
    await expect(resumeDagSnapshot({ repoRoot: missingRepo, runRoot: tmpDir })).rejects.toThrow(
      "no quota snapshot is available",
    );

    const repoPath = join(tmpDir, "resume-repo"),
      targetDir = join(repoPath, ".olt"),
      customPath = join(targetDir, "quota-dag-snapshot.json");
    const snapshot: QuotaDagSnapshot = {
      version: "2",
      repositoryRoot: repoPath,
      runRoot: tmpDir,
      frozenAt: "2024-01-01T00:00:00Z",
      status: "frozen",
      tasks: [],
      agents: [],
      cronsSuspended: STANDARD_SUPERVISORY_CRONS,
      uncommittedFiles: [],
      lowestQuotaObserved: 1,
      constrainedModels: [],
      activeWave: { waveId: "w1", status: "frozen", lanes: ["lane-1", "lane-2"] },
      autoWakeSchedule: { resetTime: "2024-01-01T01:00:00Z", resumeTime: "2024-01-01T01:01:00Z" },
    };
    vfs.mkdirSync(targetDir, { recursive: true });
    vfs.writeFileSync(customPath, JSON.stringify(snapshot));

    const result = await resumeDagSnapshot({ repoRoot: repoPath, runRoot: tmpDir });
    expect(result.restoredWaveLanes).toEqual(["lane-1", "lane-2"]);
    expect(result.cronsToReRegister.length).toBeGreaterThan(0);

    const updated = JSON.parse(vfs.readFileSync(customPath, "utf-8")) as QuotaDagSnapshot;
    expect(updated.status === "resumed" && updated.resumedAt !== undefined).toBe(true);
  });

  it("refuses mismatched run snapshots, sequential re-resumes, and clearAfterResume flags", async () => {
    const repoPath = join(tmpDir, "wrong-run-repo");
    const snapshot = frozenSnapshot(repoPath);
    vfs.mkdirSync(repoPath, { recursive: true });
    persistDagSnapshot(snapshot);
    const path = join(repoPath, ".olt", "quota-dag-snapshot.json");
    const before = vfs.readFileSync(path, "utf8");

    await expect(
      resumeDagSnapshot({ repoRoot: repoPath, runRoot: join(tmpDir, "other-run") }),
    ).rejects.toThrow("bound to another repository or run");
    expect(vfs.readFileSync(path, "utf8")).toBe(before);

    const crossRepo = join(tmpDir, "cross-process-repo");
    vfs.mkdirSync(crossRepo, { recursive: true });
    persistDagSnapshot(frozenSnapshot(crossRepo));
    const first = await resumeDagSnapshot({ repoRoot: crossRepo, runRoot: tmpDir });
    expect(
      first.restoredWaveLanes !== undefined && loadDagSnapshot(crossRepo)?.status === "resumed",
    ).toBe(true);
    await expect(resumeDagSnapshot({ repoRoot: crossRepo, runRoot: tmpDir })).rejects.toThrow();

    const clearRepo = join(tmpDir, "resume-clear-repo"),
      clearCustom = join(clearRepo, ".olt", "quota-dag-snapshot.json");
    vfs.mkdirSync(join(clearRepo, ".olt"), { recursive: true });
    vfs.writeFileSync(clearCustom, JSON.stringify(frozenSnapshot(clearRepo)));
    await expect(
      resumeDagSnapshot({ repoRoot: clearRepo, runRoot: tmpDir, clearAfterResume: true }),
    ).rejects.toThrow("quota snapshot must remain as durable evidence");
    expect(vfs.existsSync(clearCustom)).toBe(true);
  });
});
