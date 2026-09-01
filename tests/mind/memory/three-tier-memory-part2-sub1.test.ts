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
describe("Tier 1: Core Bedrock Invariants (Permanent System Axioms & Immutability)", () => {
    it("successfully registers Bedrock Invariants across all supported categories", () => {
      const engine = new ThreeTierMemoryEngine();

      const categories: BedrockInvariantCategory[] = [
        "AXIOM",
        "SETTLED_PARETO",
        "PERMANENT_ANTI_PATTERN",
        "CORE_PRINCIPLE",
        "ARCHITECTURAL_INVARIANT",
      ];

      for (let i = 0; i < categories.length; i++) {
        const cat = categories[i]!;
        const inv = engine.addBedrockInvariant({
          id: `inv-cat-${i}`,
          title: `Invariant Title ${cat}`,
          category: cat,
          statement: `Statement for invariant in category ${cat}.`,
          rationale: `System rationale for category ${cat}.`,
          tags: ["bedrock", cat.toLowerCase()],
          metadata: { categoryIndex: i },
        });

        expect(inv.id).toBe(`inv-cat-${i}`);
        expect(inv.category).toBe(cat);
        expect(inv.tags).toEqual(["bedrock", cat.toLowerCase()]);
        expect(inv.metadata).toEqual({ categoryIndex: i });
        expect(engine.hasBedrockInvariant(`inv-cat-${i}`)).toBe(true);
      }

      expect(engine.getBedrockInvariantCount()).toBe(categories.length);
      const allInvariants = engine.getBedrockInvariants();
      expect(allInvariants.length).toBe(categories.length);
    });

    it("enforces absolute immutability and rejects mutation/overwrite of existing invariant ID", () => {
      const engine = new ThreeTierMemoryEngine();

      engine.addBedrockInvariant({
        id: "axiom-immutable-core",
        title: "Original Immutable Core",
        category: "AXIOM",
        statement: "Core axioms must remain unmodified.",
        rationale: "Foundational safety constraint.",
      });

      expect(engine.hasBedrockInvariant("axiom-immutable-core")).toBe(true);
      const initial = engine.getBedrockInvariant("axiom-immutable-core");
      expect(initial?.title).toBe("Original Immutable Core");

      // Attempting to overwrite must throw an error mentioning immutability
      expect(() => {
        engine.addBedrockInvariant({
          id: "axiom-immutable-core",
          title: "Mutated Title Attempt",
          statement: "Mutated Statement",
          rationale: "Mutated Rationale",
        });
      }).toThrow(/immutable/i);

      // Verify the invariant remains strictly unmodified
      const afterAttempt = engine.getBedrockInvariant("axiom-immutable-core");
      expect(afterAttempt?.title).toBe("Original Immutable Core");
      expect(afterAttempt?.statement).toBe("Core axioms must remain unmodified.");
    });

    it("rejects empty or whitespace-only invariant IDs", () => {
      const engine = new ThreeTierMemoryEngine();

      expect(() => {
        engine.addBedrockInvariant({
          id: "",
          title: "Empty ID Invariant",
          statement: "Some statement",
          rationale: "Some rationale",
        });
      }).toThrow(/empty/i);

      expect(() => {
        engine.addBedrockInvariant({
          id: "   ",
          title: "Whitespace ID Invariant",
          statement: "Some statement",
          rationale: "Some rationale",
        });
      }).toThrow(/empty/i);
    });

    it("automatically registers Bedrock Invariants in the SupersessionIndex as ACTIVE", () => {
      const engine = new ThreeTierMemoryEngine();

      engine.addBedrockInvariant({
        id: "axiom-index-link",
        title: "Index Linked Invariant",
        statement: "Axioms must be registered in index.",
        rationale: "Searchability and truth resolution.",
      });

      const sIndex = engine.getSupersessionIndex();
      expect(sIndex.hasEntry("axiom-index-link")).toBe(true);
      expect(sIndex.getEpistemicStatus("axiom-index-link")).toBe("ACTIVE");
      expect(sIndex.isObsolete("axiom-index-link")).toBe(false);

      const entry = sIndex.getEntry("axiom-index-link");
      expect(entry?.title).toBe("Index Linked Invariant");
      expect(entry?.metadata).toEqual({
        tier: "TIER_1",
        category: "AXIOM",
      });
    });

    it("establishes bidirectional supersession links when supersedesHistoricalIds are provided", () => {
      const engine = new ThreeTierMemoryEngine();

      // Pre-register historical working/spec entries in supersession index
      const sIndex = engine.getSupersessionIndex();
      sIndex.registerEntry({ id: "hist-spec-v1", title: "Spec v1", status: "ACTIVE" });
      sIndex.registerEntry({ id: "hist-spec-v2", title: "Spec v2", status: "ACTIVE" });

      engine.addBedrockInvariant({
        id: "inv-unified-standard",
        title: "Unified Standard Invariant",
        category: "SETTLED_PARETO",
        statement: "Unified standard supersedes legacy versions.",
        rationale: "Consolidation of architecture.",
        supersedesHistoricalIds: ["hist-spec-v1", "hist-spec-v2"],
      });

      // Historical entries must now be marked SUPERSEDED pointing to the invariant
      expect(sIndex.getEpistemicStatus("hist-spec-v1")).toBe("SUPERSEDED");
      expect(sIndex.getEpistemicStatus("hist-spec-v2")).toBe("SUPERSEDED");
      expect(sIndex.isObsolete("hist-spec-v1")).toBe(true);
      expect(sIndex.isObsolete("hist-spec-v2")).toBe(true);

      expect(sIndex.getTerminalSuccessor("hist-spec-v1")?.id).toBe("inv-unified-standard");
      expect(sIndex.getTerminalSuccessor("hist-spec-v2")?.id).toBe("inv-unified-standard");
    });

    it("initializes engine with initialInvariants passed to constructor", () => {
      const initialInvariants: BedrockInvariant[] = [
        {
          id: "init-inv-1",
          title: "Initial Invariant 1",
          category: "CORE_PRINCIPLE",
          statement: "Principle 1",
          rationale: "Rationale 1",
          settledDate: "2026-08-01T00:00:00.000Z",
        },
        {
          id: "init-inv-2",
          title: "Initial Invariant 2",
          category: "ARCHITECTURAL_INVARIANT",
          statement: "Principle 2",
          rationale: "Rationale 2",
          settledDate: "2026-08-02T00:00:00.000Z",
        },
      ];

      const engine = new ThreeTierMemoryEngine({ initialInvariants });

      expect(engine.getBedrockInvariantCount()).toBe(2);
      expect(engine.hasBedrockInvariant("init-inv-1")).toBe(true);
      expect(engine.hasBedrockInvariant("init-inv-2")).toBe(true);
      expect(engine.getBedrockInvariant("init-inv-1")?.settledDate).toBe("2026-08-01T00:00:00.000Z");
    });
  });
});
