import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
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

function createEventLine(seq: number): string {
  const patch =
    seq === 1
      ? '[{"op":"set","path":["count"],"value":1}]'
      : `[{"op":"set","path":["count"],"value":${seq}}]`;
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

function setupTestCapsule(rootDir: string, totalEvents = 100): CapsulePaths {
  const vfs = getVirtualStoreFS();
  const capsulePaths = makeCapsulePaths(rootDir);
  vfs.mkdirSync(capsulePaths.snapshotsDir, { recursive: true });
  let eventsContent = "";
  const byteOffsets: Record<string, number> = {};
  let currentOffset = 0;
  for (let seq = 1; seq <= totalEvents; seq++) {
    if (seq === 1 || seq % 100 === 0) {
      byteOffsets[String(seq)] = currentOffset;
    }
    const line = createEventLine(seq);
    currentOffset += Buffer.byteLength(line, "utf-8");
    eventsContent += line;
  }
  vfs.writeFileSync(capsulePaths.eventsPath, eventsContent, "utf-8");
  vfs.writeFileSync(
    capsulePaths.sparseIndexPath,
    JSON.stringify({
      version: 1,
      indexed_at: "2026-08-29T00:00:00.000Z",
      byte_offsets: byteOffsets,
    }),
    "utf-8",
  );
  return capsulePaths;
}

describe("Reconstruction Engine", () => {
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
      const e3 = createEventLine(3);
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
