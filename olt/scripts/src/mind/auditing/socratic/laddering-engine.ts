import { HistoricalDebateMemory } from "./debate-memory.ts";
import {
  DIALECTICAL_LEVELS,
  IMPASSE_CRUCIBLE_THRESHOLD,
  PARETO_PRIORITY_LEVELS,
  SCALABILITY_THRESHOLD_PERCENT,
  type DialecticalLevel,
  type DebateExchange,
  type ParetoApproachInput,
  type ParetoComparisonMetrics,
  type ParetoComparisonResult,
  type ParetoPriorityLevel,
  type SocraticCycleContext,
  type SocraticEvaluationResult,
  type SocraticLadderingState,
  type StrategicCommitment,
  type StrategicResolution,
} from "./types.ts";

export class SocraticLadderingEngine {
  private readonly memory: HistoricalDebateMemory;
  private state: SocraticLadderingState;

  public constructor(
    memory?: HistoricalDebateMemory,
    initialState?: Partial<SocraticLadderingState>,
  ) {
    this.memory = memory ?? new HistoricalDebateMemory();
    this.state = {
      currentLevel: initialState?.currentLevel ?? DIALECTICAL_LEVELS.L1_TRADE_OFF_VERIFICATION,
      consecutiveImpasseCycles: initialState?.consecutiveImpasseCycles ?? 0,
      ...(initialState?.activeExchange !== undefined
        ? { activeExchange: initialState.activeExchange }
        : {}),
      history: initialState?.history ? [...initialState.history] : [],
      ...(initialState?.consensusReached !== undefined
        ? { consensusReached: initialState.consensusReached }
        : {}),
    };
  }

  public getState(): SocraticLadderingState {
    return {
      currentLevel: this.state.currentLevel,
      consecutiveImpasseCycles: this.state.consecutiveImpasseCycles,
      ...(this.state.activeExchange !== undefined
        ? { activeExchange: { ...this.state.activeExchange } }
        : {}),
      history: Object.freeze([...this.state.history]),
      ...(this.state.consensusReached !== undefined
        ? { consensusReached: this.state.consensusReached }
        : {}),
    };
  }

  public getMemory(): HistoricalDebateMemory {
    return this.memory;
  }

  public hasPendingCommitmentBlock(): boolean {
    return this.memory.hasUnfulfilledCommitmentsWithoutJustification();
  }

  public evaluateCycle(
    cycleId: string,
    topic: string,
    context?: SocraticCycleContext,
  ): DebateExchange {
    const isCommitmentBlocked = this.memory.hasUnfulfilledCommitmentsWithoutJustification();
    const requiresCrucible = this.state.consecutiveImpasseCycles > IMPASSE_CRUCIBLE_THRESHOLD;

    let level: DialecticalLevel = this.state.currentLevel;
    let unfulfilledCommitmentId: string | undefined = undefined;
    let inquiry: string;

    if (isCommitmentBlocked) {
      // Lock progression to L1 and demand accountability before exploring new topics
      level = DIALECTICAL_LEVELS.L1_TRADE_OFF_VERIFICATION;
      this.state = {
        ...this.state,
        currentLevel: DIALECTICAL_LEVELS.L1_TRADE_OFF_VERIFICATION,
      };

      const unfulfilled = this.memory.getUnfulfilledCommitments();
      const firstBlocking = unfulfilled.find(
        (c) => !c.justification || c.justification.trim().length === 0,
      );

      if (firstBlocking) {
        unfulfilledCommitmentId = firstBlocking.id;
        inquiry = `Accountability Gate: Prior commitment "${firstBlocking.id}" on topic "${firstBlocking.topic}" ("${firstBlocking.agreedResolution}", target: ${firstBlocking.targetMilestone}) remains ${firstBlocking.status} without justification. Dialectic is locked to L1: verify prior trade-offs and provide explicit justification or reconciliation before advancing to new topics.`;
      } else {
        inquiry = `Accountability Gate: Unfulfilled strategic commitments exist without recorded justification. Dialectic is locked to L1: reconcile and verify prior commitments before advancing.`;
      }
    } else {
      switch (level) {
        case "L1_TRADE_OFF_VERIFICATION": {
          const priorResolution = this.memory.getLatestResolutionForTopic(topic);
          const invariantNote = priorResolution
            ? ` Prior settled invariant: "${priorResolution.settledInvariant}" (${priorResolution.winningApproach}).`
            : "";
          inquiry = `Level 1 Trade-off Verification: How does the proposal on "${topic}" verify historical trade-offs, preserve settled invariants, and ensure zero regressions against existing commitments?${invariantNote}`;
          break;
        }
        case "L2_SECOND_ORDER_IMPLICATIONS": {
          inquiry = `Level 2 Second-Order Implications: What are the systemic second-order effects, cross-module blast radiuses, cognitive maintenance burdens, and failure modes introduced by this approach to "${topic}"?`;
          break;
        }
        case "L3_EMERGENT_PARADIGMS": {
          inquiry = `Level 3 Emergent Paradigms: How does this strategy on "${topic}" catalyze horizon innovation and emergent architectural capabilities without introducing speculative abstraction?`;
          break;
        }
      }
    }

    if (requiresCrucible) {
      inquiry += ` [IMPASSE DETECTED: Consecutive impasse cycles (${this.state.consecutiveImpasseCycles}) exceeded threshold of ${IMPASSE_CRUCIBLE_THRESHOLD}. Escalation to Empirical Crucible and Pre-Declared Pareto Arbitration is mandatory.]`;
    }

    if (context?.proposalDetails) {
      inquiry += ` (Context: ${context.proposalDetails})`;
    }

    const exchange: DebateExchange = {
      id: `ex-${cycleId}-${Date.now()}`,
      cycleId,
      level,
      inquiry,
      ...(unfulfilledCommitmentId !== undefined ? { unfulfilledCommitmentId } : {}),
      requiresCrucible,
      createdAt: new Date().toISOString(),
    };

    const newHistory = [...this.state.history, exchange];
    this.state = {
      ...this.state,
      currentLevel: level,
      activeExchange: exchange,
      history: newHistory,
    };

    return exchange;
  }

  public submitResponse(
    cycleId: string,
    responseText: string,
    evaluation: SocraticEvaluationResult,
  ): SocraticLadderingState {
    const currentExchange = this.state.activeExchange;
    const now = new Date().toISOString();

    const updatedExchange: DebateExchange = {
      id: currentExchange ? currentExchange.id : `ex-${cycleId}-${Date.now()}`,
      cycleId,
      level: this.state.currentLevel,
      inquiry: currentExchange ? currentExchange.inquiry : "Direct dialectical response",
      response: responseText,
      ...(currentExchange?.unfulfilledCommitmentId !== undefined
        ? { unfulfilledCommitmentId: currentExchange.unfulfilledCommitmentId }
        : {}),
      requiresCrucible:
        !evaluation.isSatisfactory &&
        this.state.consecutiveImpasseCycles + 1 > IMPASSE_CRUCIBLE_THRESHOLD,
      createdAt: currentExchange ? currentExchange.createdAt : now,
    };

    // Replace the last exchange in history if matching id
    const historyCopy = [...this.state.history];
    const matchIndex = historyCopy.findIndex((e) => e.id === updatedExchange.id);
    if (matchIndex >= 0) {
      historyCopy[matchIndex] = updatedExchange;
    } else {
      historyCopy.push(updatedExchange);
    }

    if (!evaluation.isSatisfactory) {
      const consecutiveImpasseCycles = this.state.consecutiveImpasseCycles + 1;
      this.state = {
        ...this.state,
        consecutiveImpasseCycles,
        activeExchange: updatedExchange,
        history: historyCopy,
        consensusReached: false,
      };
      return this.getState();
    }

    // Response is satisfactory: reset impasse count
    const consecutiveImpasseCycles = 0;

    // Check if progression is still blocked by unfulfilled commitments without justification
    if (this.memory.hasUnfulfilledCommitmentsWithoutJustification()) {
      this.state = {
        ...this.state,
        currentLevel: DIALECTICAL_LEVELS.L1_TRADE_OFF_VERIFICATION,
        consecutiveImpasseCycles,
        activeExchange: updatedExchange,
        history: historyCopy,
        consensusReached: false,
      };
      return this.getState();
    }

    // Advance level: L1 -> L2 -> L3 -> Consensus
    let nextLevel: DialecticalLevel = this.state.currentLevel;
    let consensusReached = false;

    if (this.state.currentLevel === DIALECTICAL_LEVELS.L1_TRADE_OFF_VERIFICATION) {
      nextLevel = DIALECTICAL_LEVELS.L2_SECOND_ORDER_IMPLICATIONS;
    } else if (this.state.currentLevel === DIALECTICAL_LEVELS.L2_SECOND_ORDER_IMPLICATIONS) {
      nextLevel = DIALECTICAL_LEVELS.L3_EMERGENT_PARADIGMS;
    } else if (this.state.currentLevel === DIALECTICAL_LEVELS.L3_EMERGENT_PARADIGMS) {
      nextLevel = DIALECTICAL_LEVELS.L3_EMERGENT_PARADIGMS;
      consensusReached = evaluation.consensusReached ?? true;
    }

    this.state = {
      ...this.state,
      currentLevel: nextLevel,
      consecutiveImpasseCycles,
      activeExchange: updatedExchange,
      history: historyCopy,
      consensusReached,
    };

    return this.getState();
  }

  public recordConsensus(
    cycleId: string,
    topic: string,
    winningApproach: string,
    paretoPriorityLevel: ParetoPriorityLevel,
    settledInvariant: string,
    commitments: readonly StrategicCommitment[] = [],
  ): StrategicResolution {
    const resolution: StrategicResolution = {
      id: `res-${cycleId}-${Date.now()}`,
      cycleId,
      topic,
      consensusReached: true,
      winningApproach,
      paretoPriorityLevel,
      settledInvariant,
      commitments: [...commitments],
      recordedAt: new Date().toISOString(),
    };

    this.memory.recordResolution(resolution);

    this.state = {
      currentLevel: DIALECTICAL_LEVELS.L1_TRADE_OFF_VERIFICATION,
      consecutiveImpasseCycles: 0,
      activeExchange: undefined,
      history: this.state.history,
      consensusReached: true,
    };

    return resolution;
  }

  public escalateToCrucible(cycleId: string, reason: string): DebateExchange {
    const exchange: DebateExchange = {
      id: `crucible-${cycleId}-${Date.now()}`,
      cycleId,
      level: this.state.currentLevel,
      inquiry: `CRUCIBLE ESCALATION: Impasse requires Empirical Crucible execution. Reason: ${reason}`,
      requiresCrucible: true,
      createdAt: new Date().toISOString(),
    };

    this.state = {
      ...this.state,
      consecutiveImpasseCycles: Math.max(
        this.state.consecutiveImpasseCycles,
        IMPASSE_CRUCIBLE_THRESHOLD + 1,
      ),
      activeExchange: exchange,
      history: [...this.state.history, exchange],
    };

    return exchange;
  }

  public resetForNewTopic(
    initialLevel: DialecticalLevel = DIALECTICAL_LEVELS.L1_TRADE_OFF_VERIFICATION,
  ): void {
    this.state = {
      currentLevel: initialLevel,
      consecutiveImpasseCycles: 0,
      activeExchange: undefined,
      history: this.state.history,
      consensusReached: false,
    };
  }

  public arbitratePareto(
    approachA: ParetoApproachInput,
    approachB: ParetoApproachInput,
  ): ParetoComparisonResult {
    const perfA = approachA.perfGainPercent ?? 0;
    const perfB = approachB.perfGainPercent ?? 0;
    const perfDiff = perfA - perfB;

    const compA = approachA.cognitiveComplexityScore ?? 0;
    const compB = approachB.cognitiveComplexityScore ?? 0;
    const complexityDiff = compA - compB;

    const metrics: ParetoComparisonMetrics = {
      perfGainDiffPercent: perfDiff,
      complexityDiff,
      ...(approachA.hasErrors !== approachB.hasErrors
        ? { correctnessWinner: approachA.hasErrors ? approachB.name : approachA.name }
        : {}),
    };

    // 1. Correctness & Error Gate (Priority 1: UX Delight & Correctness)
    if (approachA.hasErrors && !approachB.hasErrors) {
      return {
        winner: approachB.name,
        winningLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_CORRECTNESS,
        loser: approachA.name,
        losingLevel: approachA.satisfiesPriority,
        rationale: `"${approachB.name}" wins via Priority 1 (UX Delight & Correctness): "${approachA.name}" contains runtime or structural errors.`,
        deltaMetrics: metrics,
      };
    }

    if (approachB.hasErrors && !approachA.hasErrors) {
      return {
        winner: approachA.name,
        winningLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_CORRECTNESS,
        loser: approachB.name,
        losingLevel: approachB.satisfiesPriority,
        rationale: `"${approachA.name}" wins via Priority 1 (UX Delight & Correctness): "${approachB.name}" contains runtime or structural errors.`,
        deltaMetrics: metrics,
      };
    }

    // 2. Resolve Effective Priority Levels with 15% Scalability Gate & Simplicity Baseline
    // Priority 3 requires >= 15% performance gain. Marginal gains <15% fail scalability and fall to Speculative Abstraction (Priority 4).
    const effectivePriorityA: ParetoPriorityLevel =
      approachA.satisfiesPriority === PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT &&
      perfA < SCALABILITY_THRESHOLD_PERCENT
        ? PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION
        : approachA.satisfiesPriority;

    const effectivePriorityB: ParetoPriorityLevel =
      approachB.satisfiesPriority === PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT &&
      perfB < SCALABILITY_THRESHOLD_PERCENT
        ? PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION
        : approachB.satisfiesPriority;

    // 3. Absolute Simplicity Baseline: Marginal performance gains (<15%) unconditionally lose to Simplicity & Maintainability
    if (
      effectivePriorityA === PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY &&
      approachB.satisfiesPriority === PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT &&
      perfB < SCALABILITY_THRESHOLD_PERCENT
    ) {
      return {
        winner: approachA.name,
        winningLevel: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
        loser: approachB.name,
        losingLevel: effectivePriorityB,
        rationale: `"${approachA.name}" (Priority 2: Simplicity & Maintainability) unconditionally defeats "${approachB.name}" because the claimed gain (${perfB}%) falls below the ${SCALABILITY_THRESHOLD_PERCENT}% scalability threshold. Marginal gains lose unconditionally to simplicity.`,
        deltaMetrics: metrics,
      };
    }

    if (
      effectivePriorityB === PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY &&
      approachA.satisfiesPriority === PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT &&
      perfA < SCALABILITY_THRESHOLD_PERCENT
    ) {
      return {
        winner: approachB.name,
        winningLevel: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
        loser: approachA.name,
        losingLevel: effectivePriorityA,
        rationale: `"${approachB.name}" (Priority 2: Simplicity & Maintainability) unconditionally defeats "${approachA.name}" because the claimed gain (${perfA}%) falls below the ${SCALABILITY_THRESHOLD_PERCENT}% scalability threshold. Marginal gains lose unconditionally to simplicity.`,
        deltaMetrics: metrics,
      };
    }

    // 4. Compare Hierarchy Levels (Priority 1 > Priority 2 > Priority 3 > Priority 4)
    if (effectivePriorityA < effectivePriorityB) {
      return {
        winner: approachA.name,
        winningLevel: effectivePriorityA,
        loser: approachB.name,
        losingLevel: effectivePriorityB,
        rationale: `"${approachA.name}" (${describePriority(effectivePriorityA)}) supersedes "${approachB.name}" (${describePriority(effectivePriorityB)}) according to Pre-Declared Pareto Hierarchy.`,
        deltaMetrics: metrics,
      };
    }

    if (effectivePriorityB < effectivePriorityA) {
      return {
        winner: approachB.name,
        winningLevel: effectivePriorityB,
        loser: approachA.name,
        losingLevel: effectivePriorityA,
        rationale: `"${approachB.name}" (${describePriority(effectivePriorityB)}) supersedes "${approachA.name}" (${describePriority(effectivePriorityA)}) according to Pre-Declared Pareto Hierarchy.`,
        deltaMetrics: metrics,
      };
    }

    // 5. Intra-Level Tie Breaking (when effective priorities are equal)
    const level = effectivePriorityA;

    if (level === PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_CORRECTNESS) {
      if (compA !== compB) {
        const winner = compA < compB ? approachA : approachB;
        const loser = compA < compB ? approachB : approachA;
        return {
          winner: winner.name,
          winningLevel: level,
          loser: loser.name,
          losingLevel: level,
          rationale: `"${winner.name}" wins intra-level tie-break in Priority 1 via lower cognitive complexity (${Math.min(compA, compB)} vs ${Math.max(compA, compB)}).`,
          deltaMetrics: metrics,
        };
      }
      if (perfA !== perfB) {
        const winner = perfA > perfB ? approachA : approachB;
        const loser = perfA > perfB ? approachB : approachA;
        return {
          winner: winner.name,
          winningLevel: level,
          loser: loser.name,
          losingLevel: level,
          rationale: `"${winner.name}" wins intra-level tie-break in Priority 1 via higher performance gain (${Math.max(perfA, perfB)}% vs ${Math.min(perfA, perfB)}%).`,
          deltaMetrics: metrics,
        };
      }
      return {
        winner: approachA.name,
        winningLevel: level,
        loser: approachB.name,
        losingLevel: level,
        rationale: `"${approachA.name}" selected over "${approachB.name}" under equivalent Priority 1 metrics.`,
        deltaMetrics: metrics,
      };
    }

    if (level === PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY) {
      if (compA !== compB) {
        const winner = compA < compB ? approachA : approachB;
        const loser = compA < compB ? approachB : approachA;
        return {
          winner: winner.name,
          winningLevel: level,
          loser: loser.name,
          losingLevel: level,
          rationale: `"${winner.name}" wins Priority 2 (Simplicity & Maintainability) with lower cognitive complexity score (${Math.min(compA, compB)} vs ${Math.max(compA, compB)}).`,
          deltaMetrics: metrics,
        };
      }
      if (perfA !== perfB) {
        const winner = perfA > perfB ? approachA : approachB;
        const loser = perfA > perfB ? approachB : approachA;
        return {
          winner: winner.name,
          winningLevel: level,
          loser: loser.name,
          losingLevel: level,
          rationale: `"${winner.name}" wins Priority 2 tie-break with superior performance gain (${Math.max(perfA, perfB)}% vs ${Math.min(perfA, perfB)}%).`,
          deltaMetrics: metrics,
        };
      }
      return {
        winner: approachA.name,
        winningLevel: level,
        loser: approachB.name,
        losingLevel: level,
        rationale: `"${approachA.name}" selected over "${approachB.name}" under equivalent Priority 2 simplicity metrics.`,
        deltaMetrics: metrics,
      };
    }

    if (level === PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT) {
      if (perfA !== perfB) {
        const winner = perfA > perfB ? approachA : approachB;
        const loser = perfA > perfB ? approachB : approachA;
        return {
          winner: winner.name,
          winningLevel: level,
          loser: loser.name,
          losingLevel: level,
          rationale: `"${winner.name}" wins Priority 3 (Scalability >= 15%) with higher throughput gain (${Math.max(perfA, perfB)}% vs ${Math.min(perfA, perfB)}%).`,
          deltaMetrics: metrics,
        };
      }
      if (compA !== compB) {
        const winner = compA < compB ? approachA : approachB;
        const loser = compA < compB ? approachB : approachA;
        return {
          winner: winner.name,
          winningLevel: level,
          loser: loser.name,
          losingLevel: level,
          rationale: `"${winner.name}" wins Priority 3 tie-break with lower cognitive complexity (${Math.min(compA, compB)} vs ${Math.max(compA, compB)}).`,
          deltaMetrics: metrics,
        };
      }
      return {
        winner: approachA.name,
        winningLevel: level,
        loser: approachB.name,
        losingLevel: level,
        rationale: `"${approachA.name}" selected over "${approachB.name}" under equivalent Priority 3 scalability metrics.`,
        deltaMetrics: metrics,
      };
    }

    // Level 4: Speculative Abstraction
    if (compA !== compB) {
      const winner = compA < compB ? approachA : approachB;
      const loser = compA < compB ? approachB : approachA;
      return {
        winner: winner.name,
        winningLevel: level,
        loser: loser.name,
        losingLevel: level,
        rationale: `"${winner.name}" wins Priority 4 comparison by imposing lower cognitive/architectural complexity (${Math.min(compA, compB)} vs ${Math.max(compA, compB)}).`,
        deltaMetrics: metrics,
      };
    }
    if (perfA !== perfB) {
      const winner = perfA > perfB ? approachA : approachB;
      const loser = perfA > perfB ? approachB : approachA;
      return {
        winner: winner.name,
        winningLevel: level,
        loser: loser.name,
        losingLevel: level,
        rationale: `"${winner.name}" wins Priority 4 comparison with higher performance gain (${Math.max(perfA, perfB)}% vs ${Math.min(perfA, perfB)}%).`,
        deltaMetrics: metrics,
      };
    }
    return {
      winner: approachA.name,
      winningLevel: level,
      loser: approachB.name,
      losingLevel: level,
      rationale: `"${approachA.name}" selected over "${approachB.name}" under equivalent Priority 4 metrics.`,
      deltaMetrics: metrics,
    };
  }
}

function describePriority(level: ParetoPriorityLevel): string {
  switch (level) {
    case 1:
      return "Priority 1: UX Delight & Correctness";
    case 2:
      return "Priority 2: Simplicity & Maintainability";
    case 3:
      return "Priority 3: Scalability >= 15%";
    case 4:
      return "Priority 4: Speculative Abstraction";
  }
}
