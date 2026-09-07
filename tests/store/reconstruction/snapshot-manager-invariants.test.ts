import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { JsonValue } from "../../../olt/scripts/src/core/contracts/json.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import {
  loadLatestSnapshot,
  loadSnapshotAtSequence,
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
  describe("Negative Gates & Integrity Invariants", () => {
    it("throws HarnessError(INTEGRITY) on corrupted JSON", () => {
      const vfs = getVirtualStoreFS();
      const root = scratchRoot(import.meta.path, "negative-corrupted-json");
      const snapshotsDir = join(root, "snapshots");
      vfs.mkdirSync(snapshotsDir, { recursive: true });

      vfs.writeFileSync(join(snapshotsDir, "state.200.json"), "NOT VALID JSON {", "utf-8");

      expect(() => loadSnapshotAtSequence(snapshotsDir, 200)).toThrow(HarnessError);
      try {
        loadSnapshotAtSequence(snapshotsDir, 200);
      } catch (err) {
        expect((err as HarnessError).code).toBe("INTEGRITY");
      }
    });

    it("throws HarnessError(INTEGRITY) on SHA-256 hash mismatch", () => {
      const vfs = getVirtualStoreFS();
      const root = scratchRoot(import.meta.path, "negative-hash-mismatch");
      const snapshotsDir = join(root, "snapshots");
      vfs.mkdirSync(snapshotsDir, { recursive: true });

      const corruptedSnapshot: SnapshotRecord = {
        sequence: 200,
        snapshot_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        created_at: new Date().toISOString(),
        state_payload: { foo: "bar" },
      };
      vfs.writeFileSync(
        join(snapshotsDir, "state.200.json"),
        JSON.stringify(corruptedSnapshot),
        "utf-8",
      );

      expect(() => loadSnapshotAtSequence(snapshotsDir, 200)).toThrow(HarnessError);
      try {
        loadSnapshotAtSequence(snapshotsDir, 200);
      } catch (err) {
        expect((err as HarnessError).code).toBe("INTEGRITY");
        expect((err as HarnessError).message).toMatch(/hash mismatch/i);
      }
    });

    it("throws HarnessError(INTEGRITY) on sequence mismatch between filename and record", () => {
      const vfs = getVirtualStoreFS();
      const root = scratchRoot(import.meta.path, "negative-seq-mismatch");
      const snapshotsDir = join(root, "snapshots");
      vfs.mkdirSync(snapshotsDir, { recursive: true });

      const payload = { test: true };
      const hash = sha256Bytes(canonicalJsonBytes(payload as unknown as JsonValue));
      const record: SnapshotRecord = {
        sequence: 100,
        snapshot_sha256: hash,
        created_at: new Date().toISOString(),
        state_payload: payload,
      };

      vfs.writeFileSync(join(snapshotsDir, "state.200.json"), JSON.stringify(record), "utf-8");

      expect(() => loadSnapshotAtSequence(snapshotsDir, 200)).toThrow(HarnessError);
      try {
        loadSnapshotAtSequence(snapshotsDir, 200);
      } catch (err) {
        expect((err as HarnessError).code).toBe("INTEGRITY");
        expect((err as HarnessError).message).toMatch(/sequence mismatch/i);
      }
    });

    it("throws HarnessError(INTEGRITY) on missing or malformed fields", () => {
      const vfs = getVirtualStoreFS();
      const root = scratchRoot(import.meta.path, "negative-malformed-fields");
      const snapshotsDir = join(root, "snapshots");
      vfs.mkdirSync(snapshotsDir, { recursive: true });

      const badRecords: unknown[] = [
        { sequence: "200", snapshot_sha256: "abc", created_at: "now", state_payload: {} },
        { sequence: 200, snapshot_sha256: "", created_at: "now", state_payload: {} },
        { sequence: 200, snapshot_sha256: "abc", created_at: "", state_payload: {} },
        { sequence: 200, snapshot_sha256: "abc", created_at: "now", state_payload: [] },
        { sequence: 200, snapshot_sha256: "abc", created_at: "now", state_payload: null },
        [],
        null,
      ];

      for (let i = 0; i < badRecords.length; i++) {
        const seq = 100 + i;
        vfs.writeFileSync(
          join(snapshotsDir, `state.${seq}.json`),
          JSON.stringify(badRecords[i]),
          "utf-8",
        );
        expect(() => loadSnapshotAtSequence(snapshotsDir, seq)).toThrow(HarnessError);
        try {
          loadSnapshotAtSequence(snapshotsDir, seq);
        } catch (err) {
          expect((err as HarnessError).code).toBe("INTEGRITY");
        }
      }
    });

    it("propagates INTEGRITY error during loadLatestSnapshot if latest candidate is corrupted", () => {
      const vfs = getVirtualStoreFS();
      const root = scratchRoot(import.meta.path, "negative-load-latest-corrupt");
      const snapshotsDir = join(root, "snapshots");
      vfs.mkdirSync(snapshotsDir, { recursive: true });

      writeAtomicSnapshot(snapshotsDir, 200, { valid: true });
      vfs.writeFileSync(join(snapshotsDir, "state.400.json"), "CORRUPTED DATA", "utf-8");

      expect(() => loadLatestSnapshot(snapshotsDir)).toThrow(HarnessError);
      try {
        loadLatestSnapshot(snapshotsDir);
      } catch (err) {
        expect((err as HarnessError).code).toBe("INTEGRITY");
      }
    });
  });
});
