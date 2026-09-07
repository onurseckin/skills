import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  recoverDiskState,
  resolveCapsulePaths,
  writeAtomicSnapshot,
} from "../../../olt/scripts/src/engine/store/index.ts";
import {
  cleanupVirtualStoreFS,
  getVirtualStoreFS,
  scratchRoot,
  setupVirtualStoreFS,
} from "../store-fixture.ts";

function vfs() {
  return getVirtualStoreFS();
}

function getTestRoot(label = "wal-recovery"): string {
  return scratchRoot(import.meta.path, label);
}

function createTestEvent(
  seq: number,
  prevHash: string | null,
  patch: unknown,
  projection: unknown = null,
): string {
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
  beforeEach(() => {
    setupVirtualStoreFS();
  });

  afterEach(() => {
    cleanupVirtualStoreFS();
  });

  describe("recoverDiskState", () => {
    it("recovers state from disk snapshot and delta replay", () => {
      const paths = resolveCapsulePaths("run-rec-01", getTestRoot("rec-01"));
      vfs().mkdirSync(paths.runRoot, { recursive: true });
      vfs().mkdirSync(paths.snapshotsDir, { recursive: true });

      const eventLines: string[] = [];
      for (let i = 1; i <= 250; i++) {
        if (i === 200) {
          eventLines.push(createTestEvent(i, `hash-seq-${i - 1}`, null, { total: 200 }));
        } else {
          eventLines.push(
            createTestEvent(i, i === 1 ? null : `hash-seq-${i - 1}`, [
              { op: "set", path: ["total"], value: i },
            ]),
          );
        }
      }
      vfs().writeFileSync(paths.eventsPath, eventLines.join("\n") + "\n", "utf-8");

      writeAtomicSnapshot(paths.snapshotsDir, 200, { total: 200 });

      const outcome = recoverDiskState(paths);

      expect(outcome.baseSnapshotSequence).toBe(200);
      expect(outcome.finalSequence).toBe(250);
      expect(outcome.replayedEventsCount).toBe(50);
      expect(outcome.recoveredState).toEqual({ total: 250 });
    });

    it("quarantines torn trailing bytes and recovers clean events", () => {
      const paths = resolveCapsulePaths("run-rec-torn-01", getTestRoot("rec-torn-01"));
      vfs().mkdirSync(paths.runRoot, { recursive: true });
      vfs().mkdirSync(paths.snapshotsDir, { recursive: true });

      const eventLines = [
        createTestEvent(1, null, [{ op: "set", path: ["v"], value: 10 }]),
        createTestEvent(2, "hash-seq-1", [{ op: "set", path: ["v"], value: 20 }]),
      ];
      const validBuffer = Buffer.from(eventLines.join("\n") + "\n", "utf-8");
      const tornBytes = Buffer.from('{"sequence": 3, "kind": "unfinis', "utf-8");

      vfs().writeFileSync(paths.eventsPath, Buffer.concat([validBuffer, tornBytes]));

      const outcome = recoverDiskState(paths, { quarantineTornTail: true });

      expect(outcome.quarantinedTail).toBe(true);
      expect(outcome.finalSequence).toBe(2);
      expect(outcome.recoveredState).toEqual({ v: 20 });
      expect(vfs().existsSync(join(paths.runRoot, "quarantine"))).toBe(true);
    });

    it("falls back to earlier valid snapshot when latest is corrupted", () => {
      const paths = resolveCapsulePaths("run-rec-corrupt-snap", getTestRoot("rec-corrupt"));
      vfs().mkdirSync(paths.runRoot, { recursive: true });
      vfs().mkdirSync(paths.snapshotsDir, { recursive: true });

      const eventLines: string[] = [];
      for (let i = 1; i <= 300; i++) {
        if (i === 100 || i === 200) {
          eventLines.push(createTestEvent(i, `hash-seq-${i - 1}`, null, { num: i }));
        } else {
          eventLines.push(
            createTestEvent(i, i === 1 ? null : `hash-seq-${i - 1}`, [
              { op: "set", path: ["num"], value: i },
            ]),
          );
        }
      }
      vfs().writeFileSync(paths.eventsPath, eventLines.join("\n") + "\n", "utf-8");

      writeAtomicSnapshot(paths.snapshotsDir, 100, { num: 100 });
      vfs().writeFileSync(
        join(paths.snapshotsDir, "state.200.json"),
        "CORRUPTED_JSON_CONTENT",
        "utf-8",
      );

      const outcome = recoverDiskState(paths);

      expect(outcome.baseSnapshotSequence).toBe(100);
      expect(outcome.finalSequence).toBe(300);
      expect(outcome.replayedEventsCount).toBe(200);
      expect(outcome.recoveredState).toEqual({ num: 300 });
    });

    it("recovers full state from sequence 1 when all snapshots are corrupted", () => {
      const paths = resolveCapsulePaths("run-rec-all-corrupt", getTestRoot("rec-all-corrupt"));
      vfs().mkdirSync(paths.runRoot, { recursive: true });
      vfs().mkdirSync(paths.snapshotsDir, { recursive: true });

      const eventLines = [
        createTestEvent(1, null, [{ op: "set", path: ["count"], value: 10 }]),
        createTestEvent(2, "hash-seq-1", [{ op: "set", path: ["count"], value: 20 }]),
        createTestEvent(3, "hash-seq-2", [{ op: "set", path: ["count"], value: 30 }]),
      ];
      vfs().writeFileSync(paths.eventsPath, eventLines.join("\n") + "\n", "utf-8");

      vfs().writeFileSync(join(paths.snapshotsDir, "state.1.json"), "NOT_JSON_A", "utf-8");
      vfs().writeFileSync(join(paths.snapshotsDir, "state.2.json"), "{ invalid: json", "utf-8");

      const outcome = recoverDiskState(paths);
      expect(outcome.baseSnapshotSequence).toBe(0);
      expect(outcome.finalSequence).toBe(3);
      expect(outcome.replayedEventsCount).toBe(3);
      expect(outcome.recoveredState).toEqual({ count: 30 });
    });
  });
});
