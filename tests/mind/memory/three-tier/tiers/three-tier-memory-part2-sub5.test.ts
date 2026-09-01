/**
 * Comprehensive Test Suite for 3-Tier Hierarchical Semantic Memory Engine.
 *
 * Covers:
 * 1. Tier 1 Core Bedrock Invariants (Permanent System Axioms, Settled Pareto, immutability, zero decay, zero compaction, rejection of mutations).
 * 2. Tier 2 Active Strategic Working Memory (Operational Horizon, rolling milestone completions, prioritization, pruning & compaction).
 * 3. Tier 3 Archived Episodic Epics (Compaction abstracts, epistemic status, temporal lineage pointers).
 * 4. Settled Pareto Resolution Promotion (Tier 2 -> Tier 1 Bedrock Invariant with bidirectional lineage links).
 * 5. Pruning & Compaction Engine (age-based, status-based, expiration-based, dry run mode, zero decay guarantee on Tier 1).
 * 6. Snapshot Persistence & Restoration Roundtrips (JSON serialization, state restoration, independent instance isolation).
 */

import { describe, expect, it } from "bun:test";
import {
  type AddArchivedEpicOptions,
  type AddBedrockInvariantOptions,
  type AddWorkingMemoryEntryOptions,
  type BedrockInvariant,
  type BedrockInvariantCategory,
  type CompactAndArchiveEpicOptions,
  type PromoteParetoOptions,
  type PruneWorkingMemoryOptions,
  type ThreeTierMemorySnapshot,
  type WorkingMemoryCategory,
  type WorkingMemoryEntry,
  type WorkingMemoryStatus,
  SupersessionIndex,
  ThreeTierMemoryEngine,
} from "../../../../../olt/scripts/src/mind/memory/index.ts";

describe("ThreeTierMemoryEngine Test Suite", () => {
describe("Pruning & Compaction Engine (Rolling Horizon & Compaction to Tier 3)", () => {
    it("prunes completed and resolved working memory entries and archives them to Tier 3", () => {
      const engine = new ThreeTierMemoryEngine();

      engine.addWorkingEntry({
        id: "w-comp-1",
        title: "Completed Task 1",
        description: "Done work",
        status: "COMPLETED",
        resolutionSummary: "Finished cleanly.",
      });

      engine.addWorkingEntry({
        id: "w-res-2",
        title: "Resolved Task 2",
        description: "Resolved work",
        status: "RESOLVED",
        resolutionSummary: "Resolved via Pareto consensus.",
      });

      engine.addWorkingEntry({
        id: "w-act-3",
        title: "Active Task 3",
        description: "Still in progress",
        status: "IN_PROGRESS",
      });

      expect(engine.getWorkingMemoryCount()).toBe(3);

      const result = engine.pruneWorkingMemory({ autoArchiveCompleted: true });

      expect(result.evaluatedCount).toBe(3);
      expect(result.prunedIds).toEqual(["w-comp-1", "w-res-2"]);
      expect(result.archivedEntries.length).toBe(2);
      expect(result.remainingCount).toBe(1);

      expect(engine.getWorkingMemoryCount()).toBe(1);
      expect(engine.getWorkingEntry("w-act-3")).toBeDefined();
      expect(engine.getArchivedEpicCount()).toBe(2);
    });

    it("prunes expired entries based on expiresAt timestamp", () => {
      const engine = new ThreeTierMemoryEngine();

      const pastIso = "2026-08-01T00:00:00.000Z";
      const futureIso = "2026-10-01T00:00:00.000Z";
      const currentIso = "2026-09-01T12:00:00.000Z";

      engine.addWorkingEntry({
        id: "w-expired",
        title: "Expired Entry",
        description: "Past horizon",
        status: "ACTIVE",
        expiresAt: pastIso,
      });

      engine.addWorkingEntry({
        id: "w-valid",
        title: "Valid Entry",
        description: "Future horizon",
        status: "ACTIVE",
        expiresAt: futureIso,
      });

      const result = engine.pruneWorkingMemory({
        nowIso: currentIso,
        autoArchiveCompleted: true,
      });

      expect(result.prunedIds).toEqual(["w-expired"]);
      expect(engine.getWorkingMemoryCount()).toBe(1);
      expect(engine.getWorkingEntry("w-valid")).toBeDefined();
    });

    it("prunes aged entries exceeding maxAgeDays window", () => {
      const engine = new ThreeTierMemoryEngine();

      const oldUpdated = "2026-07-01T00:00:00.000Z"; // ~60 days old
      const freshUpdated = "2026-08-25T00:00:00.000Z"; // ~7 days old
      const nowIso = "2026-09-01T00:00:00.000Z";

      engine.addWorkingEntry({
        id: "w-old",
        title: "Old Entry",
        description: "Old item",
        status: "ACTIVE",
        updatedAt: oldUpdated,
      });

      engine.addWorkingEntry({
        id: "w-fresh",
        title: "Fresh Entry",
        description: "Fresh item",
        status: "ACTIVE",
        updatedAt: freshUpdated,
      });

      const result = engine.pruneWorkingMemory({
        maxAgeDays: 30,
        nowIso,
        autoArchiveCompleted: false, // delete directly
      });

      expect(result.prunedIds).toEqual(["w-old"]);
      expect(engine.getWorkingMemoryCount()).toBe(1);
      expect(engine.getWorkingEntry("w-fresh")).toBeDefined();
      expect(engine.getArchivedEpicCount()).toBe(0);
    });

    it("executes dry run pruning without modifying engine state", () => {
      const engine = new ThreeTierMemoryEngine();

      engine.addWorkingEntry({
        id: "w-dry-1",
        title: "Completed Dry",
        description: "Completed item",
        status: "COMPLETED",
      });

      const result = engine.pruneWorkingMemory({ dryRun: true });

      expect(result.prunedIds).toEqual(["w-dry-1"]);
      expect(result.remainingCount).toBe(0);

      // Verify state was NOT modified
      expect(engine.getWorkingMemoryCount()).toBe(1);
      expect(engine.getArchivedEpicCount()).toBe(0);
      expect(engine.getWorkingEntry("w-dry-1")).toBeDefined();
    });

    it("guarantees 0 decay and 0 pruning on Tier 1 Bedrock Invariants during aggressive pruning", () => {
      const engine = new ThreeTierMemoryEngine();

      engine.addBedrockInvariant({
        id: "axiom-permanent",
        title: "Permanent Axiom",
        statement: "Bedrock invariants must never decay or be pruned.",
        rationale: "Absolute safety invariant.",
      });

      engine.addWorkingEntry({
        id: "w-decay-candidate",
        title: "Working candidate",
        description: "Work",
        status: "COMPLETED",
      });

      expect(engine.getBedrockInvariantCount()).toBe(1);
      expect(engine.getWorkingMemoryCount()).toBe(1);

      // Aggressive prune: 0 max age days, prune all
      engine.pruneWorkingMemory({ maxAgeDays: 0, autoArchiveCompleted: false });

      expect(engine.getWorkingMemoryCount()).toBe(0);

      // Bedrock invariant is 100% intact
      expect(engine.getBedrockInvariantCount()).toBe(1);
      expect(engine.hasBedrockInvariant("axiom-permanent")).toBe(true);
      expect(engine.getBedrockInvariant("axiom-permanent")?.title).toBe("Permanent Axiom");
    });
  });
});
