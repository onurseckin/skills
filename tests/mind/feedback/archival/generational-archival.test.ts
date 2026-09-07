import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { pruneAndArchiveGenerationalState } from "../../../../olt/scripts/src/mind/archival/writer.ts";
import { isItemCompleted } from "../../../../olt/scripts/src/mind/archival/reader.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Feedback Generational Archival Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const testDir = "/virtual/mind/feedback/archival";

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(testDir, { recursive: true });
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("Generational Pruning & Retention Invariants", () => {
    it("archives completed items older than retention cutoff and carries recent items", () => {
      const sourceState = {
        candidates: [
          // Completed item in gen 2 (cutoff is 4 - 1 = 3) -> should be archived
          {
            id: "cand-gen2-done",
            generation: 2,
            status: "completed",
            statement: "Done item in gen 2",
            decided_at: "2026-08-20T10:00:00.000Z",
            result: "converged",
          },
          // Completed item in gen 3 (cutoff is 3) -> should be archived
          {
            id: "cand-gen3-done",
            generation: 3,
            status: "resolved",
            statement: "Done item in gen 3",
            completed_at: "2026-08-25T10:00:00.000Z",
          },
          // Completed item in gen 4 (recent generation > cutoff) -> should be carried forward
          {
            id: "cand-gen4-done",
            generation: 4,
            status: "completed",
            statement: "Recent done item",
          },
        ],
        objectives: [
          // Completed objective in gen 1 -> should be archived
          {
            id: "obj-gen1-done",
            generation: 1,
            status: "completed",
            statement: "Done objective in gen 1",
          },
        ],
      };

      const result = pruneAndArchiveGenerationalState({
        sourceState,
        sourceGeneration: 4,
        retentionGenerations: 1,
        nowIso: "2026-09-01T12:00:00.000Z",
      });

      // Archived records should contain gen 2 candidate, gen 3 candidate, and gen 1 objective
      expect(result.archivedRecords.length).toBe(3);
      const archivedIds = result.archivedRecords.map((r) => r.id);
      expect(archivedIds).toContain("cand-gen2-done");
      expect(archivedIds).toContain("cand-gen3-done");
      expect(archivedIds).toContain("obj-gen1-done");

      // Carried forward candidates should contain gen 4 completed item
      expect(result.carriedCandidates.length).toBe(1);
      expect(result.carriedCandidates[0]?.id).toBe("cand-gen4-done");
      expect(result.prunedCount).toBe(3);
      expect(result.archivedCount).toBe(3);
    });

    it("carries active and uncompleted items forward regardless of age", () => {
      const sourceState = {
        candidates: [
          // Active item created way back in gen 1 -> must NOT be archived
          {
            id: "cand-gen1-active",
            generation: 1,
            status: "opened",
            statement: "Long-running candidate",
          },
          // In-progress item in gen 2 -> must NOT be archived
          {
            id: "cand-gen2-progress",
            generation: 2,
            status: "needs_authority",
            statement: "Awaiting authority",
          },
        ],
      };

      const result = pruneAndArchiveGenerationalState({
        sourceState,
        sourceGeneration: 5,
        retentionGenerations: 1,
      });

      expect(result.archivedRecords.length).toBe(0);
      expect(result.carriedCandidates.length).toBe(2);
      expect(result.carriedCandidates.map((c) => c.id)).toEqual([
        "cand-gen1-active",
        "cand-gen2-progress",
      ]);
    });
  });

  describe("isItemCompleted Detection", () => {
    it("recognizes all terminal and converged completion statuses", () => {
      expect(isItemCompleted({ status: "completed" })).toBe(true);
      expect(isItemCompleted({ status: "resolved" })).toBe(true);
      expect(isItemCompleted({ status: "declined" })).toBe(true);
      expect(isItemCompleted({ status: "closed" })).toBe(true);
      expect(isItemCompleted({ status: "converged" })).toBe(true);
      expect(isItemCompleted({ status: "exhausted" })).toBe(true);
      expect(isItemCompleted({ status: "escalated" })).toBe(true);

      expect(isItemCompleted({ result: "converged" })).toBe(true);
      expect(isItemCompleted({ result: "resolved" })).toBe(true);

      // Incomplete statuses
      expect(isItemCompleted({ status: "opened" })).toBe(false);
      expect(isItemCompleted({ status: "in_progress" })).toBe(false);
      expect(isItemCompleted({ status: "pending" })).toBe(false);
      expect(isItemCompleted({})).toBe(false);
    });
  });
});
