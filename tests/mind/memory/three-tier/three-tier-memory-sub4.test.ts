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
} from "../../../../olt/scripts/src/mind/memory/index.ts";

describe("ThreeTierMemoryEngine Test Suite", () => {


describe("Settled Pareto Resolution Promotion (Tier 2 -> Tier 1 Bedrock Invariant)", () => {
    it("promotes a settled dialectical resolution from Tier 2 directly to a Tier 1 Bedrock Invariant", () => {
      const engine = new ThreeTierMemoryEngine();

      engine.addWorkingEntry({
        id: "dialectic-simplicity-vs-perf",
        title: "Simplicity vs Performance Dialectic",
        category: "DIALECTICAL_RESOLUTION",
        description: "Weighing 5% speedup against 400 lines of complex unsafe pointer arithmetic.",
        status: "RESOLVED",
        resolutionSummary: "Simplicity strictly dominates: reject unsafe pointers for <15% gains.",
        tags: ["dialectics", "architecture"],
        metadata: { consensusRound: 4 },
      });

      const invariant = engine.promoteParetoResolutionToInvariant({
        workingEntryId: "dialectic-simplicity-vs-perf",
        invariantId: "inv-simplicity-dominance-rule",
        title: "Simplicity Dominance Axiom",
        category: "SETTLED_PARETO",
        statement: "Cognitive simplicity strictly dominates micro-performance gains under 15%.",
        rationale: "Prevents code bloat and maintenance hazards.",
        archiveWorkingEntry: true,
      });

      // 1. Invariant must be in Tier 1
      expect(invariant.id).toBe("inv-simplicity-dominance-rule");
      expect(invariant.category).toBe("SETTLED_PARETO");
      expect(engine.hasBedrockInvariant("inv-simplicity-dominance-rule")).toBe(true);
      expect(engine.getBedrockInvariantCount()).toBe(1);

      // 2. Working entry must be archived to Tier 3
      expect(engine.getWorkingMemoryCount()).toBe(0);
      expect(engine.getArchivedEpicCount()).toBe(1);
      const archived = engine.getArchivedEntry("archive-dialectic-simplicity-vs-perf");
      expect(archived).toBeDefined();
      expect(archived?.outcome).toBe("PARETO_OPTIMIZED");
      expect(archived?.successorInvariantId).toBe("inv-simplicity-dominance-rule");

      // 3. Supersession Index must reflect the full lineage
      const sIndex = engine.getSupersessionIndex();
      expect(sIndex.getEpistemicStatus("dialectic-simplicity-vs-perf")).toBe("SUPERSEDED");
      expect(sIndex.getEpistemicStatus("inv-simplicity-dominance-rule")).toBe("ACTIVE");

      const lineage = sIndex.getSuccessorLineage("dialectic-simplicity-vs-perf");
      expect(lineage).toContain("inv-simplicity-dominance-rule");
      expect(sIndex.getTerminalSuccessor("dialectic-simplicity-vs-perf")?.id).toBe(
        "inv-simplicity-dominance-rule",
      );
    });

    it("handles Pareto promotion when working entry is kept in working memory with PROMOTED status", () => {
      const engine = new ThreeTierMemoryEngine();

      engine.addWorkingEntry({
        id: "work-promoted-stay",
        title: "Stay in Tier 2",
        description: "Testing non-archiving promotion",
        status: "RESOLVED",
        resolutionSummary: "Rule discovered",
      });

      engine.promoteParetoResolutionToInvariant({
        workingEntryId: "work-promoted-stay",
        invariantId: "inv-stay-rule",
        archiveWorkingEntry: false,
      });

      expect(engine.getBedrockInvariantCount()).toBe(1);
      expect(engine.getWorkingMemoryCount()).toBe(1);
      expect(engine.getWorkingEntry("work-promoted-stay")?.status).toBe("PROMOTED");
      expect(engine.getArchivedEpicCount()).toBe(0);
    });
  });
});
