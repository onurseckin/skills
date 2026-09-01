import type { ImmutabilityManifest, MilestoneLockEngine } from "../locks/index.ts";
import type { SocraticRoundNumber } from "./types.ts";

export type CognitiveChallengeSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type CognitiveChallengeStatus = "PENDING" | "DEFENDED" | "REJECTED" | "ESCALATED";

export interface DefenseRecord {
  readonly defenseId: string;
  readonly challengeId: string;
  readonly rationale: string;
  readonly evidenceReferences: readonly string[];
  readonly architecturalTradeoff?: string;
  readonly isAccepted: boolean;
  readonly evaluatedScore: number;
  readonly evaluationFeedback?: string;
  readonly submittedAt: string;
}

export interface CognitiveChallenge {
  readonly challengeId: string;
  readonly roundNumber: SocraticRoundNumber;
  readonly category: string;
  readonly thesis: string;
  readonly severity: CognitiveChallengeSeverity;
  status: CognitiveChallengeStatus;
  defenseRecord?: DefenseRecord;
  cyclesUsed: number;
  readonly createdAt: string;
  resolvedAt?: string;
}

export interface CreateChallengeInput {
  readonly roundNumber?: SocraticRoundNumber;
  readonly category: string;
  readonly thesis: string;
  readonly severity?: CognitiveChallengeSeverity;
}

export interface DefenseSubmission {
  readonly challengeId: string;
  readonly rationale: string;
  readonly evidenceReferences?: readonly string[];
  readonly architecturalTradeoff?: string;
  readonly submittedBy?: string;
}

export interface DefenseEvaluationResult {
  readonly isAccepted: boolean;
  readonly score: number;
  readonly feedback: string;
  readonly reasons: readonly string[];
}

/**
 * ============================================================================
 * 3. Inter-Round Regression & Collateral Defect Data Structures
 * ============================================================================
 */

export interface CollateralDefect {
  readonly defectId: string;
  readonly upstreamRoundNumber: number;
  readonly upstreamScope: string;
  readonly currentRoundNumber: number;
  readonly propertyKey: string;
  readonly sealedValue: unknown;
  readonly currentValue: unknown;
  readonly severity: CognitiveChallengeSeverity;
  readonly description: string;
}

export interface InterRoundAuditResult {
  readonly hasRegressions: boolean;
  readonly collateralDefects: readonly CollateralDefect[];
  readonly regressionScore: number;
  readonly violatedMilestoneRounds: readonly number[];
  readonly auditedAt: string;
}

/**
 * ============================================================================
 * 4. Pareto Arbitration Escalation Structures
 * ============================================================================
 */

export interface CompetingForce {
  readonly force: string;
  readonly weight: number;
  readonly argument?: string;
}

export interface CandidateResolution {
  readonly id: string;
  readonly description: string;
  readonly score: number;
  readonly tradeoffs?: string;
}

export interface ParetoArbitrationInput {
  readonly challengeId: string;
  readonly competingForces: readonly CompetingForce[];
  readonly candidateResolutions: readonly CandidateResolution[];
  readonly arbitrationStrategy?: "WEIGHTED_SCORE" | "MAXIMIN" | "PARETO_OPTIMAL";
  readonly humanSupervisorOverride?: boolean;
}

export interface ParetoArbitrationDecision {
  readonly arbitrationId: string;
  readonly challengeId: string;
  readonly roundNumber: SocraticRoundNumber;
  readonly winningResolutionId: string;
  readonly winningResolutionDescription: string;
  readonly bindingDirectives: readonly string[];
  readonly arbitratedScore: number;
  readonly status: "BINDING_RESOLVED";
  readonly arbitratedAt: string;
}

/**
 * ============================================================================
 * 5. Gate Readiness & Session Evaluation Structures
 * ============================================================================
 */

export interface RoundGateEvaluation {
  readonly roundNumber: SocraticRoundNumber;
  readonly roundName: string;
  readonly isGateUnlocked: boolean;
  readonly minChallengeQuota: number;
  readonly totalChallengesRaised: number;
  readonly totalChallengesDefended: number;
  readonly pendingChallengesCount: number;
  readonly escalatedChallengesCount: number;
  readonly quotaMet: boolean;
  readonly allChallengesResolved: boolean;
  readonly blockReasons: readonly string[];
}

export interface RoundAdvanceResult {
  readonly previousRound: SocraticRoundNumber;
  readonly currentRound: SocraticRoundNumber;
  readonly manifest: ImmutabilityManifest;
  readonly isFinalRoundCompleted: boolean;
  readonly sessionCompleted: boolean;
}

export interface SocraticSessionSummary {
  readonly sessionId: string;
  readonly currentRound: SocraticRoundNumber;
  readonly isComplete: boolean;
  readonly totalChallenges: number;
  readonly defendedChallenges: number;
  readonly arbitratedDecisionsCount: number;
  readonly sealedMilestonesCount: number;
  readonly gateEvaluations: readonly RoundGateEvaluation[];
}

export interface DialecticSessionOptions {
  readonly sessionId?: string;
  readonly initialRound?: SocraticRoundNumber;
  readonly milestoneEngine?: MilestoneLockEngine;
}

/**
 * ============================================================================
 * 6. Substantive Defense Evaluation Engine
 * ============================================================================
 */

/**
 * Evaluates a defense submission against strict substantive criteria
 */
