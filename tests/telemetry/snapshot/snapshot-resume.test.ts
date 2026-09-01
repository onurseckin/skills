import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  persistDagSnapshot,
  loadDagSnapshot,
  resumeDagSnapshot,
  STANDARD_SUPERVISORY_CRONS,
  type QuotaDagSnapshot,
} from "../../../olt/scripts/src/telemetry/dag-snapshot.ts";
import { SnapshotVirtualFs } from "./vfs-harness.ts";

export const snapshotResumeSuiteName = "DAG Snapshot Resume & Recovery";
const svfs = new SnapshotVirtualFs();

describe(snapshotResumeSuiteName, () => {
  let tmpDir: string;

  beforeEach(() => {
    svfs.setup();
    tmpDir = "/virtual/snap-resume";
    svfs.setFile(tmpDir, "", true);
  });

  afterEach(() => {
    svfs.cleanup();
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
    svfs.setFile(missingRepo, "", true);
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
    svfs.setFile(repoPath, "", true);
    svfs.setFile(targetDir, "", true);
    svfs.setFile(customPath, JSON.stringify(snapshot), false);

    const result = await resumeDagSnapshot({ repoRoot: repoPath, runRoot: tmpDir });
    expect(result.restoredWaveLanes).toEqual(["lane-1", "lane-2"]);
    expect(result.cronsToReRegister.length).toBeGreaterThan(0);

    const updated = JSON.parse(fs.readFileSync(customPath, "utf-8")) as QuotaDagSnapshot;
    expect(updated.status === "resumed" && updated.resumedAt !== undefined).toBe(true);
  });

  it("refuses mismatched run snapshots, sequential re-resumes, and clearAfterResume flags", async () => {
    const repoPath = join(tmpDir, "wrong-run-repo");
    const snapshot = frozenSnapshot(repoPath);
    svfs.setFile(repoPath, "", true);
    persistDagSnapshot(snapshot);
    const path = join(repoPath, ".olt", "quota-dag-snapshot.json");
    const before = fs.readFileSync(path, "utf8");

    await expect(
      resumeDagSnapshot({ repoRoot: repoPath, runRoot: join(tmpDir, "other-run") }),
    ).rejects.toThrow("bound to another repository or run");
    expect(fs.readFileSync(path, "utf8")).toBe(before);

    const crossRepo = join(tmpDir, "cross-process-repo");
    svfs.setFile(crossRepo, "", true);
    persistDagSnapshot(frozenSnapshot(crossRepo));
    const first = await resumeDagSnapshot({ repoRoot: crossRepo, runRoot: tmpDir });
    expect(
      first.restoredWaveLanes !== undefined && loadDagSnapshot(crossRepo)?.status === "resumed",
    ).toBe(true);
    await expect(resumeDagSnapshot({ repoRoot: crossRepo, runRoot: tmpDir })).rejects.toThrow();

    const clearRepo = join(tmpDir, "resume-clear-repo"),
      clearCustom = join(clearRepo, ".olt", "quota-dag-snapshot.json");
    svfs.setFile(clearRepo, "", true);
    svfs.setFile(join(clearRepo, ".olt"), "", true);
    svfs.setFile(clearCustom, JSON.stringify(frozenSnapshot(clearRepo)), false);
    await expect(
      resumeDagSnapshot({ repoRoot: clearRepo, runRoot: tmpDir, clearAfterResume: true }),
    ).rejects.toThrow("quota snapshot must remain as durable evidence");
    expect(fs.existsSync(clearCustom)).toBe(true);
  });
});
