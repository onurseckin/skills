import { describe, expect, it } from "bun:test";
import {
  AntiPatternLedger,
  InnovationPortfolioManager,
  PORTFOLIO_TRACKS,
  MILESTONE_NAMES,
} from "../../../olt/scripts/src/mind/planning/innovation-portfolio.ts";

describe("Innovation Portfolio Deep & Comprehensive Suite", () => {
  describe("AntiPatternLedger Edge Cases & Algorithms", () => {
    it("handles default fallback fields when recording anti-patterns", () => {
      const ledger = new AntiPatternLedger();
      const entry = ledger.recordAntiPattern({
        betId: "bet-default-1",
        betTitle: "Auto Title",
        falsifiedHypothesis: "Hypothesis without extra fields",
        failedMilestone: 1,
        failedMilestoneName: MILESTONE_NAMES.FEASIBILITY_PROTOTYPE,
        failureReason: "Budget exhaustion",
      });

      expect(entry.id).toContain("anti-bet-default-1-");
      expect(entry.symptoms).toEqual([]);
      expect(entry.lessonsLearned).toContain(
        "failed empirical verification at FEASIBILITY_PROTOTYPE",
      );
      expect(entry.tags).toEqual([]);
      expect(entry.topic).toBe("Auto Title");
      expect(entry.preventedRepetitionsCount).toBe(0);
    });

    it("verifies search operations on empty or non-matching queries", () => {
      const ledger = new AntiPatternLedger();
      ledger.recordAntiPattern({
        betId: "b-search",
        betTitle: "GraphQL Gateway",
        falsifiedHypothesis: "Direct client schema federation reduces memory footprint",
        failedMilestone: 2,
        failedMilestoneName: MILESTONE_NAMES.STRESS_VALIDATION,
        failureReason: "N+1 query cascades",
        symptoms: ["Cascade latency spike"],
        lessonsLearned: "Use dataloader caching batching layer",
        tags: ["graphql", "gateway", "caching"],
        topic: "API Layer",
      });

      expect(ledger.searchByTopic("  ")).toEqual([]);
      expect(ledger.searchByTopic("API")).toHaveLength(1);
      expect(ledger.searchByTags([])).toEqual([]);
      expect(ledger.searchByTags(["GATEWAY"])).toHaveLength(1);
      expect(ledger.searchByTags(["unknown"])).toHaveLength(0);
      expect(ledger.searchByQuery("   ")).toEqual([]);
      expect(ledger.searchByQuery("N+1")).toHaveLength(1);
      expect(ledger.searchByQuery("dataloader")).toHaveLength(1);
      expect(ledger.searchByQuery("Direct Client")).toHaveLength(1);
      expect(ledger.searchByQuery("caching")).toHaveLength(1);
    });

    it("exercises checkHypothesisConflict across exact, substring, keyword overlap, and tag/topic heuristics", () => {
      const ledger = new AntiPatternLedger();
      ledger.recordAntiPattern({
        betId: "b-hypo",
        betTitle: "Zero Copy IPC",
        falsifiedHypothesis:
          "Shared memory ring buffer delivers deterministic sub-microsecond latency across processes",
        failedMilestone: 2,
        failedMilestoneName: MILESTONE_NAMES.STRESS_VALIDATION,
        failureReason: "Lock contention on futex under heavy contention",
        tags: ["ipc", "shared-memory", "low-latency"],
        topic: "IPC System",
      });

      const subRes = ledger.checkHypothesisConflict(
        "Shared memory ring buffer delivers deterministic sub-microsecond latency",
      );
      expect(subRes.hasConflict).toBe(true);
      expect(subRes.conflictWarning).toContain("Zero Copy IPC");

      const overlapRes = ledger.checkHypothesisConflict(
        "Shared memory ring buffer achieves deterministic performance in benchmarks",
      );
      expect(overlapRes.hasConflict).toBe(true);

      const tagTopicRes = ledger.checkHypothesisConflict(
        "Completely different wording but same domain",
        ["ipc", "shared-memory"],
        "IPC System",
      );
      expect(tagTopicRes.hasConflict).toBe(true);

      expect(
        ledger.checkHypothesisConflict("Completely different wording", ["ipc"], "IPC System")
          .hasConflict,
      ).toBe(false);
      expect(
        ledger.checkHypothesisConflict(
          "Completely different wording",
          ["ipc", "shared-memory"],
          "Storage System",
        ).hasConflict,
      ).toBe(false);
      expect(
        ledger.checkHypothesisConflict("Unique text without tags", undefined, "IPC System")
          .hasConflict,
      ).toBe(false);
    });

    it("handles json serialization round-trip and clear", () => {
      const ledger = new AntiPatternLedger();
      ledger.recordAntiPattern({
        betId: "b-json",
        betTitle: "JSON Test",
        falsifiedHypothesis: "Hypothesis for JSON",
        failedMilestone: 1,
        failedMilestoneName: MILESTONE_NAMES.FEASIBILITY_PROTOTYPE,
        failureReason: "Failed prototype",
      });

      const serialized = ledger.exportJson();
      const importedLedger = new AntiPatternLedger();
      importedLedger.importJson(serialized);
      expect(importedLedger.getEntryByBetId("b-json")).toBeDefined();
      importedLedger.clear();
      expect(importedLedger.getAllEntries()).toHaveLength(0);
      expect(importedLedger.getEntryByBetId("b-json")).toBeUndefined();
    });
  });

  describe("InnovationPortfolioManager Governance & Balance Auditing", () => {
    it("manages workstream lifecycles and registration defaults", () => {
      const manager = new InnovationPortfolioManager();
      manager.registerWorkstream({
        id: "ws-custom-1",
        title: "Workstream 1",
        track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
      });

      const wsList = manager.getWorkstreams();
      expect(wsList).toHaveLength(1);
      expect(wsList[0]?.allocationWeight).toBe(1);
      expect(wsList[0]?.status).toBe("ACTIVE");
      expect(wsList[0]?.createdAt).toBeDefined();

      expect(manager.removeWorkstream("ws-custom-1")).toBe(true);
      expect(manager.getWorkstreams()).toHaveLength(0);
    });

    it("evaluates Core Deficit when Arch Evolution is below or above 20%", () => {
      const manager = new InnovationPortfolioManager();

      const rArch = manager.auditPortfolioBalance([
        {
          id: "c1",
          title: "C",
          track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
          allocationWeight: 40,
        },
        {
          id: "a1",
          title: "A",
          track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION,
          allocationWeight: 50,
        },
        {
          id: "e1",
          title: "E",
          track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS,
          allocationWeight: 10,
        },
      ]);
      expect(rArch.status).toBe("CORE_DEFICIT");

      const rExp = manager.auditPortfolioBalance([
        {
          id: "c1",
          title: "C",
          track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
          allocationWeight: 50,
        },
        {
          id: "a1",
          title: "A",
          track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION,
          allocationWeight: 10,
        },
        {
          id: "e1",
          title: "E",
          track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS,
          allocationWeight: 40,
        },
      ]);
      expect(rExp.status).toBe("SPECULATIVE_OVERALLOCATION");

      const m2 = new InnovationPortfolioManager();
      m2.registerWorkstream({
        id: "w1",
        title: "W1",
        track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH,
        allocationWeight: 70,
      });
      m2.registerWorkstream({
        id: "w2",
        title: "W2",
        track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION,
        allocationWeight: 20,
      });
      m2.registerWorkstream({
        id: "w3",
        title: "W3",
        track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS,
        allocationWeight: 10,
      });
      expect(m2.auditPortfolioBalance().isBalanced).toBe(true);
    });
  });

  describe("Exploratory Bets Lifecycle & 3-Milestone Gates", () => {
    it("registers bets and advances through M1 -> M2 -> M3 graduation", () => {
      const manager = new InnovationPortfolioManager();
      const bet = manager.registerBet({
        id: "b-pqc",
        title: "PQC",
        falsifiableHypothesis: "Kyber <2ms overhead",
        valueProposition: "Security",
        budget: 5000,
        milestone1Criteria: ["POC"],
        milestone2Criteria: ["Load"],
        milestone3Criteria: ["Zero reg"],
        tags: ["crypto"],
        topic: "Crypto",
        owner: "alice",
      });
      expect(bet.id === "b-pqc" && bet.budget.totalAllocated === 5000).toBe(true);

      const e1 = manager.evaluateMilestone(bet.id, 1, {
        passed: true,
        evidence: "POC passed",
        spentBudget: 450,
      });
      expect(e1.passed && e1.nextMilestone === 2).toBe(true);

      const e2 = manager.evaluateMilestone(bet.id, 2, {
        passed: true,
        evidence: "Load passed",
        spentBudget: 600,
      });
      expect(e2.passed && e2.nextMilestone === 3).toBe(true);

      const e3 = manager.evaluateMilestone(bet.id, 3, {
        passed: true,
        evidence: "No reg",
        spentBudget: 350,
        targetGraduationTrack: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION,
        productionRolloutPlan: "Canary rollout.",
      });
      expect(e3.passed && e3.newStatus === "GRADUATED" && !!e3.graduationCertificate).toBe(true);
      expect(manager.getBet(bet.id)?.status).toBe("GRADUATED");
    });

    it("handles milestone failure with custom symptoms and lessons learned", () => {
      const manager = new InnovationPortfolioManager();
      const bet = manager.registerBet({
        title: "Wasm",
        falsifiableHypothesis: "Wasm native speed",
        valueProposition: "Plugins",
      });
      const eFail = manager.evaluateMilestone(bet.id, 1, {
        passed: false,
        evidence: "Cold start slow",
        failureReason: "Cold-start latency",
        failureSymptoms: ["150ms tail"],
        lessonsLearned: "Use AOT.",
        spentBudget: 250,
      });
      expect(eFail.passed).toBe(false);
      expect(eFail.newStatus).toBe("TERMINATED");
      expect(eFail.antiPatternEntry?.lessonsLearned).toContain("Use AOT");
      expect(manager.getBet(bet.id)?.status).toBe("TERMINATED");
    });
  });
});
