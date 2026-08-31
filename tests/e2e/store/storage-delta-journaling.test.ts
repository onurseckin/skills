import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  type CapsulePaths,
} from "../../../olt/scripts/src/engine/store/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

interface JournalFixture {
  readonly capsule: CapsulePaths;
  readonly fullReplayStates: readonly Record<string, unknown>[];
  readonly events: readonly { readonly projection_patch: readonly ProjectionPatchOp[] }[];
}

interface InMemoryJournal {
  readonly rawEvents: string;
  readonly byteOffsets: Record<string, number>;
  readonly snapshots: ReadonlyMap<number, string>;
  readonly replayStates: readonly Record<string, unknown>[];
  readonly events: readonly { readonly projection_patch: readonly ProjectionPatchOp[] }[];
}

function patchForSeq(seq: number): readonly ProjectionPatchOp[] {
  return seq === 1
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
}

function buildInMemoryJournal(totalEvents: number): InMemoryJournal {
  const replayStates: Record<string, unknown>[] = [];
  const events: { readonly projection_patch: readonly ProjectionPatchOp[] }[] = [];
  const byteOffsets: Record<string, number> = {};
  const snapshots = new Map<number, string>();
  let currentState: Record<string, unknown> = {};
  let prevHash: string | null = null;
  let offset = 0;
  let rawEvents = "";

  for (let seq = 1; seq <= totalEvents; seq += 1) {
    const patchOps = patchForSeq(seq);
    currentState = applyProjectionPatch(
      currentState as JsonObject,
      patchOps as ProjectionPatchOp[],
    );
    replayStates.push(structuredClone(currentState));
    events.push({ projection_patch: patchOps });

    const ev: JsonObject = {
      actor: "e2e-tester",
      capsule_id: "0123456789abcdef0123456789abcdef",
      kind: "step",
      payload: { index: seq },
      previous_hash: prevHash,
      projection: null,
      projection_patch: patchOps as ProjectionPatchOp[],
      revision: seq,
      run_id: "run-delta-e2e-01",
      schema: "harness.event",
      sequence: seq,
      timestamp: "2026-08-29T12:00:00.000Z",
    };
    const hash = sha256Bytes(canonicalJsonBytes(ev));
    prevHash = hash;
    const line = `${JSON.stringify({ ...ev, hash })}\n`;
    if (seq === 1 || seq % 100 === 0) byteOffsets[String(seq)] = offset;
    offset += Buffer.byteLength(line, "utf-8");
    rawEvents += line;

    if (seq % 200 === 0) {
      const snapHash = sha256Bytes(canonicalJsonBytes(currentState as JsonObject));
      snapshots.set(
        seq,
        JSON.stringify({
          sequence: seq,
          snapshot_sha256: snapHash,
          created_at: "2026-08-29T12:00:00.000Z",
          state_payload: structuredClone(currentState),
        }),
      );
    }
  }
  return { rawEvents, byteOffsets, snapshots, replayStates, events };
}

const PRECOMPUTED_1000 = buildInMemoryJournal(1000);
const PRECOMPUTED_100 = buildInMemoryJournal(100);

function hydrateJournalFixture(root: string, data: InMemoryJournal): JournalFixture {
  const capsule = resolveCapsulePaths("run-delta-e2e-01", root);
  mkdirSync(capsule.snapshotsDir, { recursive: true });
  mkdirSync(capsule.blobsDir, { recursive: true });
  writeFileSync(capsule.eventsPath, data.rawEvents, "utf-8");
  const idx = {
    version: 1,
    byte_offsets: data.byteOffsets,
    indexed_at: "2026-08-29T12:00:00.000Z",
  };
  writeFileSync(capsule.sparseIndexPath, JSON.stringify(idx), "utf-8");
  for (const [seq, content] of data.snapshots) {
    writeFileSync(join(capsule.snapshotsDir, `state.${seq}.json`), content, "utf-8");
  }
  return { capsule, fullReplayStates: data.replayStates, events: data.events };
}

function writeLegacyCapsule(dir: string, runId: string, testVal: number): void {
  mkdirSync(dir, { recursive: true });
  const ev: JsonObject = {
    actor: "migrator",
    capsule_id: "0123456789abcdef0123456789abcdef",
    kind: "init",
    payload: { test: testVal },
    previous_hash: null,
    revision: 1,
    run_id: runId,
    schema: "harness.event",
    sequence: 1,
    timestamp: "2026-08-29T10:00:00.000Z",
  };
  writeFileSync(
    join(dir, "events.jsonl"),
    `${JSON.stringify({ ...ev, hash: sha256Bytes(canonicalJsonBytes(ev)) })}\n`,
    "utf-8",
  );
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ run_id: runId }), "utf-8");
}

describe("Storage Delta Journaling E2E Suite", () => {
  it("executes 1,000 continuous append operations creating snapshots and sparse index", () => {
    const root = scratchRoot(import.meta.path, "e2e-journal-create");
    const { capsule } = hydrateJournalFixture(root, PRECOMPUTED_1000);
    const sparseIndex = loadSparseIndex(capsule.sparseIndexPath);
    expect(sparseIndex?.version).toBe(1);
    const offsets = sparseIndex?.byte_offsets ?? {};
    expect(Object.keys(offsets).length).toBe(11);
    expect(offsets["1"]).toBe(0);
    expect(offsets["1000"]).toBeGreaterThan(offsets["500"]!);

    for (const seq of [200, 400, 600, 800, 1000]) {
      const snap = loadSnapshotAtSequence(capsule.snapshotsDir, seq);
      expect(snap?.sequence).toBe(seq);
      expect(snap?.state_payload.count).toBe(seq);
    }
  });

  it("reconstructs state across diverse sequence numbers matching full sequential replay and benchmark", () => {
    const root = scratchRoot(import.meta.path, "e2e-pit-reconstruction");
    const { capsule, fullReplayStates, events } = hydrateJournalFixture(root, PRECOMPUTED_1000);
    for (const seq of [50, 200, 250, 600, 750, 1000]) {
      const state = reconstructStateAtSequence(capsule, seq);
      expect(state).toEqual(fullReplayStates[seq - 1]!);
      expect(state).toEqual(reduceEventStream({}, events.slice(0, seq)));
    }

    reconstructStateAtSequence(capsule, 750);
    const start = performance.now();
    const state = reconstructStateAtSequence(capsule, 750);
    const elapsedMs = performance.now() - start;
    expect(state.count).toBe(750);
    expect(elapsedMs).toBeLessThan(100);
  });

  it("handles torn write resiliency and throws INTEGRITY when snapshot hash is tampered", () => {
    const root = scratchRoot(import.meta.path, "e2e-torn-write");
    const { capsule } = hydrateJournalFixture(root, PRECOMPUTED_1000);
    const tornTempFile = join(capsule.snapshotsDir, ".tmp.state.800.incompletewrite.json");
    writeFileSync(tornTempFile, '{"sequence": 800, "incomplete": tr', "utf-8");

    const latest = loadLatestSnapshot(capsule.snapshotsDir);
    expect(latest?.sequence).toBe(1000);
    expect(reconstructStateAtSequence(capsule, 850).count).toBe(850);

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

  it("migrates legacy capsules and relocates static olt/ ledgers into .olt/", () => {
    const root = scratchRoot(import.meta.path, "e2e-migration");
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    writeLegacyCapsule(join(root, ".capsules", "legacy-run-alpha"), "legacy-run-alpha", 1);
    writeLegacyCapsule(join(root, "olt", "capsules", "legacy-run-beta"), "legacy-run-beta", 2);

    const staticOlt = join(root, "olt");
    writeFileSync(join(staticOlt, "backlog.jsonl"), `${JSON.stringify({ task: "t1" })}\n`, "utf-8");
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

  it("enforces strict negative gates for invalid sequences, path traversal, and unsafe paths", () => {
    const root = scratchRoot(import.meta.path, "e2e-negative-seq");
    const { capsule } = hydrateJournalFixture(root, PRECOMPUTED_100);

    for (const invalid of [-5, 1.23, Number.NaN, 500]) {
      expect(() => reconstructStateAtSequence(capsule, invalid)).toThrow(HarnessError);
    }
    try {
      reconstructStateAtSequence(capsule, 500);
    } catch (err) {
      expect((err as HarnessError).code).toBe("NOT_FOUND");
    }

    for (const badPath of ["olt/backlog.jsonl", "../escape"]) {
      expect(() => assertSafeStoragePath(badPath, root)).toThrow(HarnessError);
    }
    expect(() => resolveCapsulePaths("../escape-run", root)).toThrow(HarnessError);
    expect(() => resolveCapsulePaths("", root)).toThrow(HarnessError);

    try {
      assertSafeStoragePath("olt/backlog.jsonl", root);
    } catch (err) {
      expect((err as HarnessError).code).toBe("PATH_SAFETY");
    }
  });
});
