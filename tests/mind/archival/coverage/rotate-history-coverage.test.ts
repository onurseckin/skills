import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  getGenerationLineage,
  readRotationMetadata,
} from "../../../../olt/scripts/src/mind/archival/rotate/history.ts";

describe("Mind Archival Rotate History Suite", () => {
  let tempDir: string;
  let capsulesDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "history-cov-test-"));
    capsulesDir = join(tempDir, "capsules");
    mkdirSync(capsulesDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createCapsule(
    runId: string,
    mindPayload?: Record<string, unknown>,
    manifestRunId?: string,
  ): string {
    const prompt = new TextEncoder().encode("History test run prompt");
    const targetRunId = manifestRunId !== undefined ? manifestRunId : runId;
    const runRoot = initRun(capsulesDir, targetRunId, prompt, "file", true);
    if (mindPayload) {
      transact(runRoot, "test-actor", "set-mind", {}, (state) => {
        state.mind = mindPayload as unknown as typeof state.mind;
      });
    }
    return runRoot;
  }

  describe("readRotationMetadata", () => {
    it("returns null for non-existent path or non-directory file", () => {
      expect(readRotationMetadata(join(capsulesDir, "missing-path"))).toBeNull();

      const filePath = join(tempDir, "regular-file.txt");
      writeFileSync(filePath, "not a capsule");
      expect(readRotationMetadata(filePath)).toBeNull();
    });

    it("returns null when loadRun fails on empty or corrupted directory", () => {
      const corruptDir = join(capsulesDir, "corrupt-dir");
      mkdirSync(corruptDir, { recursive: true });
      expect(readRotationMetadata(corruptDir)).toBeNull();
    });

    it("returns null when mind substate is missing or not an object", () => {
      const runRoot = createCapsule("run-no-mind");
      expect(readRotationMetadata(runRoot)).toBeNull();
    });

    it("reads minimal mind substate with fallback defaults", () => {
      const runRoot = createCapsule("run-min-mind", { status: "active" });
      const meta = readRotationMetadata(runRoot);
      expect(meta).not.toBeNull();
      expect(meta?.generation).toBe(1);
      expect(meta?.isRotated).toBe(false);
      expect(meta?.rotatedAt).toBeNull();
      expect(meta?.previousGeneration).toBeNull();
      expect(meta?.nextGeneration).toBeNull();
    });

    it("reads complete rotation metadata including previous and next generation specs", () => {
      const runRoot = createCapsule("run-full-meta", {
        generation: 2,
        status: "rotated",
        rotated_at: "2026-09-01T15:00:00.000Z",
        previous_generation: {
          run_id: "run-gen-1",
          event_head: "evt-001",
          sealed_at: "2026-09-01T14:00:00.000Z",
        },
        next_generation: {
          run_id: "run-gen-3",
          generation: 3,
          rotated_at: "2026-09-01T15:00:00.000Z",
        },
      });

      const meta = readRotationMetadata(runRoot);
      expect(meta).not.toBeNull();
      expect(meta?.generation).toBe(2);
      expect(meta?.isRotated).toBe(true);
      expect(meta?.rotatedAt).toBe("2026-09-01T15:00:00.000Z");
      expect(meta?.previousGeneration).toEqual({
        runId: "run-gen-1",
        eventHead: "evt-001",
        sealedAt: "2026-09-01T14:00:00.000Z",
      });
      expect(meta?.nextGeneration).toEqual({
        runId: "run-gen-3",
        generation: 3,
        rotatedAt: "2026-09-01T15:00:00.000Z",
      });
    });

    it("handles partial previous and next generation objects gracefully", () => {
      const runRoot = createCapsule("run-partial-meta", {
        generation: 4,
        previous_generation: { run_id: "run-gen-3" },
        next_generation: { run_id: "run-gen-5", generation: 5 },
      });

      const meta = readRotationMetadata(runRoot);
      expect(meta?.previousGeneration?.eventHead).toBeNull();
      expect(meta?.previousGeneration?.sealedAt).toBeNull();
      expect(meta?.nextGeneration?.rotatedAt).toBe("");

      const invalidNextRun = createCapsule("run-invalid-next", {
        mind: { next_generation: { run_id: "run-x", generation: "invalid" } },
      });
      expect(readRotationMetadata(invalidNextRun)?.nextGeneration).toBeNull();
    });
  });

  describe("getGenerationLineage", () => {
    it("returns empty array when capsule path does not exist", () => {
      const lineage = getGenerationLineage(join(capsulesDir, "missing-capsule"));
      expect(lineage).toEqual([]);
    });

    it("returns single node for standalone active capsule", () => {
      const runRoot = createCapsule("gen-standalone", { generation: 1, status: "active" });
      const lineage = getGenerationLineage(runRoot);
      expect(lineage.length).toBe(1);
      expect(lineage[0]?.runId).toBe("gen-standalone");
      expect(lineage[0]?.generation).toBe(1);
      expect(lineage[0]?.sealedAt).toBeNull();
      expect(lineage[0]?.eventHead).toBeNull();
    });

    it("traverses generation lineage across multi-generational chain", () => {
      const gen1Root = createCapsule("gen-1", {
        generation: 1,
        status: "rotated",
        rotated_at: "2026-09-01T10:00:00.000Z",
      });
      const gen2Root = createCapsule("gen-2", {
        generation: 2,
        status: "rotated",
        rotated_at: "2026-09-01T11:00:00.000Z",
        previous_generation: {
          run_id: "gen-1",
          event_head: "evt-gen-1-head",
          sealed_at: "2026-09-01T10:00:00.000Z",
        },
      });
      const gen3Root = createCapsule("gen-3", {
        generation: 3,
        status: "active",
        previous_generation: {
          run_id: "gen-2",
          event_head: "evt-gen-2-head",
          sealed_at: "2026-09-01T11:00:00.000Z",
        },
      });

      const lineage = getGenerationLineage(gen3Root);
      expect(lineage.length).toBe(3);
      expect(lineage[0]?.runId).toBe("gen-3");
      expect(lineage[0]?.generation).toBe(3);
      expect(lineage[0]?.eventHead).toBe("evt-gen-2-head");

      expect(lineage[1]?.runId).toBe("gen-2");
      expect(lineage[1]?.generation).toBe(2);
      expect(lineage[1]?.eventHead).toBe("evt-gen-1-head");
      expect(lineage[1]?.sealedAt).toBe("2026-09-01T11:00:00.000Z");

      expect(lineage[2]?.runId).toBe("gen-1");
      expect(lineage[2]?.generation).toBe(1);
      expect(lineage[2]?.eventHead).toBeNull();
    });

    it("stops traversal when previous generation directory does not exist or maxDepth is reached", () => {
      const gen2WithMissingGen1 = createCapsule("gen-2-missing-parent", {
        generation: 2,
        previous_generation: { run_id: "non-existent-gen-1" },
      });
      const lineageMissing = getGenerationLineage(gen2WithMissingGen1);
      expect(lineageMissing.length).toBe(1);

      const gen1Root = createCapsule("chain-1", { generation: 1 });
      const gen2Root = createCapsule("chain-2", {
        generation: 2,
        previous_generation: { run_id: "chain-1" },
      });
      const gen3Root = createCapsule("chain-3", {
        generation: 3,
        previous_generation: { run_id: "chain-2" },
      });

      const lineageDepthLimited = getGenerationLineage(gen3Root, 2);
      expect(lineageDepthLimited.length).toBe(2);
      expect(lineageDepthLimited[0]?.runId).toBe("chain-3");
      expect(lineageDepthLimited[1]?.runId).toBe("chain-2");
    });

    it("detects and breaks circular lineage references without infinite loop", () => {
      const loopARoot = createCapsule("loop-a", {
        generation: 2,
        previous_generation: { run_id: "loop-b" },
      });
      createCapsule("loop-b", {
        generation: 1,
        previous_generation: { run_id: "loop-a" },
      });

      const lineage = getGenerationLineage(loopARoot, 10);
      expect(lineage.length).toBe(2);
      expect(lineage[0]?.runId).toBe("loop-a");
      expect(lineage[1]?.runId).toBe("loop-b");
    });
  });
});
