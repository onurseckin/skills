import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { ProjectionPatchOp } from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { writeAtomicSnapshot } from "../../../olt/scripts/src/engine/store/hierarchy/snapshot-manager.ts";
import { rebuildSparseIndex } from "../../../olt/scripts/src/engine/store/hierarchy/sparse-index.ts";
import type { CapsulePaths } from "../../../olt/scripts/src/engine/store/hierarchy/storage-paths.ts";
import {
  fastForwardProjection,
  reconstructStateAtSequence,
} from "../../../olt/scripts/src/engine/store/hierarchy/reconstruction-engine.ts";
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

function createEventLine(seq: number, patchOps?: ProjectionPatchOp[]): string {
  if (patchOps) {
    return `${JSON.stringify({
      schema: "harness.event",
      version: 1,
      run_id: "run-01",
      capsule_id: "0123456789abcdef0123456789abcdef",
      sequence: seq,
      revision: seq,
      timestamp: "2026-08-29T00:00:00.000Z",
      actor: "system",
      kind: "step",
      payload: { seq },
      previous_hash: null,
      projection: null,
      projection_patch: patchOps,
      hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    })}\n`;
  }
  const patch =
    seq === 1
      ? '[{"op":"set","path":["count"],"value":1},{"op":"set","path":["items"],"value":["item-1"]}]'
      : `[{"op":"set","path":["count"],"value":${seq}},{"op":"set","path":["items","${seq - 1}"],"value":"item-${seq}"}]`;
  return `{"schema":"harness.event","version":1,"run_id":"run-01","capsule_id":"0123456789abcdef0123456789abcdef","sequence":${seq},"revision":${seq},"timestamp":"2026-08-29T00:00:00.000Z","actor":"system","kind":"step","payload":{"seq":${seq}},"previous_hash":null,"projection":null,"projection_patch":${patch},"hash":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}\n`;
}

function makeCapsulePaths(rootDir: string): CapsulePaths {
  return {
    runRoot: rootDir,
    manifestPath: join(rootDir, "manifest.json"),
    eventsPath: join(rootDir, "events.jsonl"),
    statePath: join(rootDir, "state.json"),
    sparseIndexPath: join(rootDir, "sparse-index.json"),
    snapshotsDir: join(rootDir, "snapshots"),
    blobsDir: join(rootDir, "blobs"),
    tracePath: join(rootDir, "trace.md"),
  };
}

interface CapsuleTemplate {
  eventsContent: string;
  sparseIndexJson: string;
  snapshot200Payload?: Record<string, unknown>;
  snapshot400Payload?: Record<string, unknown>;
}

function buildCapsuleTemplate(totalEvents: number): CapsuleTemplate {
  let eventsContent = "";
  const items: string[] = [];
  const byteOffsets: Record<string, number> = {};
  let currentOffset = 0;
  let snap200: Record<string, unknown> | undefined;
  let snap400: Record<string, unknown> | undefined;

  for (let seq = 1; seq <= totalEvents; seq++) {
    items.push(`item-${seq}`);
    if (seq === 1 || seq % 100 === 0) {
      byteOffsets[String(seq)] = currentOffset;
    }
    const line = createEventLine(seq);
    currentOffset += Buffer.byteLength(line, "utf-8");
    eventsContent += line;

    if (seq === 200) {
      snap200 = {
        count: seq,
        items: [...items],
        snapshot_marker: `snap-${seq}`,
      };
    } else if (seq === 400) {
      snap400 = {
        count: seq,
        items: [...items],
        snapshot_marker: `snap-${seq}`,
      };
    }
  }

  return {
    eventsContent,
    sparseIndexJson: JSON.stringify({
      version: 1,
      indexed_at: "2026-08-29T00:00:00.000Z",
      byte_offsets: byteOffsets,
    }),
    snapshot200Payload: snap200,
    snapshot400Payload: snap400,
  };
}

const TEMPLATE_500 = buildCapsuleTemplate(500);
const TEMPLATE_100 = buildCapsuleTemplate(100);

function setupTestCapsule(rootDir: string, totalEvents = 500): CapsulePaths {
  const vfs = getVirtualStoreFS();
  const capsulePaths = makeCapsulePaths(rootDir);
  vfs.mkdirSync(capsulePaths.snapshotsDir, { recursive: true });

  const template =
    totalEvents === 500
      ? TEMPLATE_500
      : totalEvents === 100
        ? TEMPLATE_100
        : buildCapsuleTemplate(totalEvents);

  if (template.snapshot200Payload) {
    writeAtomicSnapshot(capsulePaths.snapshotsDir, 200, template.snapshot200Payload);
  }
  if (template.snapshot400Payload) {
    writeAtomicSnapshot(capsulePaths.snapshotsDir, 400, template.snapshot400Payload);
  }

  vfs.writeFileSync(capsulePaths.eventsPath, template.eventsContent, "utf-8");
  vfs.writeFileSync(capsulePaths.sparseIndexPath, template.sparseIndexJson, "utf-8");
  return capsulePaths;
}

describe("Reconstruction Engine", () => {
  describe("reconstructStateAtSequence", () => {
    it("reconstructs sequence 350 from a 500-event log loading snapshot 200 and replaying 150 events", () => {
      const root = scratchRoot(import.meta.path, "recon-350");
      const paths = setupTestCapsule(root, 500);

      const state = reconstructStateAtSequence(paths, 350);
      expect(state.count).toBe(350);
      expect(state.snapshot_marker).toBe("snap-200");
      const items = state.items as string[];
      expect(items).toHaveLength(350);
      expect(items[0]).toBe("item-1");
      expect(items[199]).toBe("item-200");
      expect(items[349]).toBe("item-350");
    });

    it("latency check: reconstructing sequence 350 takes < 100ms", () => {
      const root = scratchRoot(import.meta.path, "recon-latency");
      const paths = setupTestCapsule(root, 500);

      const start = performance.now();
      const state = reconstructStateAtSequence(paths, 350);
      const elapsedMs = performance.now() - start;

      expect(state.count).toBe(350);
      expect(elapsedMs).toBeLessThan(100);
    });

    it("reconstructing sequence 200 returns snapshot 200 directly with 0 event replays", () => {
      const root = scratchRoot(import.meta.path, "recon-200-exact");
      const paths = setupTestCapsule(root, 500);

      const state = reconstructStateAtSequence(paths, 200);
      expect(state.count).toBe(200);
      expect(state.snapshot_marker).toBe("snap-200");
      const items = state.items as string[];
      expect(items).toHaveLength(200);
      expect(items[199]).toBe("item-200");
    });

    it("reconstructing sequence 400 returns snapshot 400 directly", () => {
      const root = scratchRoot(import.meta.path, "recon-400-exact");
      const paths = setupTestCapsule(root, 500);

      const state = reconstructStateAtSequence(paths, 400);
      expect(state.count).toBe(400);
      expect(state.snapshot_marker).toBe("snap-400");
    });

    it("reconstructing sequence 50 replays from genesis without snapshots", () => {
      const root = scratchRoot(import.meta.path, "recon-50-genesis");
      const paths = setupTestCapsule(root, 500);

      const state = reconstructStateAtSequence(paths, 50);
      expect(state.count).toBe(50);
      expect(state.snapshot_marker).toBeUndefined();
      const items = state.items as string[];
      expect(items).toHaveLength(50);
      expect(items[49]).toBe("item-50");
    });

    it("reconstructing sequence 0 returns genesis empty state immediately", () => {
      const root = scratchRoot(import.meta.path, "recon-zero");
      const paths = setupTestCapsule(root, 500);
      expect(reconstructStateAtSequence(paths, 0)).toEqual({});
    });
  });

  describe("fastForwardProjection", () => {
    it("fast-forwards state projection accurately across arbitrary intervals", () => {
      const root = scratchRoot(import.meta.path, "ff-interval");
      const paths = setupTestCapsule(root, 500);

      const baseState = {
        count: 100,
        items: Array.from({ length: 100 }, (_, i) => `item-${i + 1}`),
      };
      const forwardState = fastForwardProjection(baseState, 100, 150, paths);

      expect(forwardState.count).toBe(150);
      const items = forwardState.items as string[];
      expect(items).toHaveLength(150);
      expect(items[149]).toBe("item-150");
      expect(baseState.count).toBe(100);
    });

    it("returns cloned state when fromSequence === toSequence", () => {
      const root = scratchRoot(import.meta.path, "ff-equal");
      const paths = setupTestCapsule(root, 500);

      const baseState = { count: 200, label: "exact" };
      const result = fastForwardProjection(baseState, 200, 200, paths);
      expect(result).toEqual(baseState);
      expect(result).not.toBe(baseState);
    });

    it("handles full projection reset events during replay", () => {
      const vfs = getVirtualStoreFS();
      const root = scratchRoot(import.meta.path, "ff-full-projection");
      const paths = makeCapsulePaths(root);
      vfs.mkdirSync(root, { recursive: true });

      const e1 = createEventLine(1, [{ op: "set", path: ["a"], value: 1 }]);
      const e2 =
        JSON.stringify({
          schema: "harness.event",
          version: 1,
          sequence: 2,
          projection: { reset: true, value: 99 },
          projection_patch: null,
        }) + "\n";
      const e3 = createEventLine(3, [{ op: "set", path: ["extra"], value: "yes" }]);
      vfs.writeFileSync(paths.eventsPath, e1 + e2 + e3, "utf-8");

      const finalState = fastForwardProjection({}, 0, 3, paths);
      expect(finalState).toEqual({ reset: true, value: 99, extra: "yes" });
    });
  });

  describe("Negative Gates & Integrity Invariants", () => {
    it("rejects invalid targetSequence in reconstructStateAtSequence", () => {
      const root = scratchRoot(import.meta.path, "neg-target-seq");
      const paths = setupTestCapsule(root, 100);

      expect(() => reconstructStateAtSequence(paths, -1)).toThrow(HarnessError);
      expect(() => reconstructStateAtSequence(paths, 1.5)).toThrow(HarnessError);
      expect(() => reconstructStateAtSequence(paths, Number.NaN)).toThrow(HarnessError);
      expect(() => reconstructStateAtSequence(paths, "200" as unknown as number)).toThrow(
        HarnessError,
      );
      try {
        reconstructStateAtSequence(paths, -5);
      } catch (err) {
        expect((err as HarnessError).code).toBe("INVALID_ARGUMENT");
      }
    });

    it("rejects invalid arguments in fastForwardProjection", () => {
      const root = scratchRoot(import.meta.path, "neg-ff-args");
      const paths = setupTestCapsule(root, 100);

      expect(() =>
        fastForwardProjection(null as unknown as Record<string, unknown>, 0, 50, paths),
      ).toThrow(HarnessError);
      expect(() => fastForwardProjection({}, -1, 50, paths)).toThrow(HarnessError);
      expect(() => fastForwardProjection({}, 0, -5, paths)).toThrow(HarnessError);
      expect(() => fastForwardProjection({}, 50, 20, paths)).toThrow(HarnessError);
      expect(() => fastForwardProjection({}, 0, 50, { ...paths, eventsPath: "" })).toThrow(
        HarnessError,
      );
    });

    it("throws NOT_FOUND when events file is missing", () => {
      const root = scratchRoot(import.meta.path, "neg-missing-events");
      const paths = setupTestCapsule(root, 100);
      const badPaths = { ...paths, eventsPath: join(root, "nonexistent.jsonl") };

      expect(() => reconstructStateAtSequence(badPaths, 50)).toThrow(HarnessError);
      try {
        reconstructStateAtSequence(badPaths, 50);
      } catch (err) {
        expect((err as HarnessError).code).toBe("NOT_FOUND");
      }
    });

    it("throws NOT_FOUND when targetSequence exceeds max event sequence in events file", () => {
      const root = scratchRoot(import.meta.path, "neg-exceed-seq");
      const paths = setupTestCapsule(root, 100);

      expect(() => reconstructStateAtSequence(paths, 250)).toThrow(HarnessError);
      try {
        reconstructStateAtSequence(paths, 250);
      } catch (err) {
        expect((err as HarnessError).code).toBe("NOT_FOUND");
      }
    });

    it("throws INTEGRITY error on corrupted event JSON or malformed schema", () => {
      const vfs = getVirtualStoreFS();
      const root = scratchRoot(import.meta.path, "neg-corrupted-event");
      const paths = makeCapsulePaths(root);
      vfs.mkdirSync(root, { recursive: true });

      vfs.writeFileSync(paths.eventsPath, "CORRUPTED NOT JSON\n", "utf-8");
      expect(() => reconstructStateAtSequence(paths, 1)).toThrow(HarnessError);
      try {
        reconstructStateAtSequence(paths, 1);
      } catch (err) {
        expect((err as HarnessError).code).toBe("INTEGRITY");
      }
    });

    it("throws INTEGRITY error on sequence gap in events file", () => {
      const vfs = getVirtualStoreFS();
      const root = scratchRoot(import.meta.path, "neg-seq-gap");
      const paths = makeCapsulePaths(root);
      vfs.mkdirSync(root, { recursive: true });

      const e1 = createEventLine(1);
      const e3 = createEventLine(3); // Sequence 2 is missing
      vfs.writeFileSync(paths.eventsPath, e1 + e3, "utf-8");

      expect(() => reconstructStateAtSequence(paths, 3)).toThrow(HarnessError);
      try {
        reconstructStateAtSequence(paths, 3);
      } catch (err) {
        expect((err as HarnessError).code).toBe("INTEGRITY");
        expect((err as HarnessError).message).toMatch(/sequence gap/i);
      }
    });
  });
});
