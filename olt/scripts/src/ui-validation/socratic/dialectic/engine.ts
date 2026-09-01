import { HarnessError } from "../../../core/errors/index.ts";
import {
  MANDATORY_CHALLENGE_QUOTA_R1_R4,
  MAX_CONVERGENCE_CYCLES_PER_GATE,
  MIN_SUBSTANTIVE_DEFENSE_LENGTH,
  SOCRATIC_ROUNDS,
  SOCRATIC_ROUND_MAP,
  type SocraticRoundNumber,
  type SocraticRoundId,
  type SocraticRoundDefinition,
  type CognitiveChallengeSeverity,
  type CognitiveChallengeStatus,
  type DefenseRecord,
  type CognitiveChallenge,
  type CreateChallengeInput,
  type DefenseSubmission,
  type DefenseEvaluationResult,
  type RoundGateEvaluation,
  type RoundAdvanceResult,
  type SocraticSessionSummary,
  type DialecticSessionOptions,
  type CompetingForce,
  type CandidateResolution,
  type ParetoArbitrationInput,
  type ParetoArbitrationDecision,
  type InterRoundAuditResult,
} from "./types.ts";
import { evaluateSubstantiveDefense } from "./defense-evaluator.ts";
import { InterRoundRegressionAuditor } from "./regression-auditor.ts";
import { ParetoArbitrationEngine } from "./pareto-arbitration.ts";
import { raiseChallenge, submitDefense, escalateToParetoArbitration } from "./dialectic-cycle.ts";
import { evaluateRoundReadiness, auditInterRoundState, advanceRound } from "./round-flow.ts";
import {
  MilestoneLockEngine,
  getDefaultMilestoneLockEngine,
  computeSha256,
} from "../locks/index.ts";

export class SocraticDialecticEngine {
  private sessionId: string = "socratic-session-001";
  private currentRoundNumber: SocraticRoundNumber = 1;
  private readonly challenges: Map<string, CognitiveChallenge> = new Map();
  private readonly arbitrationHistory: Map<string, ParetoArbitrationDecision> = new Map();
  private readonly milestoneEngine: MilestoneLockEngine;
  private readonly regressionAuditor = new InterRoundRegressionAuditor();
  private readonly arbitrationEngine = new ParetoArbitrationEngine();
  private isSessionComplete = false;

  public constructor(options?: DialecticSessionOptions) {
    if (options?.sessionId) {
      this.sessionId = options.sessionId;
    }
    if (options?.initialRound) {
      this.currentRoundNumber = options.initialRound;
    }
    this.milestoneEngine = options?.milestoneEngine ?? new MilestoneLockEngine(this.sessionId);
    this.regressionAuditor = new InterRoundRegressionAuditor();
    this.arbitrationEngine = new ParetoArbitrationEngine();
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public setSessionId(sessionId: string): void {
    if (!sessionId || sessionId.trim().length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "Session ID cannot be empty");
    }
    this.sessionId = sessionId;
    this.milestoneEngine.setSessionId(sessionId);
  }

  public getCurrentRoundNumber(): SocraticRoundNumber {
    return this.currentRoundNumber;
  }

  public getCurrentRound(): SocraticRoundDefinition {
    return SOCRATIC_ROUND_MAP[this.currentRoundNumber];
  }

  public getMilestoneEngine(): MilestoneLockEngine {
    return this.milestoneEngine;
  }

  public getRegressionAuditor(): InterRoundRegressionAuditor {
    return this.regressionAuditor;
  }

  public getArbitrationEngine(): ParetoArbitrationEngine {
    return this.arbitrationEngine;
  }

  public isComplete(): boolean {
    return this.isSessionComplete;
  }

  /**
   * Starts a new Socratic dialectic session
   */
  public startSession(options?: DialecticSessionOptions): void {
    this.reset();
    if (options?.sessionId) {
      this.sessionId = options.sessionId;
      this.milestoneEngine.setSessionId(options.sessionId);
    }
    if (options?.initialRound) {
      this.currentRoundNumber = options.initialRound;
    }
  }

  /**
   * Raises a new Cognitive Challenge in the current or specified round
   */

  public raiseChallenge(input: CreateChallengeInput): CognitiveChallenge {
    return raiseChallenge.call(this, input);
  }

  public submitDefense(submission: DefenseSubmission): DefenseRecord {
    return submitDefense.call(this, submission);
  }

  public escalateToParetoArbitration(input: ParetoArbitrationInput): ParetoArbitrationDecision {
    return escalateToParetoArbitration.call(this, input);
  }

  public evaluateRoundReadiness(targetRound?: SocraticRoundNumber): RoundGateEvaluation {
    return evaluateRoundReadiness.call(this, targetRound);
  }

  public auditInterRoundState(currentStatePayload: Record<string, unknown>): InterRoundAuditResult {
    return auditInterRoundState.call(this, currentStatePayload);
  }

  public advanceRound(options?: {
    statePayload?: Record<string, unknown>;
    skipRegressionAudit?: boolean;
  }): RoundAdvanceResult {
    return advanceRound.call(this, options);
  }

  public getChallenge(challengeId: string): CognitiveChallenge | undefined {
    return this.challenges.get(challengeId);
  }

  /**
   * Lists challenges filtered by round or status
   */
  public listChallenges(options?: {
    roundNumber?: number;
    status?: CognitiveChallengeStatus;
  }): readonly CognitiveChallenge[] {
    let result = Array.from(this.challenges.values());
    if (options?.roundNumber !== undefined) {
      result = result.filter((c) => c.roundNumber === options.roundNumber);
    }
    if (options?.status !== undefined) {
      result = result.filter((c) => c.status === options.status);
    }
    return result;
  }

  /**
   * Summarizes the entire Socratic Dialectic session
   */
  public getSessionSummary(): SocraticSessionSummary {
    const challengesList = Array.from(this.challenges.values());
    const defendedList = challengesList.filter((c) => c.status === "DEFENDED");
    const gateEvaluations = SOCRATIC_ROUNDS.map((r) => this.evaluateRoundReadiness(r.roundNumber));

    return {
      sessionId: this.sessionId,
      currentRound: this.currentRoundNumber,
      isComplete: this.isSessionComplete,
      totalChallenges: challengesList.length,
      defendedChallenges: defendedList.length,
      arbitratedDecisionsCount: this.arbitrationHistory.size,
      sealedMilestonesCount: this.milestoneEngine.listManifests().length,
      gateEvaluations,
    };
  }

  /**
   * Resets session to initial state
   */
  public reset(): void {
    this.currentRoundNumber = 1;
    this.challenges.clear();
    this.arbitrationHistory.clear();
    this.milestoneEngine.reset();
    this.isSessionComplete = false;
  }
}

/**
 * ============================================================================
 * 10. Engine Singletons and Factory Functions
 * ============================================================================
 */

let defaultSocraticDialecticEngine: SocraticDialecticEngine | null = null;

export function getDefaultSocraticDialecticEngine(): SocraticDialecticEngine {
  if (!defaultSocraticDialecticEngine) {
    defaultSocraticDialecticEngine = new SocraticDialecticEngine();
  }
  return defaultSocraticDialecticEngine;
}

export function setDefaultSocraticDialecticEngine(engine: SocraticDialecticEngine): void {
  defaultSocraticDialecticEngine = engine;
}

export function resetDefaultSocraticDialecticEngine(): void {
  if (defaultSocraticDialecticEngine) {
    defaultSocraticDialecticEngine.reset();
  }
  defaultSocraticDialecticEngine = null;
}
