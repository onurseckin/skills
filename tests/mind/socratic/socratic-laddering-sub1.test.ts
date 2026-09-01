import { describe, expect, it } from "bun:test";
import {
  DIALECTICAL_LEVELS,
  HistoricalDebateMemory,
  IMPASSE_CRUCIBLE_THRESHOLD,
  PARETO_PRIORITY_LEVELS,
  SCALABILITY_THRESHOLD_PERCENT,
  SocraticLadderingEngine,
  type ParetoApproachInput,
  type StrategicCommitment,
} from "../../../olt/scripts/src/mind/auditing/socratic/index.ts";

describe("SocraticLadderingEngine", () => {


describe("State Transitions & Dialectical Laddering", () => {
    it("initializes with nominal L1 state when no arguments are provided", () => {
      const engine = new SocraticLadderingEngine();
      const state = engine.getState();

      expect(state.currentLevel).toBe(DIALECTICAL_LEVELS.L1_TRADE_OFF_VERIFICATION);
      expect(state.consecutiveImpasseCycles).toBe(0);
      expect(state.activeExchange).toBeUndefined();
      expect(state.history).toHaveLength(0);
      expect(state.consensusReached).toBeUndefined();
    });

    it("advances cleanly through L1 -> L2 -> L3 -> Consensus", () => {
      const memory = new HistoricalDebateMemory();
      const engine = new SocraticLadderingEngine(memory);

      // Level 1: Trade-off verification
      const ex1 = engine.evaluateCycle("cycle-1", "Cache Layer Redesign");
      expect(ex1.level).toBe(DIALECTICAL_LEVELS.L1_TRADE_OFF_VERIFICATION);
      expect(ex1.inquiry).toContain("Level 1 Trade-off Verification");
      expect(ex1.inquiry).toContain("Cache Layer Redesign");
      expect(ex1.requiresCrucible).toBe(false);

      const st1 = engine.submitResponse(
        "cycle-1",
        "Verified eviction trade-offs against write-through invariants.",
        { isSatisfactory: true },
      );
      expect(st1.currentLevel).toBe(DIALECTICAL_LEVELS.L2_SECOND_ORDER_IMPLICATIONS);
      expect(st1.consensusReached).toBe(false);

      // Level 2: Second-order implications
      const ex2 = engine.evaluateCycle("cycle-1", "Cache Layer Redesign");
      expect(ex2.level).toBe(DIALECTICAL_LEVELS.L2_SECOND_ORDER_IMPLICATIONS);
      expect(ex2.inquiry).toContain("Level 2 Second-Order Implications");

      const st2 = engine.submitResponse(
        "cycle-1",
        "Downstream blast radius bounded by per-tenant memory quotas.",
        { isSatisfactory: true },
      );
      expect(st2.currentLevel).toBe(DIALECTICAL_LEVELS.L3_EMERGENT_PARADIGMS);
      expect(st2.consensusReached).toBe(false);

      // Level 3: Emergent paradigms
      const ex3 = engine.evaluateCycle("cycle-1", "Cache Layer Redesign");
      expect(ex3.level).toBe(DIALECTICAL_LEVELS.L3_EMERGENT_PARADIGMS);
      expect(ex3.inquiry).toContain("Level 3 Emergent Paradigms");

      const st3 = engine.submitResponse(
        "cycle-1",
        "Enables zero-copy ring-buffer streaming architecture.",
        { isSatisfactory: true, consensusReached: true },
      );
      expect(st3.consensusReached).toBe(true);

      // Record final consensus
      const resolution = engine.recordConsensus(
        "cycle-1",
        "Cache Layer Redesign",
        "Zero-Copy Ring-Buffer Store",
        PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
        "Single-writer ring buffer with lockless reads",
      );

      expect(resolution.consensusReached).toBe(true);
      expect(resolution.winningApproach).toBe("Zero-Copy Ring-Buffer Store");
      expect(engine.getState().currentLevel).toBe(DIALECTICAL_LEVELS.L1_TRADE_OFF_VERIFICATION);
      expect(memory.getResolutions()).toHaveLength(1);
    });

    it("resets state for new topic while preserving history", () => {
      const engine = new SocraticLadderingEngine();
      engine.evaluateCycle("c-init", "First Topic");
      engine.submitResponse("c-init", "Good response", { isSatisfactory: true });
      expect(engine.getState().currentLevel).toBe(DIALECTICAL_LEVELS.L2_SECOND_ORDER_IMPLICATIONS);

      engine.resetForNewTopic();
      const state = engine.getState();
      expect(state.currentLevel).toBe(DIALECTICAL_LEVELS.L1_TRADE_OFF_VERIFICATION);
      expect(state.consecutiveImpasseCycles).toBe(0);
      expect(state.activeExchange).toBeUndefined();
      expect(state.history.length).toBeGreaterThan(0);
      expect(state.consensusReached).toBe(false);
    });
  });

describe("Accountability Lock Gate", () => {
    it("locks dialectic at L1 when unfulfilled commitments lack justification", () => {
      const memory = new HistoricalDebateMemory();
      const commitment: StrategicCommitment = {
        id: "comm-lock-1",
        topic: "Queue Storage",
        agreedResolution: "Adopt durable SQLite write-ahead log",
        targetMilestone: "M1",
        status: "pending",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
      memory.recordCommitment(commitment);

      // Try to initialize laddering at L2
      const engine = new SocraticLadderingEngine(memory, {
        currentLevel: DIALECTICAL_LEVELS.L2_SECOND_ORDER_IMPLICATIONS,
      });

      expect(engine.hasPendingCommitmentBlock()).toBe(true);

      // Evaluating cycle must snap back to L1 with accountability gate inquiry
      const ex = engine.evaluateCycle("cycle-acc", "New Feature Proposal");
      expect(ex.level).toBe(DIALECTICAL_LEVELS.L1_TRADE_OFF_VERIFICATION);
      expect(ex.unfulfilledCommitmentId).toBe("comm-lock-1");
      expect(ex.inquiry).toContain("Accountability Gate");
      expect(ex.inquiry).toContain("comm-lock-1");
      expect(engine.getState().currentLevel).toBe(DIALECTICAL_LEVELS.L1_TRADE_OFF_VERIFICATION);

      // Submitting satisfactory response cannot advance to L2 while memory is unfulfilled
      const stateStillLocked = engine.submitResponse(
        "cycle-acc",
        "We discuss new features instead.",
        { isSatisfactory: true },
      );
      expect(stateStillLocked.currentLevel).toBe(DIALECTICAL_LEVELS.L1_TRADE_OFF_VERIFICATION);

      // Once justification is provided for the commitment, laddering advances
      memory.updateCommitmentStatus(
        "comm-lock-1",
        "breached",
        "Deferred to M2 due to upstream IO refactor",
      );
      expect(engine.hasPendingCommitmentBlock()).toBe(false);

      const stateUnlocked = engine.submitResponse(
        "cycle-acc",
        "Commitment justified, progressing to implications.",
        { isSatisfactory: true },
      );
      expect(stateUnlocked.currentLevel).toBe(DIALECTICAL_LEVELS.L2_SECOND_ORDER_IMPLICATIONS);
    });
  });

describe("Impasse Tracking & Empirical Crucible Escalation", () => {
    it("escalates to Empirical Crucible when consecutive impasses exceed 2 cycles", () => {
      const engine = new SocraticLadderingEngine();

      // Cycle 1 impasse
      engine.evaluateCycle("c-imp-1", "Controversial Strategy");
      let state = engine.submitResponse("c-imp-1", "Inadequate argument", {
        isSatisfactory: false,
        reason: "Violates isolation guarantees",
      });
      expect(state.consecutiveImpasseCycles).toBe(1);
      expect(state.activeExchange?.requiresCrucible).toBe(false);

      // Cycle 2 impasse
      engine.evaluateCycle("c-imp-2", "Controversial Strategy");
      state = engine.submitResponse("c-imp-2", "Still ungrounded", {
        isSatisfactory: false,
        reason: "No benchmark data provided",
      });
      expect(state.consecutiveImpasseCycles).toBe(2);
      expect(state.activeExchange?.requiresCrucible).toBe(false);

      // Cycle 3 impasse (exceeds threshold 2)
      engine.evaluateCycle("c-imp-3", "Controversial Strategy");
      state = engine.submitResponse("c-imp-3", "Third impasse attempt", {
        isSatisfactory: false,
        reason: "Deadlocked on architectural approach",
      });
      expect(state.consecutiveImpasseCycles).toBe(3);
      expect(state.consecutiveImpasseCycles).toBeGreaterThan(IMPASSE_CRUCIBLE_THRESHOLD);
      expect(state.activeExchange?.requiresCrucible).toBe(true);

      // Next evaluateCycle reflects crucible requirement in inquiry
      const exCrucible = engine.evaluateCycle("c-imp-4", "Controversial Strategy");
      expect(exCrucible.requiresCrucible).toBe(true);
      expect(exCrucible.inquiry).toContain("IMPASSE DETECTED");
      expect(exCrucible.inquiry).toContain("Empirical Crucible");

      // Satisfactory response resets impasse counter
      const stateResolved = engine.submitResponse(
        "c-imp-4",
        "Empirical benchmarks verified 45% throughput boost.",
        { isSatisfactory: true },
      );
      expect(stateResolved.consecutiveImpasseCycles).toBe(0);
    });

    it("supports explicit escalateToCrucible invocation", () => {
      const engine = new SocraticLadderingEngine();
      const crucibleExchange = engine.escalateToCrucible(
        "c-direct-crucible",
        "Irreconcilable debate between memory-mapped vs disk-backed store",
      );

      expect(crucibleExchange.requiresCrucible).toBe(true);
      expect(crucibleExchange.inquiry).toContain("CRUCIBLE ESCALATION");
      expect(crucibleExchange.inquiry).toContain("memory-mapped vs disk-backed");
      expect(engine.getState().consecutiveImpasseCycles).toBeGreaterThan(
        IMPASSE_CRUCIBLE_THRESHOLD,
      );
    });
  });
});
