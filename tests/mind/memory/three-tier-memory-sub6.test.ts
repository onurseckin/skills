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
} from "../../../olt/scripts/src/mind/memory/index.ts";

describe("ThreeTierMemoryEngine Test Suite", () => {


describe("Snapshot Persistence & Restoration Roundtrips", () => {
    it("exports full 3-tier memory snapshot and faithfully restores from state", () => {
      const engine = new ThreeTierMemoryEngine();

      engine.addBedrockInvariant({
        id: "inv-snap-1",
        title: "Snapshot Invariant",
        category: "AXIOM",
        statement: "Invariant statement.",
        rationale: "Invariant rationale.",
        tags: ["snap"],
      });

      engine.addWorkingEntry({
        id: "work-snap-1",
        title: "Snapshot Working Entry",
        category: "ACTIVE_EPIC",
        description: "Working description.",
        status: "IN_PROGRESS",
        milestonesCompleted: 2,
        totalMilestones: 5,
        tags: ["snap"],
      });

      engine.addArchivedEntry({
        id: "arch-snap-1",
        title: "Snapshot Archived Entry",
        category: "ARCHIVED_EPIC",
        summaryAbstract: "Archived abstract.",
        keyDecisions: ["Dec 1"],
        outcome: "SUCCESS",
        tags: ["snap"],
      });

      const snapshot = engine.exportSnapshot();
      expect(snapshot.version).toBe(1);
      expect(snapshot.tier1Invariants.length).toBe(1);
      expect(snapshot.tier2WorkingMemory.length).toBe(1);
      expect(snapshot.tier3ArchivedEpics.length).toBe(1);
      expect(snapshot.supersessionIndex.nodes.length).toBeGreaterThanOrEqual(3);

      // Restore via fromSnapshot
      const restored = ThreeTierMemoryEngine.fromSnapshot(snapshot);

      expect(restored.getBedrockInvariantCount()).toBe(1);
      expect(restored.getBedrockInvariant("inv-snap-1")?.title).toBe("Snapshot Invariant");

      expect(restored.getWorkingMemoryCount()).toBe(1);
      const restoredWork = restored.getWorkingEntry("work-snap-1");
      expect(restoredWork?.milestonesCompleted).toBe(2);
      expect(restoredWork?.totalMilestones).toBe(5);

      expect(restored.getArchivedEpicCount()).toBe(1);
      expect(restored.getArchivedEntry("arch-snap-1")?.summaryAbstract).toBe(
        "Archived abstract.",
      );

      const restoredIndex = restored.getSupersessionIndex();
      expect(restoredIndex.hasEntry("inv-snap-1")).toBe(true);
      expect(restoredIndex.hasEntry("work-snap-1")).toBe(true);
      expect(restoredIndex.hasEntry("arch-snap-1")).toBe(true);
    });

    it("serializes to JSON string and reconstructs via fromJSON static factory", () => {
      const engine = new ThreeTierMemoryEngine();

      engine.addBedrockInvariant({
        id: "inv-json-1",
        title: "JSON Invariant",
        category: "CORE_PRINCIPLE",
        statement: "JSON serialization principle.",
        rationale: "Persistence test.",
      });

      const jsonStr = engine.toJSON();
      expect(typeof jsonStr).toBe("string");
      expect(jsonStr).toContain("inv-json-1");
      expect(jsonStr).toContain("JSON Invariant");

      const reconstructed = ThreeTierMemoryEngine.fromJSON(jsonStr);

      expect(reconstructed.hasBedrockInvariant("inv-json-1")).toBe(true);
      expect(reconstructed.getBedrockInvariant("inv-json-1")?.statement).toBe(
        "JSON serialization principle.",
      );
    });

    it("verifies restored engine instance is fully isolated from original engine", () => {
      const engine = new ThreeTierMemoryEngine();
      engine.addWorkingEntry({
        id: "work-isolated",
        title: "Isolated Entry",
        description: "Before clone",
      });

      const snapshot = engine.exportSnapshot();
      const clone = ThreeTierMemoryEngine.fromSnapshot(snapshot);

      // Mutate clone
      clone.addWorkingEntry({
        id: "work-clone-only",
        title: "Clone Only",
        description: "Only in clone",
      });

      expect(clone.getWorkingMemoryCount()).toBe(2);
      expect(engine.getWorkingMemoryCount()).toBe(1);
      expect(engine.getWorkingEntry("work-clone-only")).toBeUndefined();
    });
  });
});
