import { describe, expect, it } from "bun:test";
import {
  AntiPatternLedger,
  InnovationPortfolioManager,
  PORTFOLIO_TRACKS,
} from "../../../../olt/scripts/src/mind/planning/innovation-portfolio.ts";

describe("Innovation Portfolio Ledger and Balancer Edge Coverage", () => {
  describe("AntiPatternLedger Edge Cases", () => {
    it("handles recordAntiPattern default fields when omitted", () => {
      const ledger = new AntiPatternLedger();
      const entry = ledger.recordAntiPattern({
        betId: "b-def",
        betTitle: "Actor Model",
        falsifiedHypothesis: "Actors eliminate lock contention",
        failedMilestone: 1,
        failedMilestoneName: "FEASIBILITY_PROTOTYPE",
        failureReason: "Mailbox memory blowup",
      });

      expect(entry.id.startsWith("anti-b-def-")).toBe(true);
      expect(entry.symptoms).toEqual([]);
      expect(entry.lessonsLearned).toContain("failed empirical verification");
      expect(entry.tags).toEqual([]);
      expect(entry.topic).toBe("Actor Model");
      expect(entry.preventedRepetitionsCount).toBe(0);
    });

    it("handles search methods with whitespace, non-matching queries, and empty inputs", () => {
      const ledger = new AntiPatternLedger();
      ledger.recordAntiPattern({
        betId: "b-search",
        betTitle: "Wasm Sandbox",
        falsifiedHypothesis: "Wasm JIT compiles with zero overhead",
        failedMilestone: 2,
        failedMilestoneName: "STRESS_VALIDATION",
        failureReason: "Cold start 450ms",
        tags: ["wasm", "jit"],
        topic: "Virtualization",
      });

      expect(ledger.searchByTopic("   ")).toEqual([]);
      expect(ledger.searchByTopic("virtualization")).toHaveLength(1);
      expect(ledger.searchByTopic("unknown")).toEqual([]);
      expect(ledger.searchByTags([])).toEqual([]);
      expect(ledger.searchByTags(["  WASM  "])).toHaveLength(1);
      expect(ledger.searchByTags(["missing"])).toEqual([]);
      expect(ledger.searchByQuery("   ")).toEqual([]);
      expect(ledger.searchByQuery("Cold start")).toHaveLength(1);
      expect(ledger.searchByQuery("none")).toEqual([]);
    });

    it("evaluates hypothesis conflict heuristics across exact, word-overlap, and tag matches", () => {
      const ledger = new AntiPatternLedger();
      const entry = ledger.recordAntiPattern({
        betId: "b-conf",
        betTitle: "Lockfree Queue",
        falsifiedHypothesis:
          "Ring buffer lockfree queue guarantees zero allocations and high throughput",
        failedMilestone: 3,
        failedMilestoneName: "SYSTEM_INTEGRATION",
        failureReason: "Cache line bouncing",
        tags: ["concurrency", "queue"],
        topic: "Concurrency",
      });

      expect(ledger.checkHypothesisConflict("!@#$ %^&*").hasConflict).toBe(false);

      const topicTagMatch = ledger.checkHypothesisConflict(
        "Different wording",
        ["concurrency", "queue"],
        "Concurrency",
      );
      expect(topicTagMatch.hasConflict).toBe(true);
      expect(topicTagMatch.matchingEntries[0]?.id).toBe(entry.id);

      const mismatch = ledger.checkHypothesisConflict(
        "Attempt",
        ["concurrency", "other"],
        "Concurrency",
      );
      expect(mismatch.hasConflict).toBe(false);
      expect(ledger.incrementPreventedRepetition("missing")).toBe(false);
      expect(ledger.incrementPreventedRepetition(entry.id)).toBe(true);
    });

    it("exports, clears, and imports anti-pattern JSON data", () => {
      const ledger = new AntiPatternLedger();
      ledger.recordAntiPattern({
        betId: "b-ser",
        betTitle: "GC Engine",
        falsifiedHypothesis: "GC reduces pause times",
        failedMilestone: 2,
        failedMilestoneName: "STRESS_VALIDATION",
        failureReason: "50ms pause",
      });

      const json = ledger.exportJson();
      expect(json).toContain("GC Engine");
      ledger.clear();
      expect(ledger.getAllEntries()).toHaveLength(0);
      expect(ledger.getEntryByBetId("b-ser")).toBeUndefined();
      ledger.importJson(json);
      expect(ledger.getAllEntries()).toHaveLength(1);
      expect(ledger.getEntryByBetId("b-ser")).toBeDefined();
    });
  });

  describe("InnovationPortfolioManager Balancer Edge Cases", () => {
    it("initializes with options and manages workstreams", () => {
      const customLedger = new AntiPatternLedger();
      const manager = new InnovationPortfolioManager({
        initialWorkstreams: [
          {
            id: "ws-1",
            title: "Bedrock Safety",
            track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
            allocationWeight: 2,
          },
        ],
        antiPatternLedger: customLedger,
      });

      expect(manager.getAntiPatternLedger()).toBe(customLedger);
      expect(manager.getWorkstreams()).toHaveLength(1);
      expect(manager.removeWorkstream("ws-1")).toBe(true);
      expect(manager.removeWorkstream("ws-1")).toBe(false);
    });

    it("audits empty and inactive workstream portfolio", () => {
      const manager = new InnovationPortfolioManager();
      const emptyReport = manager.auditPortfolioBalance([]);
      expect(emptyReport.totalWorkstreams).toBe(0);
      expect(emptyReport.status).toBe("BALANCED");
      expect(emptyReport.isBalanced).toBe(true);

      manager.registerWorkstream({
        id: "ws-paused",
        title: "Paused",
        track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
        status: "PAUSED",
      });
      expect(manager.auditPortfolioBalance().totalWorkstreams).toBe(0);
    });

    it("detects Timidity Trap, Speculative Over-allocation, and Core Deficit with rebalance urgency", () => {
      const manager = new InnovationPortfolioManager();
      manager.registerWorkstream({
        id: "w1",
        title: "C1",
        track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
      });
      manager.registerWorkstream({
        id: "w2",
        title: "C2",
        track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
      });
      manager.registerWorkstream({
        id: "w3",
        title: "A1",
        track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION,
      });

      const timidity = manager.auditPortfolioBalance();
      expect(timidity.status).toBe("TIMIDITY_TRAP");
      expect(timidity.rebalanceActions[0]?.urgency).toBe("HIGH");

      const managerSpec = new InnovationPortfolioManager({
        initialWorkstreams: [
          {
            id: "s1",
            title: "Core",
            track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
            allocationWeight: 5,
          },
          {
            id: "s2",
            title: "Bet",
            track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS,
            allocationWeight: 5,
          },
        ],
      });
      const specReport = managerSpec.auditPortfolioBalance();
      expect(specReport.status).toBe("SPECULATIVE_OVERALLOCATION");
      expect(specReport.rebalanceActions[0]?.urgency).toBe("CRITICAL");
      expect(managerSpec.proposeRebalancePlan(specReport)).toEqual(specReport.rebalanceActions);

      const managerDef = new InnovationPortfolioManager({
        initialWorkstreams: [
          {
            id: "d1",
            title: "Core",
            track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
            allocationWeight: 4,
          },
          {
            id: "d2",
            title: "Arch",
            track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION,
            allocationWeight: 5,
          },
          {
            id: "d3",
            title: "Exp",
            track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS,
            allocationWeight: 1,
          },
        ],
      });
      const defReport = managerDef.auditPortfolioBalance();
      expect(defReport.status).toBe("CORE_DEFICIT");
      expect(defReport.rebalanceActions[0]?.fromTrack).toBe(
        PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION,
      );
    });
  });
});
