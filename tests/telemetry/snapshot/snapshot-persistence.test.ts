import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  persistDagSnapshot,
  loadDagSnapshot,
  __setDagSnapshotPersistenceTestHook,
  type QuotaDagSnapshot,
} from "../../../olt/scripts/src/telemetry/dag-snapshot.ts";
import { readTelemetryStream } from "../../../olt/scripts/src/reporting/telemetry-stream.ts";
import { SnapshotVirtualFs } from "./vfs-harness.ts";

// VirtualMemoryFS in-memory mocked snapshot tests
export const snapshotPersistenceSuiteName = "DAG Snapshot Persistence & Durability";
const svfs = new SnapshotVirtualFs();

describe(snapshotPersistenceSuiteName, () => {
  let tmpDir: string;

  beforeEach(() => {
    svfs.setup();
    tmpDir = "/virtual/snap-persist";
    svfs.setFile(tmpDir, "", true);
  });

  afterEach(() => {
    __setDagSnapshotPersistenceTestHook(undefined);
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
      cronsSuspended: [],
      uncommittedFiles: [],
      lowestQuotaObserved,
      constrainedModels: [],
      autoWakeSchedule: { resetTime: "2024-01-01T01:00:00Z", resumeTime: "2024-01-01T01:01:00Z" },
    };
  }

  it("loads manually written snapshot files and rejects corrupted snapshots", () => {
    const snapshot: QuotaDagSnapshot = {
      version: "2",
      repositoryRoot: tmpDir,
      runRoot: tmpDir,
      frozenAt: "2024-01-01T00:00:00Z",
      status: "frozen",
      tasks: [],
      agents: [],
      cronsSuspended: [],
      uncommittedFiles: [],
      lowestQuotaObserved: 1,
      constrainedModels: [],
      autoWakeSchedule: { resetTime: "2024-01-01T01:00:00Z", resumeTime: "2024-01-01T01:01:00Z" },
    };
    persistDagSnapshot(snapshot);
    const loaded = loadDagSnapshot(tmpDir);
    expect(loaded?.frozenAt === snapshot.frozenAt && loaded?.status === "frozen").toBe(true);

    const snapshotPath = join(tmpDir, ".olt", "quota-dag-snapshot.json");
    svfs.setFile(join(tmpDir, ".olt"), "", true);
    svfs.setFile(snapshotPath, "{ bad json }", false);
    expect(() => loadDagSnapshot(tmpDir)).toThrow("quota snapshot contains invalid JSON");
  });

  it("refuses symlinked and hardlinked canonical snapshots without touching external targets", () => {
    const external = join(tmpDir, "external-snapshot.json");
    const snapshotPath = join(tmpDir, ".olt", "quota-dag-snapshot.json");
    svfs.setFile(join(tmpDir, ".olt"), "", true);
    svfs.setFile(external, "external sentinel", false);
    fs.symlinkSync(external, snapshotPath);
    expect(() => loadDagSnapshot(tmpDir)).toThrow();
    expect(fs.readFileSync(external, "utf8")).toBe("external sentinel");

    svfs.vfs.delete(snapshotPath);
    fs.linkSync(external, snapshotPath);
    expect(() => loadDagSnapshot(tmpDir)).toThrow();
    expect(fs.readFileSync(external, "utf8")).toBe("external sentinel");
  });

  it("preserves prior bytes on write/fsync/rename failures and reports post-rename uncertainty", () => {
    persistDagSnapshot(frozenSnapshot());
    const path = join(tmpDir, ".olt", "quota-dag-snapshot.json");
    const before = fs.readFileSync(path, "utf8");

    for (const stage of ["before_write", "before_file_fsync", "before_rename"] as const) {
      __setDagSnapshotPersistenceTestHook((observed) => {
        if (observed === stage) throw new Error(`fault:${stage}`);
      });
      expect(() => persistDagSnapshot(frozenSnapshot(tmpDir, tmpDir, 2))).toThrow(`fault:${stage}`);
      __setDagSnapshotPersistenceTestHook(undefined);
      expect(fs.readFileSync(path, "utf8")).toBe(before);
    }

    for (const stage of ["after_rename", "before_directory_fsync"] as const) {
      const repo = join(tmpDir, stage);
      svfs.setFile(repo, "", true);
      persistDagSnapshot(frozenSnapshot(repo, tmpDir, 1));
      __setDagSnapshotPersistenceTestHook((observed) => {
        if (observed === stage) throw new Error(`fault:${stage}`);
      });
      expect(() => persistDagSnapshot(frozenSnapshot(repo, tmpDir, 2))).toThrow(
        "outcome is uncertain after atomic rename",
      );
      __setDagSnapshotPersistenceTestHook(undefined);
      expect(loadDagSnapshot(repo)?.lowestQuotaObserved).toBe(2);
      expect(
        readTelemetryStream(repo).filter((event) => event.action === "QUOTA_FREEZE_SNAPSHOT"),
      ).toHaveLength(1);
    }
  });
});
