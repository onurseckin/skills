/**
 * Pre-Declared Pareto Decision Hierarchy & Arbitration Engine
 *
 * Implements the non-negotiable multi-dimensional decision hierarchy:
 * - Priority 1: User Experience Delight & Functional Correctness (UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS)
 *     Non-negotiable baseline. Candidates with functional errors, broken contracts,
 *     or UX degradation fail immediately and are disqualified.
 * - Priority 2: Cognitive Simplicity & Architectural Maintainability (COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY)
 *     Unconditionally defeats marginal performance gains (<15% throughput/latency delta).
 *     Prefers lower cognitive complexity, minimal blast radius, and clean maintenance.
 * - Priority 3: Measurable Performance Scalability & Resource Efficiency (MEASURABLE_PERFORMANCE_SCALABILITY)
 *     Takes precedence over simplicity only when empirical performance delta is >= 15%.
 * - Priority 4: Speculative Abstraction & Generality (SPECULATIVE_ABSTRACTION)
 *     Lowest priority, unconditionally rejected. Premature abstractions and unneeded generality
 *     lose against any valid baseline.
 */

export const PARETO_PRIORITY_LEVELS = {
  UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS: 1,
  UX_DELIGHT_AND_CORRECTNESS: 1,
  COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY: 2,
  SIMPLICITY_AND_MAINTAINABILITY: 2,
  MEASURABLE_PERFORMANCE_SCALABILITY: 3,
  SCALABILITY_GEQ_15_PERCENT: 3,
  SPECULATIVE_ABSTRACTION: 4,
} as const;

export type ParetoPriorityLevel = 1 | 2 | 3 | 4;

export const PARETO_PRIORITY_NAMES: Readonly<Record<ParetoPriorityLevel, string>> = {
  1: "UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS",
  2: "COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY",
  3: "MEASURABLE_PERFORMANCE_SCALABILITY",
  4: "SPECULATIVE_ABSTRACTION",
} as const;

export const PARETO_LEVEL_NAMES: Readonly<Record<ParetoPriorityLevel, string>> = {
  1: "Priority 1: UX Delight & Functional Correctness",
  2: "Priority 2: Cognitive Simplicity & Architectural Maintainability",
  3: "Priority 3: Measurable Performance Scalability (>= 15%)",
  4: "Priority 4: Speculative Abstraction & Generality (Rejected)",
} as const;

export const SCALABILITY_THRESHOLD_PERCENT = 15;
export const PARETO_DEBATE_CYCLE_THRESHOLD = 2;

export interface ParetoApproachCandidate {
  readonly id?: string | undefined;
  readonly name: string;
  readonly description?: string | undefined;
  /** Claimed or intended priority level (1..4) */
  readonly claimedPriorityLevel?: ParetoPriorityLevel | undefined;
  /** Alias for claimedPriorityLevel to support socratic engine compatibility */
  readonly satisfiesPriority?: ParetoPriorityLevel | undefined;

  // Priority 1: Functional Correctness & UX Metrics
  readonly hasErrors?: boolean | undefined;
  readonly functionalErrors?: readonly string[] | undefined;
  readonly uxDegradation?: boolean | undefined;
  readonly functionalCorrectnessScore?: number | undefined; // 0.0 to 1.0 (1.0 = flawless)

  // Priority 2: Cognitive Simplicity & Maintainability Metrics
  readonly cognitiveComplexityScore?: number | undefined; // Lower is simpler/better
  readonly linesOfCodeDelta?: number | undefined;
  readonly architecturalBlastRadius?: number | undefined; // 1 (contained) to 10 (pervasive)
  readonly implementationEffortScore?: number | undefined;

  // Priority 3: Measurable Performance Scalability Metrics
  readonly perfGainPercent?: number | undefined; // General performance improvement %
  readonly throughputGainPercent?: number | undefined; // Throughput delta %
  readonly latencyReductionPercent?: number | undefined; // Latency improvement %
  readonly memoryReductionPercent?: number | undefined; // Memory efficiency delta %
  readonly empiricalValueScore?: number | undefined;

  // Priority 4: Speculative Abstraction Indicators
  readonly isSpeculativeAbstraction?: boolean | undefined;
  readonly unusedGeneralityScore?: number | undefined; // 0 to 10

  // Optional arbitrary metadata for domain-specific context
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export type ParetoCandidate = ParetoApproachCandidate;

export interface ParetoArbitrationOptions {
  /** Scalability threshold required for Priority 3 precedence (default: 15) */
  readonly scalabilityThresholdPercent?: number | undefined;
  /** Minimum acceptable functional correctness score (default: 1.0) */
  readonly strictCorrectnessThreshold?: number | undefined;
  /** Maximum acceptable cognitive complexity score before penalty */
  readonly maxAcceptableComplexity?: number | undefined;
  /** Allow fallback to speculative abstraction if no other candidates exist (default: false) */
  readonly allowSpeculativeFallback?: boolean | undefined;
  readonly topic?: string | undefined;
  readonly debateCycles?: number | undefined;
  readonly strictThreshold?: boolean | undefined;
}

export interface DisqualifiedCandidate {
  readonly candidateName: string;
  readonly candidateId?: string | undefined;
  readonly reason: string;
  readonly failedPriorityLevel: ParetoPriorityLevel;
}

export interface ParetoComparisonMetrics {
  readonly perfGainDiffPercent?: number | undefined;
  readonly throughputGainDiffPercent?: number | undefined;
  readonly latencyReductionDiffPercent?: number | undefined;
  readonly complexityDiff?: number | undefined;
  readonly valueToComplexityRatioA?: number | undefined;
  readonly valueToComplexityRatioB?: number | undefined;
  readonly correctnessWinner?: string | undefined;
  readonly marginDelta?: number | undefined;
}

export interface ParetoComparisonResult {
  readonly winner: string;
  readonly winningCandidate?: ParetoApproachCandidate | undefined;
  readonly winningLevel: ParetoPriorityLevel;
  readonly loser: string;
  readonly losingCandidate?: ParetoApproachCandidate | undefined;
  readonly losingLevel: ParetoPriorityLevel;
  readonly rationale: string;
  readonly reason?: string | undefined;
  readonly deltaMetrics?: ParetoComparisonMetrics | undefined;
}

export interface RankedParetoCandidate {
  readonly candidate: ParetoApproachCandidate;
  readonly rank: number;
  readonly effectivePriority: ParetoPriorityLevel;
  readonly efficiencyScore: number;
  readonly isDominantOnFrontier?: boolean | undefined;
}

export interface ParetoArbitrationResult {
  readonly winner: string;
  readonly winningCandidate?: ParetoApproachCandidate | undefined;
  readonly chosenPriorityLevel: ParetoPriorityLevel;
  readonly winningLevel: ParetoPriorityLevel; // Alias for chosenPriorityLevel
  readonly loser?: string | undefined;
  readonly losingCandidate?: ParetoApproachCandidate | undefined;
  readonly losingLevel?: ParetoPriorityLevel | undefined;
  readonly reason: string;
  readonly rationale: string; // Alias for reason
  readonly deltaMetrics?: ParetoComparisonMetrics | undefined;
  readonly metrics?: ParetoComparisonMetrics | undefined; // Alias for deltaMetrics
  readonly marginDelta?: number | undefined;
  readonly disqualifiedCandidates: readonly DisqualifiedCandidate[];
  readonly candidateRankings?: readonly string[] | undefined;
  readonly rankedCandidates?: readonly RankedParetoCandidate[] | undefined;
  readonly paretoFrontier?: readonly ParetoApproachCandidate[] | undefined;
  readonly topic?: string | undefined;
  readonly debateCycles?: number | undefined;
  readonly forcedByThreshold?: boolean | undefined;
  readonly timestamp: string;
  readonly arbitratedAt?: string | undefined; // Alias for timestamp
}

/**
 * Returns human-readable label for a Pareto priority level.
 */
export function describePriorityLevel(level: ParetoPriorityLevel): string {
  switch (level) {
    case 1:
      return "Priority 1: UX Delight & Functional Correctness";
    case 2:
      return "Priority 2: Cognitive Simplicity & Architectural Maintainability";
    case 3:
      return "Priority 3: Measurable Performance Scalability (>= 15%)";
    case 4:
      return "Priority 4: Speculative Abstraction & Generality (Rejected)";
  }
}

/**
 * Extracts the effective performance gain of a candidate approach in percent.
 */
export function extractPerformanceGain(candidate: ParetoApproachCandidate): number {
  if (candidate.perfGainPercent !== undefined) {
    return candidate.perfGainPercent;
  }
  if (candidate.throughputGainPercent !== undefined) {
    return candidate.throughputGainPercent;
  }
  if (candidate.latencyReductionPercent !== undefined) {
    return candidate.latencyReductionPercent;
  }
  return 0;
}

/**
 * Checks whether a candidate violates Priority 1 (User Experience Delight & Functional Correctness).
 * Returns the disqualification reason if violated, or undefined if candidate passes.
 */
export function checkPriority1Violation(
  candidate: ParetoApproachCandidate,
  options?: ParetoArbitrationOptions,
): string | undefined {
  if (candidate.hasErrors) {
    return `Candidate "${candidate.name}" has runtime or structural errors.`;
  }

  if (candidate.functionalErrors && candidate.functionalErrors.length > 0) {
    return `Candidate "${candidate.name}" has ${candidate.functionalErrors.length} functional error(s): ${candidate.functionalErrors.join("; ")}`;
  }

  if (candidate.uxDegradation) {
    return `Candidate "${candidate.name}" introduces user experience degradation.`;
  }

  const minCorrectness = options?.strictCorrectnessThreshold ?? 1.0;
  if (
    candidate.functionalCorrectnessScore !== undefined &&
    candidate.functionalCorrectnessScore < minCorrectness
  ) {
    return `Candidate "${candidate.name}" correctness score (${candidate.functionalCorrectnessScore}) is below required baseline (${minCorrectness}).`;
  }

  return undefined;
}

/**
 * Resolves the effective Pareto Priority Level of a candidate.
 * If a candidate claims Priority 3 but provides <15% performance gain over baseline/0,
 * it is downgraded to Priority 4 (speculative abstraction) because marginal gains
 * fail the scalability threshold and unconditionally lose to simplicity.
 */
export function resolveEffectivePriorityLevel(
  candidate: ParetoApproachCandidate,
  options?: ParetoArbitrationOptions,
): ParetoPriorityLevel {
  const threshold = options?.scalabilityThresholdPercent ?? SCALABILITY_THRESHOLD_PERCENT;
  const claimed =
    candidate.claimedPriorityLevel ??
    candidate.satisfiesPriority ??
    (candidate.isSpeculativeAbstraction ? 4 : 2);

  if (candidate.isSpeculativeAbstraction) {
    return PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION;
  }

  if (claimed === PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY) {
    const perfGain = extractPerformanceGain(candidate);
    if (perfGain < threshold) {
      // Marginal gain (<15%) fails Priority 3 threshold
      return PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION;
    }
    return PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY;
  }

  return claimed;
}

/**
 * Alias for resolveEffectivePriorityLevel to support legacy / socratic callers.
 */
export const resolveEffectiveParetoPriority = resolveEffectivePriorityLevel;

/**
 * Returns the precedence rank of a Pareto priority level.
 * Lower rank means higher precedence in arbitration.
 * Rank 1: Priority 1 (UX Delight & Functional Correctness)
 * Rank 2: Priority 3 (Measurable Performance Scalability >= 15%)
 * Rank 3: Priority 2 (Cognitive Simplicity & Architectural Maintainability)
 * Rank 4: Priority 4 (Speculative Abstraction / Demoted Marginal Gains)
 */
export function getPriorityPrecedenceRank(level: ParetoPriorityLevel): number {
  switch (level) {
    case 1:
      return 1;
    case 3:
      return 2;
    case 2:
      return 3;
    case 4:
      return 4;
  }
}

/**
 * Calculates the value-to-complexity efficiency score for a Pareto candidate.
 * Higher is better. Emphasizes 80% empirical value with 20% implementation complexity.
 */
export function computeParetoEfficiencyScore(candidate: ParetoApproachCandidate): number {
  if (candidate.hasErrors || candidate.uxDegradation) {
    return 0;
  }

  const basePriorityWeight: Record<ParetoPriorityLevel, number> = {
    1: 100,
    3: 85,
    2: 70,
    4: 10,
  };

  const perfGain = extractPerformanceGain(candidate);
  const effectivePriority = resolveEffectivePriorityLevel(candidate);

  const priorityScore = basePriorityWeight[effectivePriority];
  const empiricalValue = candidate.empiricalValueScore ?? 80;
  const complexity = Math.max(
    1,
    candidate.cognitiveComplexityScore ?? candidate.implementationEffortScore ?? 20,
  );

  const valueToComplexityRatio = (empiricalValue / complexity) * 10;
  const perfBonus = Math.min(30, perfGain >= SCALABILITY_THRESHOLD_PERCENT ? perfGain : 0);

  return Math.round((priorityScore + valueToComplexityRatio + perfBonus) * 100) / 100;
}

/**
 * Arbitrates between two candidate approaches using the Pre-Declared Pareto Decision Hierarchy.
 */
export function arbitrateParetoApproaches(
  candidateA: ParetoApproachCandidate,
  candidateB: ParetoApproachCandidate,
  options?: ParetoArbitrationOptions,
): ParetoArbitrationResult {
  const threshold = options?.scalabilityThresholdPercent ?? SCALABILITY_THRESHOLD_PERCENT;
  const now = new Date().toISOString();
  const disqualified: DisqualifiedCandidate[] = [];

  // 1. Evaluate Priority 1: UX Delight & Functional Correctness (Non-negotiable baseline)
  const p1ViolationA = checkPriority1Violation(candidateA, options);
  const p1ViolationB = checkPriority1Violation(candidateB, options);

  if (p1ViolationA) {
    disqualified.push({
      candidateName: candidateA.name,
      ...(candidateA.id !== undefined ? { candidateId: candidateA.id } : {}),
      reason: p1ViolationA,
      failedPriorityLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
    });
  }

  if (p1ViolationB) {
    disqualified.push({
      candidateName: candidateB.name,
      ...(candidateB.id !== undefined ? { candidateId: candidateB.id } : {}),
      reason: p1ViolationB,
      failedPriorityLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
    });
  }

  if (p1ViolationA && !p1ViolationB) {
    const effLevelB = resolveEffectivePriorityLevel(candidateB, options);
    const reason = `"${candidateB.name}" (${describePriorityLevel(effLevelB)}) wins via Priority 1 baseline: "${candidateA.name}" is disqualified (${p1ViolationA}).`;
    return {
      winner: candidateB.name,
      winningCandidate: candidateB,
      chosenPriorityLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
      winningLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
      loser: candidateA.name,
      losingCandidate: candidateA,
      losingLevel: candidateA.claimedPriorityLevel ?? candidateA.satisfiesPriority ?? 4,
      reason,
      rationale: reason,
      deltaMetrics: {
        correctnessWinner: candidateB.name,
      },
      metrics: {
        correctnessWinner: candidateB.name,
      },
      marginDelta: 0,
      disqualifiedCandidates: disqualified,
      candidateRankings: [candidateB.name],
      timestamp: now,
      arbitratedAt: now,
    };
  }

  if (p1ViolationB && !p1ViolationA) {
    const effLevelA = resolveEffectivePriorityLevel(candidateA, options);
    const reason = `"${candidateA.name}" (${describePriorityLevel(effLevelA)}) wins via Priority 1 baseline: "${candidateB.name}" is disqualified (${p1ViolationB}).`;
    return {
      winner: candidateA.name,
      winningCandidate: candidateA,
      chosenPriorityLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
      winningLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
      loser: candidateB.name,
      losingCandidate: candidateB,
      losingLevel: candidateB.claimedPriorityLevel ?? candidateB.satisfiesPriority ?? 4,
      reason,
      rationale: reason,
      deltaMetrics: {
        correctnessWinner: candidateA.name,
      },
      metrics: {
        correctnessWinner: candidateA.name,
      },
      marginDelta: 0,
      disqualifiedCandidates: disqualified,
      candidateRankings: [candidateA.name],
      timestamp: now,
      arbitratedAt: now,
    };
  }

  if (p1ViolationA && p1ViolationB) {
    const reason = `Both candidates failed Priority 1 baseline (UX Delight & Functional Correctness). Neither can be selected.`;
    return {
      winner: "NONE",
      chosenPriorityLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
      winningLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
      reason,
      rationale: reason,
      deltaMetrics: {
        correctnessWinner: "NONE",
      },
      metrics: {
        correctnessWinner: "NONE",
      },
      marginDelta: 0,
      disqualifiedCandidates: disqualified,
      candidateRankings: [],
      timestamp: now,
      arbitratedAt: now,
    };
  }

  // 2. Metrics Computation
  const perfA = extractPerformanceGain(candidateA);
  const perfB = extractPerformanceGain(candidateB);
  const perfDiff = perfA - perfB;

  const compA = candidateA.cognitiveComplexityScore ?? 0;
  const compB = candidateB.cognitiveComplexityScore ?? 0;
  const compDiff = compA - compB;

  const scoreA = computeParetoEfficiencyScore(candidateA);
  const scoreB = computeParetoEfficiencyScore(candidateB);

  const deltaMetrics: ParetoComparisonMetrics = {
    perfGainDiffPercent: perfDiff,
    throughputGainDiffPercent:
      candidateA.throughputGainPercent !== undefined ||
      candidateB.throughputGainPercent !== undefined
        ? (candidateA.throughputGainPercent ?? 0) - (candidateB.throughputGainPercent ?? 0)
        : undefined,
    latencyReductionDiffPercent:
      candidateA.latencyReductionPercent !== undefined ||
      candidateB.latencyReductionPercent !== undefined
        ? (candidateA.latencyReductionPercent ?? 0) - (candidateB.latencyReductionPercent ?? 0)
        : undefined,
    complexityDiff: compDiff,
    valueToComplexityRatioA: scoreA,
    valueToComplexityRatioB: scoreB,
    marginDelta: Math.abs(perfDiff),
  };

  // 3. Resolve Effective Priority Levels with 15% Scalability Gate
  const effLevelA = resolveEffectivePriorityLevel(candidateA, options);
  const effLevelB = resolveEffectivePriorityLevel(candidateB, options);

  // 4. Priority Precedence Comparison:
  // Hierarchy Precedence Rank:
  // Rank 1: Priority 1 (UX Delight & Functional Correctness)
  // Rank 2: Priority 3 (Measurable Performance Scalability >= 15%)
  // Rank 3: Priority 2 (Cognitive Simplicity & Architectural Maintainability)
  // Rank 4: Priority 4 (Speculative Abstraction & Marginal Gains < 15%)
  const rankA = getPriorityPrecedenceRank(effLevelA);
  const rankB = getPriorityPrecedenceRank(effLevelB);

  // Marginal gain (<15%) rule explicit explanation
  if (
    effLevelA === PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY &&
    candidateB.claimedPriorityLevel === PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY &&
    perfDiff > -threshold
  ) {
    const reason = `"${candidateA.name}" (Priority 2: Cognitive Simplicity & Maintainability) unconditionally defeats "${candidateB.name}" because the performance gain delta (${perfB - perfA}%) is below the ${threshold}% scalability threshold. Marginal gains lose unconditionally to simplicity.`;
    return {
      winner: candidateA.name,
      winningCandidate: candidateA,
      chosenPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
      winningLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
      loser: candidateB.name,
      losingCandidate: candidateB,
      losingLevel: effLevelB,
      reason,
      rationale: reason,
      deltaMetrics,
      metrics: deltaMetrics,
      marginDelta: Math.abs(perfDiff),
      disqualifiedCandidates: disqualified,
      candidateRankings: [candidateA.name, candidateB.name],
      timestamp: now,
      arbitratedAt: now,
    };
  }

  if (
    effLevelB === PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY &&
    candidateA.claimedPriorityLevel === PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY &&
    perfDiff < threshold
  ) {
    const reason = `"${candidateB.name}" (Priority 2: Cognitive Simplicity & Maintainability) unconditionally defeats "${candidateA.name}" because the performance gain delta (${perfDiff}%) is below the ${threshold}% scalability threshold. Marginal gains lose unconditionally to simplicity.`;
    return {
      winner: candidateB.name,
      winningCandidate: candidateB,
      chosenPriorityLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
      winningLevel: PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY,
      loser: candidateA.name,
      losingCandidate: candidateA,
      losingLevel: effLevelA,
      reason,
      rationale: reason,
      deltaMetrics,
      metrics: deltaMetrics,
      marginDelta: Math.abs(perfDiff),
      disqualifiedCandidates: disqualified,
      candidateRankings: [candidateB.name, candidateA.name],
      timestamp: now,
      arbitratedAt: now,
    };
  }

  // Precedence rank comparison (Lower numerical rank = Higher precedence)
  if (rankA < rankB) {
    const reason = `"${candidateA.name}" (${describePriorityLevel(effLevelA)}) supersedes "${candidateB.name}" (${describePriorityLevel(effLevelB)}) according to Pre-Declared Pareto Hierarchy.`;
    return {
      winner: candidateA.name,
      winningCandidate: candidateA,
      chosenPriorityLevel: effLevelA,
      winningLevel: effLevelA,
      loser: candidateB.name,
      losingCandidate: candidateB,
      losingLevel: effLevelB,
      reason,
      rationale: reason,
      deltaMetrics,
      metrics: deltaMetrics,
      marginDelta: Math.abs(perfDiff),
      disqualifiedCandidates: disqualified,
      candidateRankings: [candidateA.name, candidateB.name],
      timestamp: now,
      arbitratedAt: now,
    };
  }

  if (rankB < rankA) {
    const reason = `"${candidateB.name}" (${describePriorityLevel(effLevelB)}) supersedes "${candidateA.name}" (${describePriorityLevel(effLevelA)}) according to Pre-Declared Pareto Hierarchy.`;
    return {
      winner: candidateB.name,
      winningCandidate: candidateB,
      chosenPriorityLevel: effLevelB,
      winningLevel: effLevelB,
      loser: candidateA.name,
      losingCandidate: candidateA,
      losingLevel: effLevelA,
      reason,
      rationale: reason,
      deltaMetrics,
      metrics: deltaMetrics,
      marginDelta: Math.abs(perfDiff),
      disqualifiedCandidates: disqualified,
      candidateRankings: [candidateB.name, candidateA.name],
      timestamp: now,
      arbitratedAt: now,
    };
  }

  // 6. Intra-Level Tie Breaking (when both candidates share the same effective priority level)
  const sharedLevel = effLevelA;

  if (sharedLevel === PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS) {
    if (compA !== compB) {
      const winner = compA < compB ? candidateA : candidateB;
      const loser = compA < compB ? candidateB : candidateA;
      const reason = `"${winner.name}" wins Priority 1 tie-break with lower cognitive complexity (${Math.min(compA, compB)} vs ${Math.max(compA, compB)}).`;
      return {
        winner: winner.name,
        winningCandidate: winner,
        chosenPriorityLevel: sharedLevel,
        winningLevel: sharedLevel,
        loser: loser.name,
        losingCandidate: loser,
        losingLevel: sharedLevel,
        reason,
        rationale: reason,
        deltaMetrics,
        metrics: deltaMetrics,
        marginDelta: Math.abs(perfDiff),
        disqualifiedCandidates: disqualified,
        candidateRankings: [winner.name, loser.name],
        timestamp: now,
        arbitratedAt: now,
      };
    }
    if (perfA !== perfB) {
      const winner = perfA > perfB ? candidateA : candidateB;
      const loser = perfA > perfB ? candidateB : candidateA;
      const reason = `"${winner.name}" wins Priority 1 tie-break with higher performance gain (${Math.max(perfA, perfB)}% vs ${Math.min(perfA, perfB)}%).`;
      return {
        winner: winner.name,
        winningCandidate: winner,
        chosenPriorityLevel: sharedLevel,
        winningLevel: sharedLevel,
        loser: loser.name,
        losingCandidate: loser,
        losingLevel: sharedLevel,
        reason,
        rationale: reason,
        deltaMetrics,
        metrics: deltaMetrics,
        marginDelta: Math.abs(perfDiff),
        disqualifiedCandidates: disqualified,
        candidateRankings: [winner.name, loser.name],
        timestamp: now,
        arbitratedAt: now,
      };
    }
    const reason = `"${candidateA.name}" selected over "${candidateB.name}" under equivalent Priority 1 metrics.`;
    return {
      winner: candidateA.name,
      winningCandidate: candidateA,
      chosenPriorityLevel: sharedLevel,
      winningLevel: sharedLevel,
      loser: candidateB.name,
      losingCandidate: candidateB,
      losingLevel: sharedLevel,
      reason,
      rationale: reason,
      deltaMetrics,
      metrics: deltaMetrics,
      marginDelta: 0,
      disqualifiedCandidates: disqualified,
      candidateRankings: [candidateA.name, candidateB.name],
      timestamp: now,
      arbitratedAt: now,
    };
  }

  if (sharedLevel === PARETO_PRIORITY_LEVELS.COGNITIVE_SIMPLICITY_AND_MAINTAINABILITY) {
    if (compA !== compB) {
      const winner = compA < compB ? candidateA : candidateB;
      const loser = compA < compB ? candidateB : candidateA;
      const reason = `"${winner.name}" wins Priority 2 (Simplicity & Maintainability) with lower cognitive complexity score (${Math.min(compA, compB)} vs ${Math.max(compA, compB)}).`;
      return {
        winner: winner.name,
        winningCandidate: winner,
        chosenPriorityLevel: sharedLevel,
        winningLevel: sharedLevel,
        loser: loser.name,
        losingCandidate: loser,
        losingLevel: sharedLevel,
        reason,
        rationale: reason,
        deltaMetrics,
        metrics: deltaMetrics,
        marginDelta: Math.abs(perfDiff),
        disqualifiedCandidates: disqualified,
        candidateRankings: [winner.name, loser.name],
        timestamp: now,
        arbitratedAt: now,
      };
    }
    if (perfA !== perfB) {
      const winner = perfA > perfB ? candidateA : candidateB;
      const loser = perfA > perfB ? candidateB : candidateA;
      const reason = `"${winner.name}" wins Priority 2 tie-break with superior performance gain (${Math.max(perfA, perfB)}% vs ${Math.min(perfA, perfB)}%).`;
      return {
        winner: winner.name,
        winningCandidate: winner,
        chosenPriorityLevel: sharedLevel,
        winningLevel: sharedLevel,
        loser: loser.name,
        losingCandidate: loser,
        losingLevel: sharedLevel,
        reason,
        rationale: reason,
        deltaMetrics,
        metrics: deltaMetrics,
        marginDelta: Math.abs(perfDiff),
        disqualifiedCandidates: disqualified,
        candidateRankings: [winner.name, loser.name],
        timestamp: now,
        arbitratedAt: now,
      };
    }
    const reason = `"${candidateA.name}" selected over "${candidateB.name}" under equivalent Priority 2 simplicity metrics.`;
    return {
      winner: candidateA.name,
      winningCandidate: candidateA,
      chosenPriorityLevel: sharedLevel,
      winningLevel: sharedLevel,
      loser: candidateB.name,
      losingCandidate: candidateB,
      losingLevel: sharedLevel,
      reason,
      rationale: reason,
      deltaMetrics,
      metrics: deltaMetrics,
      marginDelta: 0,
      disqualifiedCandidates: disqualified,
      candidateRankings: [candidateA.name, candidateB.name],
      timestamp: now,
      arbitratedAt: now,
    };
  }

  if (sharedLevel === PARETO_PRIORITY_LEVELS.MEASURABLE_PERFORMANCE_SCALABILITY) {
    if (perfA !== perfB) {
      const winner = perfA > perfB ? candidateA : candidateB;
      const loser = perfA > perfB ? candidateB : candidateA;
      const reason = `"${winner.name}" wins Priority 3 (Scalability >= ${threshold}%) with higher throughput gain (${Math.max(perfA, perfB)}% vs ${Math.min(perfA, perfB)}%, delta: +${Math.abs(perfDiff)}%).`;
      return {
        winner: winner.name,
        winningCandidate: winner,
        chosenPriorityLevel: sharedLevel,
        winningLevel: sharedLevel,
        loser: loser.name,
        losingCandidate: loser,
        losingLevel: sharedLevel,
        reason,
        rationale: reason,
        deltaMetrics,
        metrics: deltaMetrics,
        marginDelta: Math.abs(perfDiff),
        disqualifiedCandidates: disqualified,
        candidateRankings: [winner.name, loser.name],
        timestamp: now,
        arbitratedAt: now,
      };
    }
    if (compA !== compB) {
      const winner = compA < compB ? candidateA : candidateB;
      const loser = compA < compB ? candidateB : candidateA;
      const reason = `"${winner.name}" wins Priority 3 tie-break with lower cognitive complexity (${Math.min(compA, compB)} vs ${Math.max(compA, compB)}).`;
      return {
        winner: winner.name,
        winningCandidate: winner,
        chosenPriorityLevel: sharedLevel,
        winningLevel: sharedLevel,
        loser: loser.name,
        losingCandidate: loser,
        losingLevel: sharedLevel,
        reason,
        rationale: reason,
        deltaMetrics,
        metrics: deltaMetrics,
        marginDelta: Math.abs(perfDiff),
        disqualifiedCandidates: disqualified,
        candidateRankings: [winner.name, loser.name],
        timestamp: now,
        arbitratedAt: now,
      };
    }
    const reason = `"${candidateA.name}" selected over "${candidateB.name}" under equivalent Priority 3 scalability metrics.`;
    return {
      winner: candidateA.name,
      winningCandidate: candidateA,
      chosenPriorityLevel: sharedLevel,
      winningLevel: sharedLevel,
      loser: candidateB.name,
      losingCandidate: candidateB,
      losingLevel: sharedLevel,
      reason,
      rationale: reason,
      deltaMetrics,
      metrics: deltaMetrics,
      marginDelta: 0,
      disqualifiedCandidates: disqualified,
      candidateRankings: [candidateA.name, candidateB.name],
      timestamp: now,
      arbitratedAt: now,
    };
  }

  // Level 4: Speculative Abstraction (Lowest Priority / Rejected)
  if (compA !== compB) {
    const winner = compA < compB ? candidateA : candidateB;
    const loser = compA < compB ? candidateB : candidateA;
    const reason = `"${winner.name}" selected over "${loser.name}" among Priority 4 candidates due to lower cognitive complexity (${Math.min(compA, compB)} vs ${Math.max(compA, compB)}). Note: Speculative abstractions remain disfavored.`;
    return {
      winner: winner.name,
      winningCandidate: winner,
      chosenPriorityLevel: sharedLevel,
      winningLevel: sharedLevel,
      loser: loser.name,
      losingCandidate: loser,
      losingLevel: sharedLevel,
      reason,
      rationale: reason,
      deltaMetrics,
      metrics: deltaMetrics,
      marginDelta: Math.abs(perfDiff),
      disqualifiedCandidates: disqualified,
      candidateRankings: [winner.name, loser.name],
      timestamp: now,
      arbitratedAt: now,
    };
  }

  const reason = `"${candidateA.name}" selected over "${candidateB.name}" under equivalent Priority 4 metrics.`;
  return {
    winner: candidateA.name,
    winningCandidate: candidateA,
    chosenPriorityLevel: sharedLevel,
    winningLevel: sharedLevel,
    loser: candidateB.name,
    losingCandidate: candidateB,
    losingLevel: sharedLevel,
    reason,
    rationale: reason,
    deltaMetrics,
    metrics: deltaMetrics,
    marginDelta: 0,
    disqualifiedCandidates: disqualified,
    candidateRankings: [candidateA.name, candidateB.name],
    timestamp: now,
    arbitratedAt: now,
  };
}

/**
 * Alias for arbitrateParetoApproaches for backwards-compatible pair evaluation.
 */
export function arbitrateParetoPair(
  approachA: ParetoApproachCandidate,
  approachB: ParetoApproachCandidate,
): ParetoComparisonResult {
  const res = arbitrateParetoApproaches(approachA, approachB);
  return {
    winner: res.winner,
    ...(res.winningCandidate !== undefined ? { winningCandidate: res.winningCandidate } : {}),
    winningLevel: res.winningLevel,
    loser: res.loser ?? approachB.name,
    ...(res.losingCandidate !== undefined ? { losingCandidate: res.losingCandidate } : {}),
    losingLevel: res.losingLevel ?? 4,
    rationale: res.rationale,
    reason: res.reason,
    ...(res.deltaMetrics !== undefined ? { deltaMetrics: res.deltaMetrics } : {}),
  };
}

/**
 * Filters candidates to find those on the non-dominated Pareto frontier.
 */
export function filterParetoFrontier(
  candidates: readonly ParetoApproachCandidate[],
): readonly ParetoApproachCandidate[] {
  if (candidates.length <= 1) {
    return [...candidates];
  }

  const validCandidates = candidates.filter((c) => !c.hasErrors && !c.uxDegradation);
  if (validCandidates.length === 0) {
    return candidates[0] ? [candidates[0]] : [];
  }

  const frontier: ParetoApproachCandidate[] = [];

  for (const candidate of validCandidates) {
    const effPriority = resolveEffectivePriorityLevel(candidate);
    const score = computeParetoEfficiencyScore(candidate);

    const isDominated = validCandidates.some((other) => {
      if (other === candidate) return false;
      const otherEffPriority = resolveEffectivePriorityLevel(other);
      const otherScore = computeParetoEfficiencyScore(other);

      return (
        (otherEffPriority < effPriority && otherScore >= score) ||
        (otherEffPriority === effPriority && otherScore > score)
      );
    });

    if (!isDominated) {
      frontier.push(candidate);
    }
  }

  return frontier.length > 0 ? frontier : [validCandidates[0]!];
}

/**
 * Arbitrates among multiple candidate technical approaches using lexicographical Pareto evaluation.
 */
export function arbitrateMultipleApproaches(
  candidates: readonly ParetoApproachCandidate[],
  baseline?: ParetoApproachCandidate | undefined,
  options?: ParetoArbitrationOptions,
): ParetoArbitrationResult {
  const now = new Date().toISOString();
  const disqualified: DisqualifiedCandidate[] = [];

  if (candidates.length === 0) {
    const reason = "No candidates provided for Pareto arbitration.";
    return {
      winner: "NONE",
      chosenPriorityLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
      winningLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
      reason,
      rationale: reason,
      disqualifiedCandidates: [],
      candidateRankings: [],
      timestamp: now,
      arbitratedAt: now,
    };
  }

  // Filter out candidates violating Priority 1
  const qualified: ParetoApproachCandidate[] = [];
  for (const candidate of candidates) {
    const violation = checkPriority1Violation(candidate, options);
    if (violation) {
      disqualified.push({
        candidateName: candidate.name,
        ...(candidate.id !== undefined ? { candidateId: candidate.id } : {}),
        reason: violation,
        failedPriorityLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
      });
    } else {
      qualified.push(candidate);
    }
  }

  if (qualified.length === 0) {
    const reason = `All ${candidates.length} candidates were disqualified due to Priority 1 violations (functional errors, test failures, or UX degradation).`;
    return {
      winner: "NONE",
      chosenPriorityLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
      winningLevel: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS,
      reason,
      rationale: reason,
      disqualifiedCandidates: disqualified,
      candidateRankings: [],
      timestamp: now,
      arbitratedAt: now,
    };
  }

  const frontier = filterParetoFrontier(qualified);

  if (qualified.length === 1) {
    const lone = qualified[0];
    if (!lone) {
      throw new Error("Unexpected empty qualified list");
    }
    const effLevel = resolveEffectivePriorityLevel(lone, options);
    const score = computeParetoEfficiencyScore(lone);
    const reason = `"${lone.name}" is the only candidate passing Priority 1 baseline (UX Delight & Functional Correctness).`;
    return {
      winner: lone.name,
      winningCandidate: lone,
      chosenPriorityLevel: effLevel,
      winningLevel: effLevel,
      reason,
      rationale: reason,
      disqualifiedCandidates: disqualified,
      candidateRankings: [lone.name],
      rankedCandidates: [
        {
          candidate: lone,
          rank: 1,
          effectivePriority: effLevel,
          efficiencyScore: score,
          isDominantOnFrontier: true,
        },
      ],
      paretoFrontier: [lone],
      timestamp: now,
      arbitratedAt: now,
    };
  }

  // Sort qualified candidates using pairwise Pareto comparison
  const sorted = [...qualified].sort((a, b) => {
    const result = arbitrateParetoApproaches(a, b, options);
    return result.winner === a.name ? -1 : 1;
  });

  const best = sorted[0];
  const runnerUp = sorted[1];
  if (!best) {
    throw new Error("Sorting failed to produce a winning candidate");
  }

  const bestLevel = resolveEffectivePriorityLevel(best, options);
  const baselineComparison = baseline ?? runnerUp;

  let deltaMetrics: ParetoComparisonMetrics | undefined = undefined;
  if (baselineComparison) {
    const perfBest = extractPerformanceGain(best);
    const perfBase = extractPerformanceGain(baselineComparison);
    const compBest = best.cognitiveComplexityScore ?? 0;
    const compBase = baselineComparison.cognitiveComplexityScore ?? 0;
    const scoreBest = computeParetoEfficiencyScore(best);
    const scoreBase = computeParetoEfficiencyScore(baselineComparison);

    deltaMetrics = {
      perfGainDiffPercent: perfBest - perfBase,
      complexityDiff: compBest - compBase,
      valueToComplexityRatioA: scoreBest,
      valueToComplexityRatioB: scoreBase,
      marginDelta: Math.abs(perfBest - perfBase),
    };
  }

  const rankings = sorted.map((c) => c.name);
  const rankedCandidates: RankedParetoCandidate[] = sorted.map((c, index) => ({
    candidate: c,
    rank: index + 1,
    effectivePriority: resolveEffectivePriorityLevel(c, options),
    efficiencyScore: computeParetoEfficiencyScore(c),
    isDominantOnFrontier: frontier.some((fc) => fc.name === c.name),
  }));

  const runnerUpText = runnerUp ? ` (runner-up: "${runnerUp.name}")` : "";
  const reason = `"${best.name}" selected as optimal Pareto resolution (${describePriorityLevel(bestLevel)})${runnerUpText} out of ${candidates.length} evaluated candidate(s).`;

  const debateCycles = options?.debateCycles ?? 0;
  const forcedByThreshold =
    debateCycles > (options?.strictThreshold ? 0 : PARETO_DEBATE_CYCLE_THRESHOLD);

  return {
    winner: best.name,
    winningCandidate: best,
    chosenPriorityLevel: bestLevel,
    winningLevel: bestLevel,
    ...(runnerUp !== undefined ? { loser: runnerUp.name } : {}),
    ...(runnerUp !== undefined ? { losingCandidate: runnerUp } : {}),
    ...(runnerUp !== undefined
      ? { losingLevel: resolveEffectivePriorityLevel(runnerUp, options) }
      : {}),
    reason,
    rationale: reason,
    ...(deltaMetrics !== undefined ? { deltaMetrics, metrics: deltaMetrics } : {}),
    ...(deltaMetrics?.marginDelta !== undefined ? { marginDelta: deltaMetrics.marginDelta } : {}),
    disqualifiedCandidates: disqualified,
    candidateRankings: rankings,
    rankedCandidates,
    paretoFrontier: frontier,
    ...(options?.topic !== undefined ? { topic: options.topic } : {}),
    ...(options?.debateCycles !== undefined ? { debateCycles: options.debateCycles } : {}),
    ...(forcedByThreshold ? { forcedByThreshold: true } : {}),
    timestamp: now,
    arbitratedAt: now,
  };
}

/**
 * Alias for arbitrateMultipleApproaches.
 */
export const arbitrateParetoCandidates = arbitrateMultipleApproaches;

/**
 * Enforces pre-declared Pareto arbitration when debate deadlock occurs past cycle threshold.
 */
export function enforcePreDeclaredParetoArbitration(
  debateTopic: string,
  debateCycles: number,
  candidates: readonly ParetoApproachCandidate[],
): ParetoArbitrationResult {
  return arbitrateMultipleApproaches(candidates, undefined, {
    topic: debateTopic,
    debateCycles,
    strictThreshold: true,
  });
}
