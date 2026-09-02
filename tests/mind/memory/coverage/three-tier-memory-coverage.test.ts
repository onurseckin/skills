import { describe, expect, it } from "bun:test";
import {
  ThreeTierMemoryEngine,
  type BedrockInvariant,
  type WorkingMemoryEntry,
  type ArchivedEpicEntry,
} from "../../../../olt/scripts/src/mind/memory/three-tier-memory.ts";

describe("Three Tier Memory Engine Coverage Suite", () => {
  it("manages Tier 1 Bedrock Invariants with strict immutability", () => {
    const engine = new ThreeTierMemoryEngine();
    expect(() =>
      engine.addBedrockInvariant({ id: "", title: "", statement: "", rationale: "" }),
    ).toThrow("Bedrock Invariant ID cannot be empty");

    const inv = engine.addBedrockInvariant({
      id: "AXIOM-01",
      title: "Zero Any Invariant",
      statement: "No any",
      rationale: "Soundness",
      supersedesHistoricalIds: ["HIST-01"],
    });

    expect(engine.hasBedrockInvariant("AXIOM-01")).toBe(true);
    expect(engine.getBedrockInvariant("AXIOM-01")?.title).toBe("Zero Any Invariant");
    expect(engine.getBedrockInvariantCount()).toBe(1);
    expect(engine.getBedrockInvariants().length).toBe(1);
    expect(() => engine.addBedrockInvariant(inv)).toThrow("Bedrock Invariant is immutable");
    expect(engine.getSupersessionIndex().getEpistemicStatus("HIST-01")).toBe("SUPERSEDED");
  });

  it("handles Tier 2 Working Memory additions, updates, deletions, and filters", () => {
    const engine = new ThreeTierMemoryEngine();
    expect(() => engine.addWorkingEntry({ id: "", title: "", description: "" })).toThrow(
      "Working memory entry ID cannot be empty",
    );

    engine.addWorkingEntry({
      id: "W1",
      title: "E1",
      category: "ACTIVE_EPIC",
      description: "D1",
      priority: "HIGH",
      tags: ["core"],
    });
    engine.addWorkingEntry({
      id: "W2",
      title: "C2",
      category: "PARETO_CANDIDATE",
      description: "D2",
      priority: "LOW",
      status: "IN_PROGRESS",
    });

    expect(engine.getWorkingMemoryCount()).toBe(2);
    expect(engine.getWorkingEntry("W1")?.priority).toBe("HIGH");

    const updated = engine.updateWorkingEntry("W1", {
      title: "E1 Up",
      priority: "CRITICAL",
      resolutionSummary: "Partial",
      tags: ["v2"],
    });
    expect(updated.title).toBe("E1 Up");
    expect(updated.priority).toBe("CRITICAL");
    expect(() => engine.updateWorkingEntry("NON-EXISTENT", {})).toThrow(
      "Working memory entry not found",
    );

    expect(engine.getWorkingEntries({ category: "ACTIVE_EPIC" }).length).toBe(1);
    expect(engine.getWorkingEntries({ category: ["ACTIVE_EPIC", "PARETO_CANDIDATE"] }).length).toBe(
      2,
    );
    expect(engine.getWorkingEntries({ status: "IN_PROGRESS" }).length).toBe(1);
    expect(engine.getWorkingEntries({ tags: ["v2"] }).length).toBe(1);
    expect(engine.getWorkingEntries({ tags: ["missing"] }).length).toBe(0);
    expect(engine.getWorkingEntries({ minPriority: "HIGH" }).length).toBe(1);

    expect(engine.deleteWorkingEntry("W2")).toBe(true);
    expect(engine.getWorkingMemoryCount()).toBe(1);
  });

  it("handles Tier 3 Archived Epics with filtering and compaction", () => {
    const engine = new ThreeTierMemoryEngine();
    expect(() => engine.addArchivedEntry({ id: "", summaryAbstract: "", title: "" })).toThrow(
      "Archived epic ID cannot be empty",
    );

    engine.addArchivedEntry({
      id: "A1",
      title: "A1",
      category: "CORE",
      summaryAbstract: "Ab1",
      outcome: "SUCCESS",
      epistemicStatus: "ACTIVE",
      tags: ["db"],
    });
    engine.addArchivedEntry({
      id: "A2",
      title: "A2",
      category: "CORE",
      summaryAbstract: "Ab2",
      outcome: "SUPERSEDED",
      epistemicStatus: "SUPERSEDED",
    });

    expect(engine.getArchivedEpicCount()).toBe(2);
    expect(engine.getArchivedEntry("A1")?.outcome).toBe("SUCCESS");
    expect(engine.getArchivedEntries({ category: "CORE" }).length).toBe(2);
    expect(engine.getArchivedEntries({ outcome: "SUCCESS" }).length).toBe(1);
    expect(engine.getArchivedEntries({ epistemicStatus: "ACTIVE" }).length).toBe(1);
    expect(engine.getArchivedEntries({ tags: ["db"] }).length).toBe(1);

    engine.addWorkingEntry({
      id: "W-COMP",
      title: "Compact",
      description: "Desc",
      status: "RESOLVED",
      resolutionSummary: "Res",
    });
    const compacted = engine.compactAndArchiveEpic({
      workingEntryId: "W-COMP",
      outcome: "SUCCESS",
      removeWorkingEntry: false,
    });
    expect(compacted.id).toBe("archive-W-COMP");
    expect(engine.getWorkingEntry("W-COMP")?.status).toBe("ARCHIVED");
  });

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
  });
});
