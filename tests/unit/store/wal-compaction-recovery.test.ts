import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  compactWalLog,
  createStateCheckpoint,
  loadLatestSnapshot,
  pruneExpiredCheckpoints,
  recoverDiskState,
  resolveCapsulePaths,
  shouldTriggerCheckpoint,
  updateSparseIndex,
  writeAtomicSnapshot,
} from "../../../olt/scripts/src/engine/store/index.ts";

const TEST_ROOT = join(process.cwd(), ".tmp", `test-wal-compaction-${Date.now()}`);

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

function createTestEvent(seq: number, prevHash: string | null, patch: unknown, projection: unknown = null): string {
  const payload = {
    schema: "harness.event",
    version: 1,
    run_id: "run-wal-test-01",
    capsule_id: "cap-wal-test-01",
    sequence: seq,
    revision: seq,
    timestamp: new Date().toISOString(),
    actor: "implementer_12",
    kind: "task:progress",
    payload: { step: seq },
    previous_hash: prevHash,
    projection,
    projection_patch: patch,
    hash: `hash-seq-${seq}`,
  };
  return JSON.stringify(payload);
}

describe("WAL Compaction & State Checkpointing Extensions", () => {
  describe("shouldTriggerCheckpoint", () => {
    it("returns true on exact interval sequences", () => {
      expect(shouldTriggerCheckpoint({ sequence: 200 }, { intervalSequences: 200 })).toBe(true);
      expect(shouldTriggerCheckpoint({ sequence: 400 }, { intervalSequences: 200 })).toBe(true);
      expect(shouldTriggerCheckpoint({ sequence: 199 }, { intervalSequences: 200 })).toBe(false);
    });

    it("returns true on terminal state or forced checkpoint", () => {
      expect(shouldTriggerCheckpoint({ sequence: 45, isTerminal: true })).toBe(true);
      expect(shouldTriggerCheckpoint({ sequence: 45, forceCheckpoint: true })).toBe(true);
      expect(shouldTriggerCheckpoint({ sequence: 45, isTerminal: false })).toBe(false);
    });

    it("returns true when accumulated delta bytes exceeds threshold", () => {
      expect(
        shouldTriggerCheckpoint(
          { sequence: 50, accumulatedDeltaBytes: 1024 * 1024 },
          { maxAccumulatedBytes: 512 * 1024 },
        ),
      ).toBe(true);
      expect(
        shouldTriggerCheckpoint(
          { sequence: 50, accumulatedDeltaBytes: 256 * 1024 },
          { maxAccumulatedBytes: 512 * 1024 },
        ),
      ).toBe(false);
    });

    it("handles invalid or non-positive sequences gracefully", () => {
      expect(shouldTriggerCheckpoint({ sequence: 0 })).toBe(false);
      expect(shouldTriggerCheckpoint({ sequence: -10 })).toBe(false);
    });
  });

  describe("createStateCheckpoint & pruneExpiredCheckpoints", () => {
    it("creates snapshots and prunes older ones adhering to retention limits", () => {
      const paths = resolveCapsulePaths("run-chk-01", TEST_ROOT);
      mkdirSync(paths.snapshotsDir, { recursive: true });

      createStateCheckpoint(paths.snapshotsDir, 100, { count: 100 });
      createStateCheckpoint(paths.snapshotsDir, 200, { count: 200 });
      createStateCheckpoint(paths.snapshotsDir, 300, { count: 300 });
      createStateCheckpoint(paths.snapshotsDir, 400, { count: 400 });
      createStateCheckpoint(paths.snapshotsDir, 500, { count: 500 });
      createStateCheckpoint(paths.snapshotsDir, 600, { count: 600 });

      const pruneRes = pruneExpiredCheckpoints(paths.snapshotsDir, {
        retainCount: 3,
      });

      expect(pruneRes.totalFound).toBe(6);
      expect(pruneRes.prunedCount).toBe(3);
      expect(pruneRes.retainedSequences).toEqual([400, 500, 600]);
      expect(pruneRes.prunedSequences).toEqual([100, 200, 300]);

      expect(existsSync(join(paths.snapshotsDir, "state.100.json"))).toBe(false);
      expect(existsSync(join(paths.snapshotsDir, "state.600.json"))).toBe(true);
    });
  });

  describe("compactWalLog", () => {
    it("compacts events up to latest snapshot and archives pruned events", () => {
      const paths = resolveCapsulePaths("run-compact-01", TEST_ROOT);
      mkdirSync(paths.runRoot, { recursive: true });
      mkdirSync(paths.snapshotsDir, { recursive: true });

      const eventLines: string[] = [];
      for (let i = 1; i <= 500; i++) {
        if (i === 200 || i === 400) {
          eventLines.push(createTestEvent(i, `hash-seq-${i - 1}`, null, { counter: i }));
        } else {
          eventLines.push(
            createTestEvent(i, i === 1 ? null : `hash-seq-${i - 1}`, [{ op: "set", path: ["counter"], value: i }]),
          );
        }
      }

      writeFileSync(paths.eventsPath, eventLines.join("\n") + "\n", "utf-8");

      writeAtomicSnapshot(paths.snapshotsDir, 200, { counter: 200 });
      writeAtomicSnapshot(paths.snapshotsDir, 400, { counter: 400 });

      const result = compactWalLog(paths, { upToSequence: 400, archiveHistoricalEvents: true });

      expect(result.success).toBe(true);
      expect(result.baseSnapshotSequence).toBe(400);
      expect(result.originalEventsCount).toBe(500);
      expect(result.prunedEventsCount).toBe(399);
      expect(result.retainedEventsCount).toBe(101);
      expect(result.archivedPath).toBeDefined();
      expect(existsSync(result.archivedPath!)).toBe(true);

      const compactedContent = readFileSync(paths.eventsPath, "utf-8").trim().split("\n");
      expect(compactedContent.length).toBe(101);

      const firstRetained = JSON.parse(compactedContent[0]!);
      expect(firstRetained.sequence).toBe(400);

      const lastRetained = JSON.parse(compactedContent[compactedContent.length - 1]!);
      expect(lastRetained.sequence).toBe(500);
    });

    it("returns early when no snapshot or sequence <= 1", () => {
      const paths = resolveCapsulePaths("run-compact-02", TEST_ROOT);
      mkdirSync(paths.runRoot, { recursive: true });
      writeFileSync(paths.eventsPath, createTestEvent(1, null, [{ op: "set", path: ["x"], value: 1 }]) + "\n");

      const result = compactWalLog(paths);
      expect(result.success).toBe(true);
      expect(result.prunedEventsCount).toBe(0);
    });
  });

  describe("recoverDiskState", () => {
    it("recovers state from disk snapshot and delta replay", () => {
      const paths = resolveCapsulePaths("run-rec-01", TEST_ROOT);
      mkdirSync(paths.runRoot, { recursive: true });
      mkdirSync(paths.snapshotsDir, { recursive: true });

      const eventLines: string[] = [];
      for (let i = 1; i <= 250; i++) {
        if (i === 200) {
          eventLines.push(createTestEvent(i, `hash-seq-${i - 1}`, null, { total: 200 }));
        } else {
          eventLines.push(
            createTestEvent(i, i === 1 ? null : `hash-seq-${i - 1}`, [{ op: "set", path: ["total"], value: i }]),
          );
        }
      }
      writeFileSync(paths.eventsPath, eventLines.join("\n") + "\n", "utf-8");

      writeAtomicSnapshot(paths.snapshotsDir, 200, { total: 200 });

      const outcome = recoverDiskState(paths);

      expect(outcome.baseSnapshotSequence).toBe(200);
      expect(outcome.finalSequence).toBe(250);
      expect(outcome.replayedEventsCount).toBe(50);
      expect(outcome.recoveredState).toEqual({ total: 250 });
    });

    it("quarantines torn trailing bytes and recovers clean events", () => {
      const paths = resolveCapsulePaths("run-rec-torn-01", TEST_ROOT);
      mkdirSync(paths.runRoot, { recursive: true });
      mkdirSync(paths.snapshotsDir, { recursive: true });

      const eventLines = [
        createTestEvent(1, null, [{ op: "set", path: ["v"], value: 10 }]),
        createTestEvent(2, "hash-seq-1", [{ op: "set", path: ["v"], value: 20 }]),
      ];
      const validBuffer = Buffer.from(eventLines.join("\n") + "\n", "utf-8");
      const tornBytes = Buffer.from('{"sequence": 3, "kind": "unfinis', "utf-8");

      writeFileSync(paths.eventsPath, Buffer.concat([validBuffer, tornBytes]));

      const outcome = recoverDiskState(paths, { quarantineTornTail: true });

      expect(outcome.quarantinedTail).toBe(true);
      expect(outcome.finalSequence).toBe(2);
      expect(outcome.recoveredState).toEqual({ v: 20 });
      expect(existsSync(join(paths.runRoot, "quarantine"))).toBe(true);
    });

    it("falls back to earlier valid snapshot when latest is corrupted", () => {
      const paths = resolveCapsulePaths("run-rec-corrupt-snap", TEST_ROOT);
      mkdirSync(paths.runRoot, { recursive: true });
      mkdirSync(paths.snapshotsDir, { recursive: true });

      const eventLines: string[] = [];
      for (let i = 1; i <= 300; i++) {
        if (i === 100 || i === 200) {
          eventLines.push(createTestEvent(i, `hash-seq-${i - 1}`, null, { num: i }));
        } else {
          eventLines.push(
            createTestEvent(i, i === 1 ? null : `hash-seq-${i - 1}`, [{ op: "set", path: ["num"], value: i }]),
          );
        }
      }
      writeFileSync(paths.eventsPath, eventLines.join("\n") + "\n", "utf-8");

      writeAtomicSnapshot(paths.snapshotsDir, 100, { num: 100 });
      writeFileSync(join(paths.snapshotsDir, "state.200.json"), "CORRUPTED_JSON_CONTENT", "utf-8");

      const outcome = recoverDiskState(paths);

      expect(outcome.baseSnapshotSequence).toBe(100);
      expect(outcome.finalSequence).toBe(300);
      expect(outcome.replayedEventsCount).toBe(200);
      expect(outcome.recoveredState).toEqual({ num: 300 });
    });
  });
});
