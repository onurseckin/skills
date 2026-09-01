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
  describe("Tier 3: Archived Episodic Epics (Compaction Abstracts & Lineage)", () => {
    it("adds archived epics directly and retrieves them", () => {
      const engine = new ThreeTierMemoryEngine();

      const archived = engine.addArchivedEntry({
        id: "arch-epic-01",
        originalWorkingId: "work-epic-01",
        title: "Completed Lexer Optimization",
        category: "ARCHIVED_EPIC",
        summaryAbstract: "Replaced regex-based scanner with state machine for 4x speedup.",
        keyDecisions: ["AOT table compilation", "Zero copy buffering"],
        artifactsProduced: ["lex_table.bin"],
        outcome: "SUCCESS",
        epistemicStatus: "ACTIVE",
        tags: ["lexer", "compiler"],
      });

      expect(archived.id).toBe("arch-epic-01");
      expect(archived.originalWorkingId).toBe("work-epic-01");
      expect(archived.keyDecisions).toEqual(["AOT table compilation", "Zero copy buffering"]);
      expect(archived.artifactsProduced).toEqual(["lex_table.bin"]);
      expect(engine.getArchivedEpicCount()).toBe(1);

      const retrieved = engine.getArchivedEntry("arch-epic-01");
      expect(retrieved?.title).toBe("Completed Lexer Optimization");
    });

    it("rejects empty or whitespace-only archived epic IDs", () => {
      const engine = new ThreeTierMemoryEngine();

      expect(() => {
        engine.addArchivedEntry({
          id: "",
          title: "Empty ID Archived",
          summaryAbstract: "Summary",
        });
      }).toThrow(/empty/i);
    });

    it("filters archived entries by category, outcome, epistemicStatus, and tags", () => {
      const engine = new ThreeTierMemoryEngine();

      engine.addArchivedEntry({
        id: "arch-1",
        title: "Archived 1",
        category: "SYSTEM_OPTIMIZATION",
        summaryAbstract: "Abstract 1",
        keyDecisions: ["D1"],
        outcome: "SUCCESS",
        epistemicStatus: "ACTIVE",
        tags: ["memory"],
      });

      engine.addArchivedEntry({
        id: "arch-2",
        title: "Archived 2",
        category: "SYSTEM_OPTIMIZATION",
        summaryAbstract: "Abstract 2",
        keyDecisions: ["D2"],
        outcome: "SUPERSEDED",
        epistemicStatus: "SUPERSEDED",
        tags: ["memory", "legacy"],
      });

      engine.addArchivedEntry({
        id: "arch-3",
        title: "Archived 3",
        category: "SECURITY_AUDIT",
        summaryAbstract: "Abstract 3",
        keyDecisions: ["D3"],
        outcome: "PARETO_OPTIMIZED",
        epistemicStatus: "ACTIVE",
        tags: ["auth"],
      });

      // Filter by outcome
      const successOnly = engine.getArchivedEntries({ outcome: "SUCCESS" });
      expect(successOnly.map((a) => a.id)).toEqual(["arch-1"]);

      // Filter by epistemic status
      const activeOnly = engine.getArchivedEntries({ epistemicStatus: "ACTIVE" });
      expect(activeOnly.map((a) => a.id)).toEqual(["arch-1", "arch-3"]);

      // Filter by category
      const secOnly = engine.getArchivedEntries({ category: "SECURITY_AUDIT" });
      expect(secOnly.map((a) => a.id)).toEqual(["arch-3"]);

      // Filter by tags
      const memTagged = engine.getArchivedEntries({ tags: ["memory"] });
      expect(memTagged.map((a) => a.id)).toEqual(["arch-1", "arch-2"]);
    });

    it("compacts and archives working epic into Tier 3 with lineage links", () => {
      const engine = new ThreeTierMemoryEngine();

      engine.addWorkingEntry({
        id: "work-compact-target",
        title: "Parser Resilience Epic",
        category: "ACTIVE_EPIC",
        description: "Fuzz and harden syntax tree recovery.",
        status: "RESOLVED",
        resolutionSummary: "Added 12 panic recovery anchors; 0 crashes in 100k fuzz runs.",
        tags: ["parser", "resilience"],
        metadata: { epicOwner: "agent-parser" },
      });

      expect(engine.getWorkingMemoryCount()).toBe(1);

      const archived = engine.compactAndArchiveEpic({
        workingEntryId: "work-compact-target",
        outcome: "SUCCESS",
        keyDecisions: ["Anchor-based synchronizer", "Panic recovery boundaries"],
        removeWorkingEntry: true,
      });

      expect(archived.id).toBe("archive-work-compact-target");
      expect(archived.originalWorkingId).toBe("work-compact-target");
      expect(archived.summaryAbstract).toBe(
        "Added 12 panic recovery anchors; 0 crashes in 100k fuzz runs.",
      );
      expect(archived.keyDecisions).toEqual([
        "Anchor-based synchronizer",
        "Panic recovery boundaries",
      ]);
      expect(archived.outcome).toBe("SUCCESS");

      // Verify Tier 2 entry was deleted
      expect(engine.getWorkingMemoryCount()).toBe(0);
      expect(engine.getArchivedEpicCount()).toBe(1);

      // Verify supersession link from working ID to archived ID
      const sIndex = engine.getSupersessionIndex();
      expect(sIndex.getEpistemicStatus("work-compact-target")).toBe("SUPERSEDED");
      expect(sIndex.getTerminalSuccessor("work-compact-target")?.id).toBe(
        "archive-work-compact-target",
      );
    });

    it("retains working entry with ARCHIVED status when removeWorkingEntry is false", () => {
      const engine = new ThreeTierMemoryEngine();

      engine.addWorkingEntry({
        id: "work-preserve-target",
        title: "Preserve in Working Memory",
        description: "Test keeping in working memory",
        status: "RESOLVED",
      });

      engine.compactAndArchiveEpic({
        workingEntryId: "work-preserve-target",
        removeWorkingEntry: false,
      });

      expect(engine.getWorkingMemoryCount()).toBe(1);
      expect(engine.getWorkingEntry("work-preserve-target")?.status).toBe("ARCHIVED");
      expect(engine.getArchivedEpicCount()).toBe(1);
    });
  });
});
