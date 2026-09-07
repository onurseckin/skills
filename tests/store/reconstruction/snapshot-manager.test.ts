import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { JsonValue } from "../../../olt/scripts/src/core/contracts/json.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import {
  loadLatestSnapshot,
  loadSnapshotAtSequence,
  shouldCreateSnapshot,
  writeAtomicSnapshot,
  type SnapshotRecord,
} from "../../../olt/scripts/src/engine/store/hierarchy/snapshot-manager.ts";
import {
  cleanupVirtualStoreFS,
  getVirtualStoreFS,
  resetVirtualStore,
  scratchRoot,
  setupVirtualStoreFS,
} from "../store-fixture.ts";

setupVirtualStoreFS();

beforeEach(() => {
  resetVirtualStore();
});

afterEach(() => {
  resetVirtualStore();
});

afterAll(() => {
  cleanupVirtualStoreFS();
});

describe("Snapshot Manager Engine", () => {
  describe("shouldCreateSnapshot", () => {
    it("returns true strictly for positive multiples of the interval", () => {
      expect(shouldCreateSnapshot(200, 200)).toBe(true);
      expect(shouldCreateSnapshot(400, 200)).toBe(true);
      expect(shouldCreateSnapshot(1000, 200)).toBe(true);
      expect(shouldCreateSnapshot(200)).toBe(true);
      expect(shouldCreateSnapshot(400)).toBe(true);
    });

    it("returns false for non-multiples, zero, negative, and invalid values", () => {
      expect(shouldCreateSnapshot(199, 200)).toBe(false);
      expect(shouldCreateSnapshot(201, 200)).toBe(false);
      expect(shouldCreateSnapshot(0, 200)).toBe(false);
      expect(shouldCreateSnapshot(-1, 200)).toBe(false);
      expect(shouldCreateSnapshot(-200, 200)).toBe(false);
      expect(shouldCreateSnapshot(Number.NaN, 200)).toBe(false);
      expect(shouldCreateSnapshot(200.5, 200)).toBe(false);
      expect(shouldCreateSnapshot(200, 0)).toBe(false);
      expect(shouldCreateSnapshot(200, -50)).toBe(false);
      expect(shouldCreateSnapshot(200, Number.NaN)).toBe(false);
    });

    it("supports custom intervals", () => {
      expect(shouldCreateSnapshot(50, 50)).toBe(true);
      expect(shouldCreateSnapshot(100, 50)).toBe(true);
      expect(shouldCreateSnapshot(75, 50)).toBe(false);
    });
  });

  describe("writeAtomicSnapshot", () => {
    it("atomically creates a snapshot file with exact record structure and canonical hash", () => {
      const root = scratchRoot(import.meta.path, "write-atomic-valid");
      const snapshotsDir = join(root, ".olt", "capsules", "run-01", "snapshots");
      const payload: Record<string, unknown> = {
        revision: 200,
        status: "in_progress",
        meta: { nested: true, count: 42 },
      };

      const record = writeAtomicSnapshot(snapshotsDir, 200, payload);

      expect(record.sequence).toBe(200);
      expect(record.state_payload).toEqual(payload);
      const expectedSha = sha256Bytes(canonicalJsonBytes(payload as unknown as JsonValue));
      expect(record.snapshot_sha256).toBe(expectedSha);
      expect(typeof record.created_at).toBe("string");
      expect(Number.isNaN(Date.parse(record.created_at))).toBe(false);

      const vfs = getVirtualStoreFS();
      const targetFile = join(snapshotsDir, "state.200.json");
      expect(vfs.existsSync(targetFile)).toBe(true);

      const raw = vfs.readFileSync(targetFile, "utf-8");
      const diskRecord = JSON.parse(raw) as SnapshotRecord;
      expect(diskRecord.sequence).toBe(200);
      expect(diskRecord.snapshot_sha256).toBe(expectedSha);
      expect(diskRecord.state_payload).toEqual(payload);
    });

    it("rejects invalid arguments with INVALID_ARGUMENT HarnessError", () => {
      const root = scratchRoot(import.meta.path, "write-invalid-args");
      const snapshotsDir = join(root, "snapshots");

      expect(() => writeAtomicSnapshot(snapshotsDir, -1, { key: "value" })).toThrow(HarnessError);
      expect(() => writeAtomicSnapshot(snapshotsDir, 1.5, { key: "value" })).toThrow(HarnessError);

      try {
        writeAtomicSnapshot(snapshotsDir, -1, { key: "value" });
      } catch (err) {
        expect((err as HarnessError).code).toBe("INVALID_ARGUMENT");
      }

      expect(() =>
        writeAtomicSnapshot(snapshotsDir, 200, null as unknown as Record<string, unknown>),
      ).toThrow(HarnessError);
    });
  });

  describe("loadSnapshotAtSequence", () => {
    it("loads an existing snapshot record and validates its integrity", () => {
      const root = scratchRoot(import.meta.path, "load-seq-valid");
      const snapshotsDir = join(root, "snapshots");
      const payload = { counter: 10, mode: "active" };

      writeAtomicSnapshot(snapshotsDir, 200, payload);
      const loaded = loadSnapshotAtSequence(snapshotsDir, 200);

      expect(loaded).not.toBeNull();
      expect(loaded?.sequence).toBe(200);
      expect(loaded?.state_payload).toEqual(payload);
    });

    it("returns null if snapshot file does not exist", () => {
      const root = scratchRoot(import.meta.path, "load-seq-missing");
      const snapshotsDir = join(root, "snapshots");

      const loaded = loadSnapshotAtSequence(snapshotsDir, 400);
      expect(loaded).toBeNull();
    });
  });

  describe("loadLatestSnapshot", () => {
    it("finds the snapshot with the highest sequence number without maxSequence", () => {
      const root = scratchRoot(import.meta.path, "load-latest-unbounded");
      const snapshotsDir = join(root, "snapshots");

      writeAtomicSnapshot(snapshotsDir, 200, { step: 200 });
      writeAtomicSnapshot(snapshotsDir, 400, { step: 400 });
      writeAtomicSnapshot(snapshotsDir, 600, { step: 600 });

      const loaded = loadLatestSnapshot(snapshotsDir);
      expect(loaded).not.toBeNull();
      expect(loaded?.sequence).toBe(600);
      expect(loaded?.state_payload).toEqual({ step: 600 });
    });

    it("finds the highest snapshot bounded by maxSequence", () => {
      const root = scratchRoot(import.meta.path, "load-latest-bounded");
      const snapshotsDir = join(root, "snapshots");

      writeAtomicSnapshot(snapshotsDir, 200, { step: 200 });
      writeAtomicSnapshot(snapshotsDir, 400, { step: 400 });
      writeAtomicSnapshot(snapshotsDir, 600, { step: 600 });

      const boundedAt500 = loadLatestSnapshot(snapshotsDir, 500);
      expect(boundedAt500?.sequence).toBe(400);

      const boundedAt400 = loadLatestSnapshot(snapshotsDir, 400);
      expect(boundedAt400?.sequence).toBe(400);

      const boundedAt100 = loadLatestSnapshot(snapshotsDir, 100);
      expect(boundedAt100).toBeNull();
    });

    it("returns null when directory does not exist or has no snapshot files", () => {
      const vfs = getVirtualStoreFS();
      const root = scratchRoot(import.meta.path, "load-latest-empty");
      const nonExistentDir = join(root, "does-not-exist");
      expect(loadLatestSnapshot(nonExistentDir)).toBeNull();

      const emptyDir = join(root, "empty-snapshots");
      vfs.mkdirSync(emptyDir, { recursive: true });
      expect(loadLatestSnapshot(emptyDir)).toBeNull();
    });
  });
});
