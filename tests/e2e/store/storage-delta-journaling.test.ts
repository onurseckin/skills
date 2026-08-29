import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  JsonObject,
  ProjectionPatchOp,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import {
  applyProjectionPatch,
  assertSafeStoragePath,
  loadLatestSnapshot,
  loadSnapshotAtSequence,
  loadSparseIndex,
  migrateLegacyCapsules,
  reconstructStateAtSequence,
  reduceEventStream,
  relocateVestigialLedgers,
  resolveCapsulePaths,
  resolveStoragePaths,
  shouldCreateSnapshot,
  updateSparseIndex,
  writeAtomicSnapshot,
  type CapsulePaths,
} from "../../../olt/scripts/src/engine/store/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

interface LargeJournalFixture {
  readonly capsule: CapsulePaths;
  readonly fullReplayStates: readonly Record<string, unknown>[];
  readonly events: readonly { readonly projection_patch: readonly ProjectionPatchOp[] }[];
}

function buildLargeJournal(root: string, totalEvents = 1000): LargeJournalFixture {
  const capsule = resolveCapsulePaths("run-delta-e2e-01", root);
  mkdirSync(capsule.snapshotsDir, { recursive: true });
  mkdirSync(capsule.blobsDir, { recursive: true });

  const replayStates: Record<string, unknown>[] = [];
  const eventsList: { projection_patch: ProjectionPatchOp[] }[] = [];
  let currentState: Record<string, unknown> = {};
  let previousHash: string | null = null;
  let fileOffset = 0;
  let rawEvents = "";

  for (let seq = 1; seq <= totalEvents; seq += 1) {
    const patchOps: ProjectionPatchOp[] =
      seq === 1
        ? [
            { op: "set", path: ["count"], value: 1 },
            { op: "set", path: ["items"], value: ["item-1"] },
            { op: "set", path: ["meta", "epoch"], value: 0 },
          ]
        : [
            { op: "set", path: ["count"], value: seq },
            { op: "set", path: ["items", String(seq - 1)], value: `item-${seq}` },
            { op: "set", path: ["meta", "epoch"], value: Math.floor(seq / 100) },
          ];

    currentState = applyProjectionPatch(currentState as JsonObject, patchOps);
    replayStates.push(structuredClone(currentState));
    eventsList.push({ projection_patch: patchOps });

    const evContent: JsonObject = {
      actor: "e2e-tester",
      capsule_id: "0123456789abcdef0123456789abcdef",
      kind: "step",
      payload: { index: seq },
      previous_hash: previousHash,
      projection: null,
      projection_patch: patchOps,
      revision: seq,
      run_id: "run-delta-e2e-01",
      schema: "harness.event",
      sequence: seq,
      timestamp: "2026-08-29T12:00:00.000Z",
    };
    const hash = sha256Bytes(canonicalJsonBytes(evContent));
    previousHash = hash;

    const line = JSON.stringify({ ...evContent, hash }) + "\n";
    const lineByteLength = Buffer.byteLength(line, "utf-8");

    if (seq === 1 || seq % 100 === 0) {
      updateSparseIndex(capsule.sparseIndexPath, seq, fileOffset, 100);
    }
    fileOffset += lineByteLength;
    rawEvents += line;

    if (shouldCreateSnapshot(seq, 200)) {
      writeAtomicSnapshot(capsule.snapshotsDir, seq, currentState);
    }
  }

  writeFileSync(capsule.eventsPath, rawEvents, "utf-8");
  return { capsule, fullReplayStates: replayStates, events: eventsList };
}

describe("Storage Delta Journaling E2E Suite", () => {
  describe("1,000-event journal lifecycle & indexing", () => {
    it("executes 1,000 continuous append operations creating snapshots and sparse index", () => {
      const root = scratchRoot(import.meta.path, "e2e-journal-create");
      const { capsule } = buildLargeJournal(root, 1000);

      const sparseIndex = loadSparseIndex(capsule.sparseIndexPath);
      expect(sparseIndex).not.toBeNull();
      expect(sparseIndex?.version).toBe(1);
      const offsets = sparseIndex?.byte_offsets ?? {};
      expect(Object.keys(offsets).length).toBe(11); // seq 1, 100, 200, ..., 1000
      expect(offsets["1"]).toBe(0);
      expect(offsets["1000"]).toBeGreaterThan(offsets["500"]!);

      for (const seq of [200, 400, 600, 800, 1000]) {
        const snap = loadSnapshotAtSequence(capsule.snapshotsDir, seq);
        expect(snap).not.toBeNull();
        expect(snap?.sequence).toBe(seq);
        expect(snap?.state_payload.count).toBe(seq);
      }
    });
  });

  describe("Point-in-time state reconstruction across epochs", () => {
    it("reconstructs state across diverse sequence numbers matching full sequential replay", () => {
      const root = scratchRoot(import.meta.path, "e2e-pit-reconstruction");
      const { capsule, fullReplayStates, events } = buildLargeJournal(root, 1000);

      for (const seq of [50, 200, 250, 600, 750, 1000]) {
        const state = reconstructStateAtSequence(capsule, seq);
        const expected = fullReplayStates[seq - 1];
        expect(state).toEqual(expected!);

        const fullReplay = reduceEventStream({}, events.slice(0, seq));
        expect(state).toEqual(fullReplay);
      }
    });

    it("latency benchmark: point-in-time reconstruction at seq 750 completes in < 25ms", () => {
      const root = scratchRoot(import.meta.path, "e2e-latency-benchmark");
      const { capsule } = buildLargeJournal(root, 1000);

      reconstructStateAtSequence(capsule, 750); // warmup
      const start = performance.now();
      const state = reconstructStateAtSequence(capsule, 750);
      const elapsedMs = performance.now() - start;

      expect(state.count).toBe(750);
      expect(elapsedMs).toBeLessThan(25);
    });
  });

  describe("Torn write resiliency & snapshot loading", () => {
    it("ignores lingering .tmp files from torn writes and loads latest valid snapshot", () => {
      const root = scratchRoot(import.meta.path, "e2e-torn-write");
      const { capsule } = buildLargeJournal(root, 1000);

      const tornTempFile = join(capsule.snapshotsDir, ".tmp.state.800.incompletewrite.json");
      writeFileSync(tornTempFile, '{"sequence": 800, "incomplete": tr', "utf-8");

      const latest = loadLatestSnapshot(capsule.snapshotsDir);
      expect(latest).not.toBeNull();
      expect(latest?.sequence).toBe(1000);

      const stateAt850 = reconstructStateAtSequence(capsule, 850);
      expect(stateAt850.count).toBe(850);
    });

    it("throws INTEGRITY error when a snapshot file payload hash is tampered", () => {
      const root = scratchRoot(import.meta.path, "e2e-tampered-snap");
      const { capsule } = buildLargeJournal(root, 400);

      const snapPath = join(capsule.snapshotsDir, "state.400.json");
      const content = JSON.parse(readFileSync(snapPath, "utf-8")) as JsonObject;
      content.state_payload = { count: 999999, tampered: true };
      writeFileSync(snapPath, JSON.stringify(content), "utf-8");

      expect(() => loadSnapshotAtSequence(capsule.snapshotsDir, 400)).toThrow(HarnessError);
      try {
        loadSnapshotAtSequence(capsule.snapshotsDir, 400);
      } catch (err) {
        expect((err as HarnessError).code).toBe("INTEGRITY");
      }
    });
  });

  describe("Legacy migration and vestigial ledger relocation", () => {
    it("migrates legacy capsules and relocates static olt/ ledgers into .olt/", () => {
      const root = scratchRoot(import.meta.path, "e2e-migration");
      const legacyDir1 = join(root, ".capsules", "legacy-run-alpha");
      const legacyDir2 = join(root, "olt", "capsules", "legacy-run-beta");
      mkdirSync(legacyDir1, { recursive: true });
      mkdirSync(legacyDir2, { recursive: true });

      const ev1: JsonObject = {
        actor: "migrator",
        capsule_id: "0123456789abcdef0123456789abcdef",
        kind: "init",
        payload: { test: 1 },
        previous_hash: null,
        revision: 1,
        run_id: "legacy-run-alpha",
        schema: "harness.event",
        sequence: 1,
        timestamp: "2026-08-29T10:00:00.000Z",
      };
      const h1 = sha256Bytes(canonicalJsonBytes(ev1));
      writeFileSync(
        join(legacyDir1, "events.jsonl"),
        `${JSON.stringify({ ...ev1, hash: h1 })}\n`,
        "utf-8",
      );
      writeFileSync(
        join(legacyDir1, "manifest.json"),
        JSON.stringify({ run_id: "legacy-run-alpha" }),
        "utf-8",
      );

      const ev2: JsonObject = {
        actor: "migrator",
        capsule_id: "0123456789abcdef0123456789abcdef",
        kind: "init",
        payload: { test: 2 },
        previous_hash: null,
        revision: 1,
        run_id: "legacy-run-beta",
        schema: "harness.event",
        sequence: 1,
        timestamp: "2026-08-29T10:00:00.000Z",
      };
      const h2 = sha256Bytes(canonicalJsonBytes(ev2));
      writeFileSync(
        join(legacyDir2, "events.jsonl"),
        `${JSON.stringify({ ...ev2, hash: h2 })}\n`,
        "utf-8",
      );
      writeFileSync(
        join(legacyDir2, "manifest.json"),
        JSON.stringify({ run_id: "legacy-run-beta" }),
        "utf-8",
      );

      const staticOlt = join(root, "olt");
      writeFileSync(
        join(staticOlt, "backlog.jsonl"),
        `${JSON.stringify({ task: "t1" })}\n`,
        "utf-8",
      );
      writeFileSync(
        join(staticOlt, "defects.jsonl"),
        `${JSON.stringify({ defect: "d1" })}\n`,
        "utf-8",
      );
      const staticScratch = join(staticOlt, "scratch");
      mkdirSync(staticScratch, { recursive: true });
      writeFileSync(join(staticScratch, "temp.data"), "scratch-data", "utf-8");

      const migResult = migrateLegacyCapsules(root);
      expect(migResult.migratedCount).toBe(2);
      expect(migResult.errors.length).toBe(0);

      const relocResult = relocateVestigialLedgers(root);
      expect(relocResult.relocatedCount).toBe(3);
      expect(relocResult.errors.length).toBe(0);

      const storage = resolveStoragePaths(root);
      expect(existsSync(join(storage.capsulesDir, "legacy-run-alpha"))).toBe(true);
      expect(existsSync(join(storage.capsulesDir, "legacy-run-beta"))).toBe(true);
      expect(existsSync(storage.globalBacklogPath)).toBe(true);
      expect(existsSync(storage.globalDefectsPath)).toBe(true);
      expect(existsSync(join(storage.scratchDir, "temp.data"))).toBe(true);

      expect(existsSync(join(staticOlt, "backlog.jsonl"))).toBe(false);
      expect(existsSync(join(staticOlt, "defects.jsonl"))).toBe(false);
      expect(existsSync(staticScratch)).toBe(false);
    });
  });

  describe("Strict negative gates & safety invariants", () => {
    it("rejects out-of-bounds, non-integer, or negative sequences", () => {
      const root = scratchRoot(import.meta.path, "e2e-negative-seq");
      const { capsule } = buildLargeJournal(root, 100);

      expect(() => reconstructStateAtSequence(capsule, -5)).toThrow(HarnessError);
      expect(() => reconstructStateAtSequence(capsule, 1.23)).toThrow(HarnessError);
      expect(() => reconstructStateAtSequence(capsule, Number.NaN)).toThrow(HarnessError);
      expect(() => reconstructStateAtSequence(capsule, 500)).toThrow(HarnessError);

      try {
        reconstructStateAtSequence(capsule, 500);
      } catch (err) {
        expect((err as HarnessError).code).toBe("NOT_FOUND");
      }
    });

    it("rejects path traversal and unsafe storage paths", () => {
      const root = scratchRoot(import.meta.path, "e2e-negative-paths");

      expect(() => assertSafeStoragePath("olt/backlog.jsonl", root)).toThrow(HarnessError);
      expect(() => assertSafeStoragePath("../escape", root)).toThrow(HarnessError);
      expect(() => resolveCapsulePaths("../escape-run", root)).toThrow(HarnessError);
      expect(() => resolveCapsulePaths("", root)).toThrow(HarnessError);

      try {
        assertSafeStoragePath("olt/backlog.jsonl", root);
      } catch (err) {
        expect((err as HarnessError).code).toBe("PATH_SAFETY");
      }
    });
  });
});
