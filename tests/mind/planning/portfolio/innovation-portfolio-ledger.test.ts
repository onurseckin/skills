import { describe, expect, it } from "bun:test";
import {
  PORTFOLIO_TRACKS,
  PORTFOLIO_TARGET_PERCENTAGES,
  TRACK_DESCRIPTIONS,
  TIMIDITY_TRAP_MIN_WORKSTREAMS,
  SPECULATIVE_OVERALLOCATION_THRESHOLD_PERCENT,
  CORE_DEFICIT_THRESHOLD_PERCENT,
  MILESTONE_NAMES,
  MILESTONE_DEFINITIONS,
  AntiPatternLedger,
} from "../../../../olt/scripts/src/mind/planning/index.ts";

describe("Innovation Portfolio Governance - Constants & AntiPatternLedger", () => {
  it("verifies portfolio track constants, percentages, definitions, and trap thresholds", () => {
    expect(PORTFOLIO_TARGET_PERCENTAGES[PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]).toBe(70);
    expect(PORTFOLIO_TARGET_PERCENTAGES[PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]).toBe(20);
    expect(PORTFOLIO_TARGET_PERCENTAGES[PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]).toBe(10);
    expect(TRACK_DESCRIPTIONS[PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]).toBeDefined();
    expect(TRACK_DESCRIPTIONS[PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]).toBeDefined();
    expect(TRACK_DESCRIPTIONS[PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]).toBeDefined();
    expect(TIMIDITY_TRAP_MIN_WORKSTREAMS).toBe(3);
    expect(SPECULATIVE_OVERALLOCATION_THRESHOLD_PERCENT).toBe(15);
    expect(CORE_DEFICIT_THRESHOLD_PERCENT).toBe(55);
    expect(MILESTONE_NAMES.FEASIBILITY_PROTOTYPE).toBe("FEASIBILITY_PROTOTYPE");
    expect(MILESTONE_DEFINITIONS[1].name).toBe("FEASIBILITY_PROTOTYPE");
    expect(MILESTONE_DEFINITIONS[2].name).toBe("STRESS_VALIDATION");
    expect(MILESTONE_DEFINITIONS[3].name).toBe("SYSTEM_INTEGRATION");
  });

  describe("AntiPatternLedger", () => {
    it("records, searches, prevents repetition, and serializes anti-patterns", () => {
      const ledger = new AntiPatternLedger();
      const entry1 = ledger.recordAntiPattern({
        betId: "b-1",
        betTitle: "Distributed DHT Mesh",
        falsifiedHypothesis: "Pure peer-to-peer gossip achieves <50ms consensus in churn networks",
        failedMilestone: 2,
        failedMilestoneName: "STRESS_VALIDATION",
        failureReason: "Split-brain partition under 10% packet drop",
        tags: ["p2p", "dht", "mesh"],
        topic: "P2P Networking",
      });

      const entry2 = ledger.recordAntiPattern({
        id: "custom-anti-2",
        betId: "b-2",
        betTitle: "Custom In-Memory Regex Compiler",
        falsifiedHypothesis: "Custom backtracking regex compiler outperforms v8 by 2x",
        failedMilestone: 1,
        failedMilestoneName: "FEASIBILITY_PROTOTYPE",
        failureReason: "ReDoS stack overflow",
        symptoms: ["Exponential stack explosion"],
        lessonsLearned: "Use Thompson NFA instead of recursive backtracking.",
        tags: ["regex", "compiler"],
      });

      expect(ledger.getEntry(entry1.id)).toBeDefined();
      expect(ledger.getEntry("non-existent")).toBeUndefined();
      expect(ledger.getEntryByBetId("b-1")?.id).toBe(entry1.id);
      expect(ledger.getEntryByBetId("missing-bet")).toBeUndefined();
      expect(ledger.getAllEntries().length).toBe(2);

      expect(ledger.searchByTopic("").length).toBe(0);
      expect(ledger.searchByTopic("Networking").length).toBe(1);
      expect(ledger.searchByTopic("None").length).toBe(0);

      expect(ledger.searchByTags([]).length).toBe(0);
      expect(ledger.searchByTags(["dht"]).length).toBe(1);
      expect(ledger.searchByTags(["unmatched"]).length).toBe(0);

      expect(ledger.searchByQuery("").length).toBe(0);
      expect(ledger.searchByQuery("split-brain").length).toBe(1);
      expect(ledger.searchByQuery("Thompson").length).toBe(1);
      expect(ledger.searchByQuery("P2P").length).toBe(1);
      expect(ledger.searchByQuery("mesh").length).toBe(1);
      expect(ledger.searchByQuery("unknown-query").length).toBe(0);

      const conflictExact = ledger.checkHypothesisConflict(
        "Pure peer-to-peer gossip achieves <50ms consensus in churn networks",
      );
      expect(conflictExact.hasConflict).toBe(true);
      expect(conflictExact.matchingEntries[0]?.preventedRepetitionsCount).toBe(1);

      const conflictSubstring = ledger.checkHypothesisConflict(
        "Custom backtracking regex compiler outperforms v8 by 2x in production",
      );
      expect(conflictSubstring.hasConflict).toBe(true);

      const conflictWords = ledger.checkHypothesisConflict(
        "Custom backtracking regex compiler is tested here",
      );
      expect(conflictWords.hasConflict).toBe(true);

      const conflictTopicTags = ledger.checkHypothesisConflict(
        "Alternative networking scheme",
        ["p2p", "mesh"],
        "P2P Networking",
      );
      expect(conflictTopicTags.hasConflict).toBe(true);

      const singleTagNoConflict = ledger.checkHypothesisConflict(
        "Alternative single tag",
        ["p2p"],
        "P2P Networking",
      );
      expect(singleTagNoConflict.hasConflict).toBe(false);

      const cleanCheck = ledger.checkHypothesisConflict(
        "Unrelated SIMD vector optimization",
        ["simd"],
        "SIMD",
      );
      expect(cleanCheck.hasConflict).toBe(false);

      expect(ledger.incrementPreventedRepetition(entry1.id)).toBe(true);
      expect(ledger.incrementPreventedRepetition("missing-id")).toBe(false);

      const json = ledger.exportJson();
      const freshLedger = new AntiPatternLedger();
      freshLedger.importJson(json);
      expect(freshLedger.getAllEntries().length).toBe(2);
      freshLedger.clear();
      expect(freshLedger.getAllEntries().length).toBe(0);
    });
  });
});
