import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  persistDagSnapshot,
  loadDagSnapshot,
  __setDagSnapshotPersistenceTestHook,
  type QuotaDagSnapshot,
} from "../../../olt/scripts/src/telemetry/dag-snapshot.ts";
import { readTelemetryStream } from "../../../olt/scripts/src/reporting/telemetry-stream.ts";

describe("DAG Snapshot Persistence & Durability", () => {
  const roots: string[] = [];
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "snap-persist-")));
    roots.push(tmpDir);
  });

  afterEach(() => {
    __setDagSnapshotPersistenceTestHook(undefined);
    for (const root of roots.splice(0)) {
      if (existsSync(root)) {
        rmSync(root, { recursive: true, force: true });
      }
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
      cronsSuspended: [],
      uncommittedFiles: [],
      lowestQuotaObserved,
      constrainedModels: [],
      autoWakeSchedule: {
        resetTime: "2024-01-01T01:00:00Z",
        resumeTime: "2024-01-01T01:01:00Z",
      },
    };
  }

  it("should load correctly after manually writing a snapshot file", () => {
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
    expect(loaded).toBeDefined();
    expect(loaded?.frozenAt).toBe(snapshot.frozenAt);
    expect(loaded?.status).toBe("frozen");
  });

  it("rejects a corrupted canonical snapshot instead of treating it as absent", () => {
    const snapshotPath = join(tmpDir, ".olt", "quota-dag-snapshot.json");
    mkdirSync(join(tmpDir, ".olt"), { recursive: true });
    writeFileSync(snapshotPath, "{ bad json }");
    expect(() => loadDagSnapshot(tmpDir)).toThrow("quota snapshot contains invalid JSON");
  });

  it("refuses a symlinked canonical snapshot without touching its external target", () => {
    const external = join(tmpDir, "external-snapshot.json");
    const snapshotPath = join(tmpDir, ".olt", "quota-dag-snapshot.json");
    mkdirSync(join(tmpDir, ".olt"), { recursive: true });
    writeFileSync(external, "external sentinel", "utf8");
    symlinkSync(external, snapshotPath);

    expect(() => loadDagSnapshot(tmpDir)).toThrow();
    expect(readFileSync(external, "utf8")).toBe("external sentinel");
  });

  it("refuses a hardlinked canonical snapshot without touching its external inode", () => {
    const external = join(tmpDir, "external-snapshot.json");
    const snapshotPath = join(tmpDir, ".olt", "quota-dag-snapshot.json");
    mkdirSync(join(tmpDir, ".olt"), { recursive: true });
    writeFileSync(external, "external sentinel", "utf8");
    linkSync(external, snapshotPath);

    expect(() => loadDagSnapshot(tmpDir)).toThrow();
    expect(readFileSync(external, "utf8")).toBe("external sentinel");
  });

  it("preserves the prior bytes when write, file-fsync, or rename fails before commit", () => {
    persistDagSnapshot(frozenSnapshot());
    const path = join(tmpDir, ".olt", "quota-dag-snapshot.json");
    const before = readFileSync(path, "utf8");

    for (const stage of ["before_write", "before_file_fsync", "before_rename"] as const) {
      __setDagSnapshotPersistenceTestHook((observed) => {
        if (observed === stage) throw new Error(`fault:${stage}`);
      });
      expect(() => persistDagSnapshot(frozenSnapshot(tmpDir, tmpDir, 2))).toThrow(
        `fault:${stage}`,
      );
      __setDagSnapshotPersistenceTestHook(undefined);
      expect(readFileSync(path, "utf8")).toBe(before);
    }
  });

  it("reports post-rename durability uncertainty without false success telemetry", () => {
    persistDagSnapshot(frozenSnapshot());
    for (const stage of ["after_rename", "before_directory_fsync"] as const) {
      const repo = join(tmpDir, stage);
      mkdirSync(repo);
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
