import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  resolveStoragePaths,
  assertSafeStoragePath,
  resolveCapsulePaths,
} from "../../../../olt/scripts/src/engine/store/hierarchy/storage-paths.ts";
import {
  loadSparseIndex,
  rebuildSparseIndex,
  seekEventByteOffset,
  DEFAULT_SPARSE_INDEX_INTERVAL,
  SPARSE_INDEX_VERSION,
} from "../../../../olt/scripts/src/engine/store/hierarchy/sparse-index.ts";
import {
  shouldCreateSnapshot,
  writeAtomicSnapshot,
  loadSnapshotAtSequence,
  loadLatestSnapshot,
} from "../../../../olt/scripts/src/engine/store/hierarchy/snapshot-manager.ts";
import {
  shouldTriggerCheckpoint,
  createStateCheckpoint,
  pruneExpiredCheckpoints,
} from "../../../../olt/scripts/src/engine/store/hierarchy/state-checkpointer.ts";
import { compactWalLog } from "../../../../olt/scripts/src/engine/store/hierarchy/wal-compactor.ts";
import { fastForwardProjection } from "../../../../olt/scripts/src/engine/store/hierarchy/reconstruction-engine.ts";
import { recoverDiskState } from "../../../../olt/scripts/src/engine/store/hierarchy/disk-recovery.ts";
import {
  validateEventsFileShaChain,
  validateMigratedRun,
  migrateLegacyCapsules,
  relocateVestigialLedgers,
} from "../../../../olt/scripts/src/engine/store/hierarchy/storage-migrator.ts";

function makeTmpDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

describe("engine/store/hierarchy/storage-paths.ts", () => {
  it("resolves storage and capsule paths correctly", () => {
    const tmp = makeTmpDir("storage-paths-test-");
    try {
      mkdirSync(join(tmp, ".olt"), { recursive: true });
      const storage = resolveStoragePaths(tmp);
      expect(storage.repoRoot).toBe(tmp);
      expect(storage.oltDir).toBe(join(tmp, ".olt"));
      expect(storage.capsulesDir).toBe(join(tmp, ".olt", "capsules"));

      assertSafeStoragePath(join(tmp, ".olt", "policy.json"), tmp);
      expect(() => assertSafeStoragePath("", tmp)).toThrow(HarnessError);
      expect(() => assertSafeStoragePath("bad\0path", tmp)).toThrow(HarnessError);

      const capPaths = resolveCapsulePaths("run-1", tmp);
      expect(capPaths.runRoot).toContain("run-1");
      expect(capPaths.manifestPath).toContain("manifest.json");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("engine/store/hierarchy/snapshot-manager.ts & state-checkpointer.ts", () => {
  it("shouldCreateSnapshot evaluates intervals", () => {
    expect(shouldCreateSnapshot(200, 200)).toBe(true);
    expect(shouldCreateSnapshot(250, 200)).toBe(false);
    expect(shouldCreateSnapshot(0, 200)).toBe(false);
    expect(shouldCreateSnapshot(200, 0)).toBe(false);
  });

  it("writes and loads snapshots", () => {
    const tmp = makeTmpDir("snapshots-test-");
    try {
      const snapDir = join(tmp, "snapshots");
      mkdirSync(snapDir, { recursive: true });

      const snap1 = writeAtomicSnapshot(snapDir, 100, { revision: 1, state: "ok" });
      expect(snap1.sequence).toBe(100);
      expect(existsSync(join(snapDir, "state.100.json"))).toBe(true);

      const snap2 = writeAtomicSnapshot(snapDir, 200, { revision: 2, state: "ok2" });
      expect(snap2.sequence).toBe(200);

      const latest = loadLatestSnapshot(snapDir);
      expect(latest?.sequence).toBe(200);

      const seq100 = loadSnapshotAtSequence(snapDir, 100);
      expect(seq100?.sequence).toBe(100);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("shouldTriggerCheckpoint evaluates metrics and policy", () => {
    expect(shouldTriggerCheckpoint({ sequence: 200 }, { intervalSequences: 200 })).toBe(true);
    expect(shouldTriggerCheckpoint({ sequence: 100 }, { intervalSequences: 200 })).toBe(false);
    expect(shouldTriggerCheckpoint({ sequence: 100, forceCheckpoint: true })).toBe(true);
    expect(shouldTriggerCheckpoint({ sequence: 100, isTerminal: true })).toBe(true);
    expect(
      shouldTriggerCheckpoint(
        { sequence: 100, accumulatedDeltaBytes: 5000 },
        { maxAccumulatedBytes: 4000 },
      ),
    ).toBe(true);
  });

  it("createStateCheckpoint writes snapshot and prunes historical snapshots", () => {
    const tmp = makeTmpDir("checkpointer-test-");
    try {
      const snapDir = join(tmp, "snapshots");
      mkdirSync(snapDir, { recursive: true });

      const snap = createStateCheckpoint(snapDir, 100, { key: "value" });
      expect(snap.sequence).toBe(100);

      const prune = pruneExpiredCheckpoints(snapDir, { retainCount: 1 });
      expect(prune.retainedSequences).toEqual([100]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("engine/store/hierarchy/sparse-index.ts", () => {
  it("loads, builds, and seeks sparse index", () => {
    const tmp = makeTmpDir("sparse-index-test-");
    try {
      const idxPath = join(tmp, "index.sparse.json");
      expect(loadSparseIndex(idxPath)).toBeNull();

      const eventsPath = join(tmp, "events.jsonl");
      const event1 = JSON.stringify({ sequence: 1, event_head: "sha1", payload: {} }) + "\n";
      const event2 = JSON.stringify({ sequence: 2, event_head: "sha2", payload: {} }) + "\n";
      writeFileSync(eventsPath, event1 + event2);

      const built = rebuildSparseIndex(eventsPath, idxPath, 1);
      expect(built.version).toBe(1);
      expect(Object.keys(built.byte_offsets).length).toBe(2);

      const offset = seekEventByteOffset(built, 2, 1);
      expect(offset).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("engine/store/hierarchy/wal-compactor.ts & disk-recovery.ts", () => {
  it("compacts WAL log based on snapshot", () => {
    const tmp = makeTmpDir("wal-compactor-test-");
    try {
      mkdirSync(join(tmp, ".olt"), { recursive: true });
      const capPaths = resolveCapsulePaths("run-wal", tmp);
      mkdirSync(capPaths.snapshotsDir, { recursive: true });

      writeAtomicSnapshot(capPaths.snapshotsDir, 2, {
        schema: "harness.state",
        version: 1,
        revision: 2,
        event_sequence: 2,
        tasks: {},
      });

      const event1 =
        JSON.stringify({
          sequence: 1,
          event_head: "sha1",
          schema: "harness.event",
          version: 1,
          projection: { schema: "harness.state", version: 1, revision: 1, event_sequence: 1 },
        }) + "\n";
      const event2 =
        JSON.stringify({
          sequence: 2,
          event_head: "sha2",
          schema: "harness.event",
          version: 1,
          projection: { schema: "harness.state", version: 1, revision: 2, event_sequence: 2 },
        }) + "\n";
      writeFileSync(capPaths.eventsPath, event1 + event2);

      const result = compactWalLog(capPaths, { upToSequence: 2 });
      expect(result.success).toBe(true);
      expect(result.baseSnapshotSequence).toBe(2);
      expect(result.prunedEventsCount).toBe(1);
      expect(result.retainedEventsCount).toBe(1);

      // Fast forward and recovery
      const outcome = recoverDiskState(capPaths);
      expect(outcome.finalSequence).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("engine/store/hierarchy/storage-migrator.ts", () => {
  it("validates event sha chain and migrates layouts", () => {
    const tmp = makeTmpDir("storage-migrator-test-");
    try {
      mkdirSync(join(tmp, ".olt"), { recursive: true });
      const eventsFile = join(tmp, "events.jsonl");
      writeFileSync(eventsFile, "");
      expect(validateEventsFileShaChain(eventsFile).valid).toBe(true);

      const legacyCapDir = join(tmp, ".capsules", "legacy-run");
      mkdirSync(legacyCapDir, { recursive: true });
      writeFileSync(join(legacyCapDir, "manifest.json"), "{}");

      const migRes = migrateLegacyCapsules(tmp);
      expect(migRes.errors.length).toBe(0);

      const relocRes = relocateVestigialLedgers(tmp);
      expect(relocRes.errors.length).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
