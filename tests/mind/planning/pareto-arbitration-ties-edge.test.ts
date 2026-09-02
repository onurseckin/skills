import { describe, expect, it } from "bun:test";
import {
  arbitrateMultipleApproaches,
  arbitrateParetoApproaches,
  arbitrateParetoCandidates,
  arbitrateParetoPair,
  enforcePreDeclaredParetoArbitration,
  filterParetoFrontier,
  type ParetoApproachCandidate,
  type ParetoPriorityLevel,
} from "../../../olt/scripts/src/mind/planning/pareto-arbitration.ts";

function cand(
  name: string,
  level: ParetoPriorityLevel,
  complexity = 10,
  perf = 0,
): ParetoApproachCandidate {
  return {
    name,
    claimedPriorityLevel: level,
    cognitiveComplexityScore: complexity,
    perfGainPercent: perf,
  };
}

describe("Pareto Arbitration Ties and Multi-Approach Edge Coverage", () => {
  it("breaks Priority 1 ties by complexity, performance, and default order", () => {
    expect(arbitrateParetoApproaches(cand("P1 Low", 1, 5), cand("P1 High", 1, 15)).winner).toBe(
      "P1 Low",
    );
    expect(
      arbitrateParetoApproaches(cand("P1 Fast", 1, 10, 30), cand("P1 Slow", 1, 10, 10)).winner,
    ).toBe("P1 Fast");
    expect(arbitrateParetoApproaches(cand("P1 A", 1, 10, 10), cand("P1 B", 1, 10, 10)).winner).toBe(
      "P1 A",
    );
  });

  it("breaks Priority 2 ties by complexity, performance, and default order", () => {
    expect(arbitrateParetoApproaches(cand("P2 Low", 2, 2), cand("P2 High", 2, 8)).winner).toBe(
      "P2 Low",
    );
    expect(
      arbitrateParetoApproaches(cand("P2 Fast", 2, 5, 12), cand("P2 Slow", 2, 5, 2)).winner,
    ).toBe("P2 Fast");
    expect(arbitrateParetoApproaches(cand("P2 A", 2, 5), cand("P2 B", 2, 5)).winner).toBe("P2 A");
  });

  it("breaks Priority 3 ties by performance, complexity, and default order", () => {
    expect(
      arbitrateParetoApproaches(cand("P3 Fast", 3, 20, 50), cand("P3 Slow", 3, 20, 25)).winner,
    ).toBe("P3 Fast");
    expect(
      arbitrateParetoApproaches(cand("P3 Simple", 3, 12, 30), cand("P3 Complex", 3, 24, 30)).winner,
    ).toBe("P3 Simple");
    expect(arbitrateParetoApproaches(cand("P3 A", 3, 15, 30), cand("P3 B", 3, 15, 30)).winner).toBe(
      "P3 A",
    );
  });

  it("breaks Priority 4 ties and supports arbitrateParetoPair alias", () => {
    const p4A = cand("P4 Simple", 4, 10);
    const p4B = cand("P4 Complex", 4, 30);
    expect(arbitrateParetoApproaches(p4A, p4B).winner).toBe("P4 Simple");
    expect(
      arbitrateParetoApproaches(cand("P4 Ident A", 4, 20), cand("P4 Ident B", 4, 20)).winner,
    ).toBe("P4 Ident A");

    const pairResult = arbitrateParetoPair(p4A, p4B);
    expect(pairResult.winner).toBe("P4 Simple");
    expect(pairResult.loser).toBe("P4 Complex");
  });

  it("filters Pareto frontiers across empty, single, invalid, and multi-candidate sets", () => {
    expect(filterParetoFrontier([])).toEqual([]);
    expect(filterParetoFrontier([{ name: "Single" }])).toHaveLength(1);
    expect(
      filterParetoFrontier([
        { name: "InvA", hasErrors: true },
        { name: "InvB", uxDegradation: true },
      ]),
    ).toHaveLength(1);

    const dominant = {
      name: "Dom",
      claimedPriorityLevel: 1 as const,
      cognitiveComplexityScore: 2,
      empiricalValueScore: 100,
    };
    const dominated = {
      name: "Sub",
      claimedPriorityLevel: 4 as const,
      cognitiveComplexityScore: 50,
      empiricalValueScore: 10,
    };
    const frontier = filterParetoFrontier([dominant, dominated]);
    expect(frontier).toHaveLength(1);
    expect(frontier[0]?.name).toBe("Dom");
  });

  it("arbitrates multiple approaches across edge conditions and debate deadlock threshold", () => {
    expect(arbitrateMultipleApproaches([]).winner).toBe("NONE");

    const disqualified: ParetoApproachCandidate[] = [
      { name: "Err1", hasErrors: true },
      { name: "Err2", uxDegradation: true },
    ];
    expect(arbitrateMultipleApproaches(disqualified).winner).toBe("NONE");

    const lone: ParetoApproachCandidate = { name: "Lone", claimedPriorityLevel: 2 };
    const loneRes = arbitrateMultipleApproaches([lone, ...disqualified]);
    expect(loneRes.winner).toBe("Lone");
    expect(loneRes.rankedCandidates?.[0]?.isDominantOnFrontier).toBe(true);

    const c1 = cand("C1", 2, 5);
    const c2 = cand("C2", 3, 10, 25);
    const c3 = cand("C3", 4);

    const multiRes = arbitrateParetoCandidates([c1, c2, c3], c1, {
      topic: "Sync",
      debateCycles: 3,
    });
    expect(multiRes.winner).toBe("C2");
    expect(multiRes.forcedByThreshold).toBe(true);
    expect(multiRes.candidateRankings).toEqual(["C2", "C1", "C3"]);

    const deadlockRes = enforcePreDeclaredParetoArbitration("Protocol", 1, [c1, c2]);
    expect(deadlockRes.winner).toBe("C2");
    expect(deadlockRes.forcedByThreshold).toBe(true);
  });
});
