import { HarnessError } from "../../../core/errors/index.ts";
import type { JsonValue } from "../../../core/contracts/json.ts";
import {
  MANDATORY_CHALLENGE_QUOTA_R1_R4,
  MAX_CONVERGENCE_CYCLES_PER_GATE,
  SOCRATIC_ROUND_MAP,
  type SocraticRoundNumber,
  type CognitiveChallenge,
  type RoundGateEvaluation,
  type RoundAdvanceResult,
  type InterRoundAuditResult,
} from "./types.ts";

export function evaluateRoundReadiness(
  this: any,
  targetRound?: SocraticRoundNumber,
): RoundGateEvaluation {
  const roundNumber: SocraticRoundNumber = (targetRound ?? this.currentRoundNumber) as SocraticRoundNumber;
  const roundDef = SOCRATIC_ROUND_MAP[roundNumber];

  const roundChallenges = Array.from(this.challenges.values()).filter(
    (c: any): c is CognitiveChallenge => c.roundNumber === roundNumber,
  );

  const defended = roundChallenges.filter((c: CognitiveChallenge) => c.status === "DEFENDED");
  const pending = roundChallenges.filter(
    (c: CognitiveChallenge) => c.status === "PENDING" || c.status === "REJECTED",
  );
  const escalated = roundChallenges.filter((c: CognitiveChallenge) => c.status === "ESCALATED");

    const quotaMet = defended.length >= roundDef.minChallengeQuota;
    const allChallengesResolved = pending.length === 0 && escalated.length === 0;

    const blockReasons: string[] = [];
    if (!quotaMet) {
      blockReasons.push(
        `Mandatory Challenge Quota Not Met for Round ${roundNumber} ("${roundDef.name}"): Requires at least ${roundDef.minChallengeQuota} defended challenges (currently ${defended.length}).`,
      );
    }

    if (pending.length > 0) {
      blockReasons.push(
        `Round ${roundNumber} has ${pending.length} unresolved/pending challenge(s) that must be defended or arbitrated.`,
      );
    }

    if (escalated.length > 0) {
      blockReasons.push(
        `Round ${roundNumber} has ${escalated.length} escalated challenge(s) requiring Pareto Arbitration before gate unlocking.`,
      );
    }

    const isGateUnlocked = quotaMet && allChallengesResolved;

    return {
      roundNumber,
      roundName: roundDef.name,
      isGateUnlocked,
      minChallengeQuota: roundDef.minChallengeQuota,
      totalChallengesRaised: roundChallenges.length,
      totalChallengesDefended: defended.length,
      pendingChallengesCount: pending.length,
      escalatedChallengesCount: escalated.length,
      quotaMet,
      allChallengesResolved,
      blockReasons,
    };
  }

  /**
   * Audits the current state payload against sealed upstream milestone manifests
   */
export function auditInterRoundState(
  this: any,
currentStatePayload: Record<string, unknown>): InterRoundAuditResult {
    const sealedManifests = this.milestoneEngine.listManifests();
    return this.regressionAuditor.auditStateRegressions(
      this.currentRoundNumber,
      currentStatePayload,
      sealedManifests,
    );
  }

  /**
   * Advances the dialectic gate to the next progressive round.
   * Enforces Monotonic Convergence Law, Challenge Quota, and Inter-Round Regression Audits.
   */
export function advanceRound(
  this: any,
options?: {
    statePayload?: Record<string, unknown>;
    skipRegressionAudit?: boolean;
  }): RoundAdvanceResult {
    if (this.isSessionComplete) {
      throw new HarnessError(
        "INVALID_STATE",
        "Cannot advance: Socratic Dialectic validation session has already completed all 5 rounds.",
      );
    }

    const currentRoundDef = this.getCurrentRound();
    const readiness = this.evaluateRoundReadiness(this.currentRoundNumber);

    if (!readiness.isGateUnlocked) {
      throw new HarnessError(
        "INVALID_STATE",
        `Cannot advance Round ${this.currentRoundNumber}: Gate is locked. Reasons: ${readiness.blockReasons.join("; ")}`,
        readiness.blockReasons,
      );
    }

    const statePayload = options?.statePayload ?? {
      round: this.currentRoundNumber,
      scopesValidated: currentRoundDef.targetScopes,
      defendedChallengesCount: readiness.totalChallengesDefended,
      validatedTimestamp: new Date().toISOString(),
    };

    // Perform inter-round visual regression audit against sealed milestones
    if (!options?.skipRegressionAudit && this.currentRoundNumber > 1) {
      const auditResult = this.auditInterRoundState(statePayload);
      if (auditResult.hasRegressions) {
        throw new HarnessError(
          "INTEGRITY",
          `Inter-round collateral visual regression detected during Round ${this.currentRoundNumber} advancement! Upstream sealed scopes were violated.`,
          auditResult.collateralDefects as unknown as readonly JsonValue[],
        );
      }
    }

    // Seal the current completed milestone in the MilestoneLockEngine
    const manifest = this.milestoneEngine.sealMilestone({
      sessionId: this.sessionId,
      roundNumber: this.currentRoundNumber,
      roundName: currentRoundDef.name,
      statePayload,
      challengeSummary: {
        total: readiness.totalChallengesRaised,
        defended: readiness.totalChallengesDefended,
        arbitrated: this.arbitrationHistory.size,
      },
    });

    const previousRound = this.currentRoundNumber;

    if (this.currentRoundNumber === 5) {
      // Completed final round
      this.isSessionComplete = true;
      return {
        previousRound,
        currentRound: 5,
        manifest,
        isFinalRoundCompleted: true,
        sessionCompleted: true,
      };
    }

    // Monotonic forward advance
    const nextRound = (this.currentRoundNumber + 1) as SocraticRoundNumber;
    this.currentRoundNumber = nextRound;

    return {
      previousRound,
      currentRound: nextRound,
      manifest,
      isFinalRoundCompleted: false,
      sessionCompleted: false,
    };
  }

  /**
   * Retrieves a challenge by ID
   */
