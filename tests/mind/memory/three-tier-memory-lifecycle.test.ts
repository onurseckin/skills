import { describe, expect, it } from "bun:test";
import {
  ThreeTierMemoryEngine,
  type ArchivedEpicEntry,
  type BedrockInvariant,
  type WorkingMemoryEntry,
} from "../../../olt/scripts/src/mind/memory/three-tier-memory.ts";

describe("Three Tier Memory Engine Lifecycle & Promotion Suite", () => {
  it("promotes Pareto resolutions to Tier 1 invariants and supports pruning", () => {
    const engine = new ThreeTierMemoryEngine();
    engine.addWorkingEntry({
      id: "W-PARETO",
      title: "P",
      description: "D",
      status: "RESOLVED",
      resolutionSummary: "Simplicity",
    });

    const invariant = engine.promoteParetoResolutionToInvariant({
      workingEntryId: "W-PARETO",
      invariantId: "INV-P1",
      archiveWorkingEntry: true,
    });
    expect(engine.hasBedrockInvariant("INV-P1")).toBe(true);
    expect(invariant.statement).toBe("Simplicity");
    expect(engine.getWorkingEntry("W-PARETO")).toBeUndefined();

    engine.addWorkingEntry({ id: "W-PARETO-2", title: "P2", description: "D2" });
    engine.promoteParetoResolutionToInvariant({
      workingEntryId: "W-PARETO-2",
      invariantId: "INV-P1",
      archiveWorkingEntry: false,
    });
    expect(engine.getWorkingEntry("W-PARETO-2")?.status).toBe("PROMOTED");

    engine.addWorkingEntry({
      id: "W-EXP",
      title: "Exp",
      description: "D",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    engine.addWorkingEntry({
      id: "W-AGED",
      title: "Aged",
      description: "D",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });

    expect(engine.pruneWorkingMemory({ dryRun: true }).prunedIds.length).toBeGreaterThan(0);
    const actual = engine.pruneWorkingMemory({ dryRun: false });
    expect(actual.prunedIds).toContain("W-EXP");
    expect(actual.prunedIds).toContain("W-AGED");
  });

  it("exports and imports snapshots and supports JSON serialization", () => {
    const inv: BedrockInvariant = {
      id: "INV-INIT",
      title: "Init",
      category: "AXIOM",
      statement: "S",
      rationale: "R",
      settledDate: "2026-09-01T00:00:00.000Z",
    };
    const work: WorkingMemoryEntry = {
      id: "W-INIT",
      title: "Init",
      category: "ACTIVE_EPIC",
      description: "D",
      status: "ACTIVE",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const arch: ArchivedEpicEntry = {
      id: "A-INIT",
      title: "Init",
      category: "CORE",
      summaryAbstract: "S",
      keyDecisions: [],
      outcome: "SUCCESS",
      archivedAt: "2026-09-01T00:00:00.000Z",
      epistemicStatus: "ACTIVE",
    };

    const engine = new ThreeTierMemoryEngine({
      initialInvariants: [inv],
      initialWorking: [work],
      initialArchived: [arch],
    });
    const jsonStr = engine.toJSON();
    expect(jsonStr).toContain("INV-INIT");

    const restoredEngine = ThreeTierMemoryEngine.fromJSON(jsonStr);
    expect(restoredEngine.hasBedrockInvariant("INV-INIT")).toBe(true);
    expect(restoredEngine.getWorkingMemoryCount()).toBe(1);
    expect(restoredEngine.getArchivedEpicCount()).toBe(1);

    const fromSnapEngine = ThreeTierMemoryEngine.fromSnapshot(engine.exportSnapshot());
    expect(fromSnapEngine.hasBedrockInvariant("INV-INIT")).toBe(true);
    expect(() =>
      engine.importSnapshot(null as unknown as ReturnType<typeof engine.exportSnapshot>),
    ).toThrow("Invalid ThreeTierMemorySnapshot");
    expect(() => ThreeTierMemoryEngine.fromJSON("invalid-json{")).toThrow();
  });

  it("evaluates strict priority hierarchies and future expiry preservation during pruning", () => {
    const engine = new ThreeTierMemoryEngine();
    engine.addWorkingEntry({
      id: "W-CRIT",
      title: "Critical Fix",
      description: "Must run first",
      priority: "CRITICAL",
    });
    engine.addWorkingEntry({
      id: "W-MED",
      title: "Medium Fix",
      description: "Standard priority",
      priority: "MEDIUM",
    });
    engine.addWorkingEntry({
      id: "W-FUTURE",
      title: "Future Task",
      description: "Should not expire",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    expect(engine.getWorkingEntries({ minPriority: "CRITICAL" }).length).toBe(1);
    expect(engine.getWorkingEntries({ minPriority: "HIGH" }).length).toBe(1);
    expect(engine.getWorkingEntries({ minPriority: "MEDIUM" }).length).toBe(3);
    expect(engine.getWorkingEntries({ minPriority: "LOW" }).length).toBe(3);

    const pruneResult = engine.pruneWorkingMemory();
    expect(pruneResult.prunedIds.length).toBe(0);
    expect(engine.getWorkingEntry("W-FUTURE")).toBeDefined();

    const emptyEngine = new ThreeTierMemoryEngine();
    const emptyPrune = emptyEngine.pruneWorkingMemory();
    expect(emptyPrune.prunedIds.length).toBe(0);
    expect(emptyPrune.prunedIds).toEqual([]);
  });

  it("maintains immutable integrity and epistemic linkage when promoting working entries with custom metadata", () => {
    const engine = new ThreeTierMemoryEngine();
    engine.addWorkingEntry({
      id: "W-PROMO-CUSTOM",
      title: "In-Memory IO Breakthrough",
      description: "Replace physical disk I/O with VirtualMemoryFS",
      resolutionSummary: "Zero real disk writes achieved",
      tags: ["perf", "fs"],
      category: "PARETO_CANDIDATE",
      status: "RESOLVED",
    });

    const promoted = engine.promoteParetoResolutionToInvariant({
      workingEntryId: "W-PROMO-CUSTOM",
      invariantId: "AXIOM-ZERO-DISK",
      category: "ARCHITECTURAL_INVARIANT",
      statement: "Unit tests shall never touch physical storage",
      rationale: "Ensures sub-10ms test execution and eliminates APFS lock contention",
      tags: ["axiom", "testing"],
      metadata: { author: "implementer_mind_memory_perf" },
      archiveWorkingEntry: true,
    });

    expect(promoted.id).toBe("AXIOM-ZERO-DISK");
    expect(promoted.category).toBe("ARCHITECTURAL_INVARIANT");
    expect(promoted.tags).toEqual(["axiom", "testing"]);
    expect(promoted.metadata?.author).toBe("implementer_mind_memory_perf");

    expect(() =>
      engine.addBedrockInvariant({
        id: "AXIOM-ZERO-DISK",
        title: "Duplicate",
        statement: "Dup",
        rationale: "Dup",
      }),
    ).toThrow("Bedrock Invariant is immutable");

    expect(engine.getWorkingEntry("W-PROMO-CUSTOM")).toBeUndefined();
    expect(engine.getSupersessionIndex().getEpistemicStatus("W-PROMO-CUSTOM")).toBe("SUPERSEDED");
    expect(engine.getSupersessionIndex().getEntry("W-PROMO-CUSTOM")?.supersededBy).toBe(
      "archive-W-PROMO-CUSTOM",
    );
    expect(engine.getSupersessionIndex().getTerminalSuccessor("W-PROMO-CUSTOM")?.id).toBe(
      "AXIOM-ZERO-DISK",
    );
  });
});
