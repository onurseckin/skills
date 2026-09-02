import { describe, expect, it } from "bun:test";
import {
  executeRetrievalSandbox,
  formatCleanInsightBundleMarkdown,
  RetrievalSandbox,
} from "../../../olt/scripts/src/mind/memory/retrieval-sandbox.ts";
import { ThreeTierMemoryEngine } from "../../../olt/scripts/src/mind/memory/three-tier-memory.ts";

describe("Retrieval Sandbox Coverage Suite", () => {
  function createPopulatedEngine(): ThreeTierMemoryEngine {
    const engine = new ThreeTierMemoryEngine();

    engine.addBedrockInvariant({
      id: "INV-001",
      title: "Clean Type Safety Invariant",
      statement: "All code must maintain strict TypeScript typing with zero any.",
      rationale: "Ensures systemic soundness.",
      settledDate: "2026-09-01T00:00:00.000Z",
      tags: ["types", "typescript", "axiom"],
    });

    engine.addWorkingEntry({
      id: "WORK-101",
      title: "Executive Dashboard Implementation",
      category: "ACTIVE_EPIC",
      description: "Implement executive dashboard markdown renderer and file persistence.",
      resolutionSummary: "Delivered live briefing engine.",
      createdAt: "2026-09-01T06:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
    });

    engine.addArchivedEntry({
      id: "ARCH-201",
      title: "Legacy Reactive Graph Pipeline",
      category: "ARCHIVED_EPIC",
      summaryAbstract: "Old reactive pipeline with complex state graphs.",
      keyDecisions: ["Deprecated in favor of 2-tier LRU cache"],
      outcome: "PARETO_OPTIMIZED",
      archivedAt: "2026-08-15T00:00:00.000Z",
      epistemicStatus: "SUPERSEDED",
      supersededBy: "INV-001",
      successorInvariantId: "INV-001",
      tags: ["pipeline", "legacy"],
    });

    engine.addArchivedEntry({
      id: "ARCH-202",
      title: "Deprecated XML Transport",
      category: "ARCHIVED_EPIC",
      summaryAbstract: "Old XML protocol handler.",
      outcome: "ABANDONED",
      archivedAt: "2026-08-10T00:00:00.000Z",
      epistemicStatus: "DEPRECATED",
    });

    return engine;
  }

  it("executes default unconstrained query and scores across all three tiers", () => {
    const engine = createPopulatedEngine();
    const bundle = executeRetrievalSandbox(engine);

    expect(bundle.results.length).toBe(2);
    expect(bundle.telemetry.candidatesEvaluated).toBe(4);
    expect(bundle.telemetry.supersededEntriesSuppressed).toBe(1);
    expect(bundle.telemetry.deprecatedEntriesSuppressed).toBe(1);
    expect(bundle.telemetry.suppressionRate).toBe(1.0);
    expect(bundle.results[0]?.tier).toBe("TIER_1");
    expect(bundle.results[1]?.tier).toBe("TIER_2");
  });

  it("performs token matching across title, id, tags, and content with tier multipliers", () => {
    const engine = createPopulatedEngine();

    const bundle = RetrievalSandbox.execute(engine, { query: "typescript strict", minScore: 0.1 });
    expect(bundle.results.length).toBe(1);
    expect(bundle.results[0]?.id).toBe("INV-001");
    expect(bundle.results[0]?.matchedTerms).toContain("typescript");
    expect(bundle.results[0]?.score).toBeGreaterThan(0);

    const idBundle = RetrievalSandbox.execute(engine, { query: "INV-001", minScore: 0.1 });
    expect(idBundle.results.length).toBe(1);
    expect(idBundle.results[0]?.id).toBe("INV-001");

    const titleBundle = RetrievalSandbox.execute(engine, { query: "Dashboard", minScore: 0.1 });
    expect(titleBundle.results.length).toBe(1);
    expect(titleBundle.results[0]?.id).toBe("WORK-101");

    const emptyBundle = RetrievalSandbox.execute(engine, {
      query: "nonexistenttermxyz",
      minScore: 0.1,
    });
    expect(emptyBundle.results.length).toBe(0);
  });

  it("filters accurately by categories, tags, tiers, and minScore", () => {
    const engine = createPopulatedEngine();

    expect(RetrievalSandbox.execute(engine, { categories: ["active_epic"] }).results.length).toBe(
      1,
    );
    expect(RetrievalSandbox.execute(engine, { tags: ["types"] }).results.length).toBe(1);
    expect(RetrievalSandbox.execute(engine, { tags: ["random-missing-tag"] }).results.length).toBe(
      0,
    );
    expect(RetrievalSandbox.execute(engine, { tiers: ["TIER_2"] }).results.length).toBe(1);
    expect(RetrievalSandbox.execute(engine, { minScore: 1000.0 }).results.length).toBe(0);
  });

  it("filters accurately by time range and limits maxResults", () => {
    const engine = createPopulatedEngine();

    const timeBundle = RetrievalSandbox.execute(engine, {
      timeRange: { start: "2026-09-01T05:00:00.000Z", end: "2026-09-01T09:00:00.000Z" },
    });
    expect(timeBundle.results.length).toBe(1);
    expect(timeBundle.results[0]?.id).toBe("WORK-101");

    expect(
      RetrievalSandbox.execute(engine, { timeRange: { end: "2026-01-01T00:00:00.000Z" } }).results
        .length,
    ).toBe(0);
    expect(
      RetrievalSandbox.execute(engine, { timeRange: { start: "2027-01-01T00:00:00.000Z" } }).results
        .length,
    ).toBe(0);
    expect(RetrievalSandbox.execute(engine, { maxResults: 1 }).results.length).toBe(1);
  });

  it("injects successor guidance for superseded entries when requested or unsuppressed", () => {
    const engine = createPopulatedEngine();

    const guidedBundle = RetrievalSandbox.execute(engine, {
      tiers: ["TIER_3"],
      includeSuccessorGuidance: true,
      suppressObsolete: false,
    });

    expect(guidedBundle.results.length).toBe(2);
    const item = guidedBundle.results.find((r) => r.id === "ARCH-201");
    expect(item?.epistemicStatus).toBe("SUPERSEDED");
    expect(item?.successorGuidance?.successorInvariantId).toBe("INV-001");

    const md = formatCleanInsightBundleMarkdown(guidedBundle);
    expect(md).toContain("[->");
    expect(md).toContain("ARCH-201");
  });

  it("extracts centered snippets and formats clean insight bundles as markdown", () => {
    const engine = createPopulatedEngine();
    const longTextWithMatch = "Prefix ".repeat(40) + "targetphrase keyword " + "Suffix ".repeat(40);
    const longTextNoMatch = "Filler text paragraph ".repeat(20);

    engine.addWorkingEntry({
      id: "WORK-LONG-MATCH",
      title: "Long Match",
      description: longTextWithMatch,
    });
    engine.addWorkingEntry({
      id: "WORK-LONG-NO-MATCH",
      title: "Long No Match",
      description: longTextNoMatch,
    });

    const bundle = executeRetrievalSandbox(engine, { query: "targetphrase", minScore: 0.1 });
    expect(bundle.results.length).toBe(1);
    expect(bundle.results[0]?.content).toContain("targetphrase");
    expect(bundle.results[0]?.content.startsWith("...")).toBe(true);
    expect(bundle.results[0]?.content.endsWith("...")).toBe(true);

    const unconstrainedBundle = executeRetrievalSandbox(engine, {
      query: "onlymatcheslongmatch",
      tiers: ["TIER_2"],
    });
    expect(unconstrainedBundle.results.some((r) => r.content.endsWith("..."))).toBe(true);

    const formattedMd = formatCleanInsightBundleMarkdown(bundle);
    expect(formattedMd).toContain("# Ephemeral Retrieval Sandbox Insight Bundle");
    expect(formattedMd).toContain("WORK-LONG-MATCH");

    const emptyBundle = executeRetrievalSandbox(engine, {
      query: "nothingwillmatchthis",
      minScore: 0.1,
    });
    expect(formatCleanInsightBundleMarkdown(emptyBundle)).toContain(
      "_No memory entries matched the search criteria._",
    );
  });
});
