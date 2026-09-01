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


describe("Tier 2: Active Strategic Working Memory (Operational Horizon & Rolling Milestones)", () => {
    it("creates working memory entries across various categories and priorities", () => {
      const engine = new ThreeTierMemoryEngine();

      const categories: WorkingMemoryCategory[] = [
        "ACTIVE_EPIC",
        "DIALECTICAL_RESOLUTION",
        "OPEN_DEPENDENCY",
        "MILESTONE",
        "STRATEGIC_OBJECTIVE",
        "PARETO_CANDIDATE",
      ];

      for (let i = 0; i < categories.length; i++) {
        const cat = categories[i]!;
        const entry = engine.addWorkingEntry({
          id: `work-item-${i}`,
          title: `Working Item ${cat}`,
          category: cat,
          description: `Description for ${cat}`,
          priority: i % 2 === 0 ? "CRITICAL" : "HIGH",
          horizonDays: 14,
          totalMilestones: 5,
          milestonesCompleted: 2,
          openDependencies: ["dep-alpha", "dep-beta"],
          tags: ["wave3", cat.toLowerCase()],
        });

        expect(entry.id).toBe(`work-item-${i}`);
        expect(entry.status).toBe("ACTIVE");
        expect(entry.priority).toBe(i % 2 === 0 ? "CRITICAL" : "HIGH");
        expect(entry.milestonesCompleted).toBe(2);
        expect(entry.totalMilestones).toBe(5);
        expect(entry.openDependencies).toEqual(["dep-alpha", "dep-beta"]);
      }

      expect(engine.getWorkingMemoryCount()).toBe(categories.length);
    });

    it("rejects empty or whitespace-only working entry IDs", () => {
      const engine = new ThreeTierMemoryEngine();

      expect(() => {
        engine.addWorkingEntry({
          id: "",
          title: "Empty ID Entry",
          description: "Description",
        });
      }).toThrow(/empty/i);

      expect(() => {
        engine.addWorkingEntry({
          id: "   ",
          title: "Whitespace ID Entry",
          description: "Description",
        });
      }).toThrow(/empty/i);
    });

    it("updates working memory entries partially without overwriting untouched fields", () => {
      const engine = new ThreeTierMemoryEngine();

      engine.addWorkingEntry({
        id: "epic-refactor-ast",
        title: "AST Traversal Refactoring",
        category: "ACTIVE_EPIC",
        description: "Optimize tree visitor",
        priority: "MEDIUM",
        milestonesCompleted: 1,
        totalMilestones: 4,
        openDependencies: ["dep-lexer"],
        tags: ["compiler", "ast"],
      });

      const updated = engine.updateWorkingEntry("epic-refactor-ast", {
        status: "IN_PROGRESS",
        milestonesCompleted: 3,
        priority: "HIGH",
        resolutionSummary: "Lexer dependency resolved; visitor memoization active.",
      });

      expect(updated.id).toBe("epic-refactor-ast");
      expect(updated.title).toBe("AST Traversal Refactoring"); // preserved
      expect(updated.status).toBe("IN_PROGRESS");
      expect(updated.milestonesCompleted).toBe(3);
      expect(updated.totalMilestones).toBe(4); // preserved
      expect(updated.priority).toBe("HIGH");
      expect(updated.openDependencies).toEqual(["dep-lexer"]); // preserved
      expect(updated.resolutionSummary).toBe("Lexer dependency resolved; visitor memoization active.");
      expect(updated.tags).toEqual(["compiler", "ast"]); // preserved
    });

    it("throws an error when updating a non-existent working memory entry", () => {
      const engine = new ThreeTierMemoryEngine();

      expect(() => {
        engine.updateWorkingEntry("non-existent-work-id", {
          status: "COMPLETED",
        });
      }).toThrow(/not found/i);
    });

    it("deletes working memory entries cleanly", () => {
      const engine = new ThreeTierMemoryEngine();

      engine.addWorkingEntry({
        id: "work-delete-me",
        title: "Delete Me",
        description: "To be removed",
      });

      expect(engine.getWorkingMemoryCount()).toBe(1);
      const deleted = engine.deleteWorkingEntry("work-delete-me");
      expect(deleted).toBe(true);
      expect(engine.getWorkingMemoryCount()).toBe(0);
      expect(engine.getWorkingEntry("work-delete-me")).toBeUndefined();

      // Deleting again returns false
      expect(engine.deleteWorkingEntry("work-delete-me")).toBe(false);
    });

    it("filters working memory entries by category, status, tags, and minimum priority", () => {
      const engine = new ThreeTierMemoryEngine();

      engine.addWorkingEntry({
        id: "w1",
        title: "Item 1",
        category: "ACTIVE_EPIC",
        description: "Desc 1",
        status: "ACTIVE",
        priority: "CRITICAL",
        tags: ["storage", "kv"],
      });

      engine.addWorkingEntry({
        id: "w2",
        title: "Item 2",
        category: "ACTIVE_EPIC",
        description: "Desc 2",
        status: "RESOLVED",
        priority: "HIGH",
        tags: ["storage", "sql"],
      });

      engine.addWorkingEntry({
        id: "w3",
        title: "Item 3",
        category: "MILESTONE",
        description: "Desc 3",
        status: "ACTIVE",
        priority: "MEDIUM",
        tags: ["network"],
      });

      engine.addWorkingEntry({
        id: "w4",
        title: "Item 4",
        category: "OPEN_DEPENDENCY",
        description: "Desc 4",
        status: "BLOCKED",
        priority: "LOW",
        tags: ["security"],
      });

      // Filter by category
      const epics = engine.getWorkingEntries({ category: "ACTIVE_EPIC" });
      expect(epics.map((e) => e.id)).toEqual(["w1", "w2"]);

      // Filter by multiple categories
      const epicsAndMilestones = engine.getWorkingEntries({
        category: ["ACTIVE_EPIC", "MILESTONE"],
      });
      expect(epicsAndMilestones.map((e) => e.id)).toEqual(["w1", "w2", "w3"]);

      // Filter by status
      const activeOnly = engine.getWorkingEntries({ status: "ACTIVE" });
      expect(activeOnly.map((e) => e.id)).toEqual(["w1", "w3"]);

      // Filter by tags (case-insensitive)
      const storageTagged = engine.getWorkingEntries({ tags: ["STORAGE"] });
      expect(storageTagged.map((e) => e.id)).toEqual(["w1", "w2"]);

      // Filter by minimum priority
      const highAndAbove = engine.getWorkingEntries({ minPriority: "HIGH" });
      expect(highAndAbove.map((e) => e.id)).toEqual(["w1", "w2"]);

      const criticalOnly = engine.getWorkingEntries({ minPriority: "CRITICAL" });
      expect(criticalOnly.map((e) => e.id)).toEqual(["w1"]);

      // Combined filter
      const combined = engine.getWorkingEntries({
        category: "ACTIVE_EPIC",
        status: "ACTIVE",
        minPriority: "HIGH",
        tags: ["kv"],
      });
      expect(combined.map((e) => e.id)).toEqual(["w1"]);
    });
  });
});
