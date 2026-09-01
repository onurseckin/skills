import { HarnessError } from "../../../core/errors/index.ts";
import { computeSha256 } from "../locks/index.ts";
import {
  MAX_CONVERGENCE_CYCLES_PER_GATE,
  SOCRATIC_ROUND_MAP,
  type SocraticRoundNumber,
  type CognitiveChallenge,
  type CreateChallengeInput,
  type DefenseSubmission,
  type DefenseRecord,
  type ParetoArbitrationInput,
  type ParetoArbitrationDecision,
} from "./types.ts";
import { evaluateSubstantiveDefense } from "./defense-evaluator.ts";

export function raiseChallenge(this: any, input: CreateChallengeInput): CognitiveChallenge {
  const roundNumber = input.roundNumber ?? this.currentRoundNumber;
  if (roundNumber < 1 || roundNumber > 5) {
    throw new HarnessError("INVALID_ARGUMENT", `Invalid round number ${roundNumber}`);
  }

  if (!input.thesis || input.thesis.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "Cognitive challenge thesis cannot be empty");
  }

  if (!input.category || input.category.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "Cognitive challenge category cannot be empty");
  }

  const challengeId = `cog-chall-${roundNumber}-${computeSha256({ thesis: input.thesis, time: Date.now(), rand: Math.random() }).slice(0, 10)}`;
  const challenge: CognitiveChallenge = {
    challengeId,
    roundNumber,
    category: input.category,
    thesis: input.thesis,
    severity: input.severity ?? "HIGH",
    status: "PENDING",
    cyclesUsed: 0,
    createdAt: new Date().toISOString(),
  };

  this.challenges.set(challengeId, challenge);
  return challenge;
}

/**
 * Submits an adversarial defense for a cognitive challenge
 */
export function submitDefense(this: any, submission: DefenseSubmission): DefenseRecord {
  const challenge = this.challenges.get(submission.challengeId);
  if (!challenge) {
    throw new HarnessError(
      "NOT_FOUND",
      `Cognitive challenge '${submission.challengeId}' not found.`,
    );
  }

  if (challenge.status === "DEFENDED") {
    throw new HarnessError(
      "INVALID_STATE",
      `Cognitive challenge '${submission.challengeId}' has already been defended and resolved.`,
    );
  }

  // Increment dialectic cycle count
  challenge.cyclesUsed += 1;

  const evalResult = evaluateSubstantiveDefense(submission);
  const submittedAt = new Date().toISOString();
  const defenseId = `def-${computeSha256({ challengeId: challenge.challengeId, cycles: challenge.cyclesUsed, submittedAt }).slice(0, 10)}`;

  const defenseRecord: DefenseRecord = {
    defenseId,
    challengeId: challenge.challengeId,
    rationale: submission.rationale,
    evidenceReferences: submission.evidenceReferences ?? [],
    ...(submission.architecturalTradeoff !== undefined
      ? { architecturalTradeoff: submission.architecturalTradeoff }
      : {}),
    isAccepted: evalResult.isAccepted,
    evaluatedScore: evalResult.score,
    evaluationFeedback: evalResult.feedback,
    submittedAt,
  };

  challenge.defenseRecord = defenseRecord;

  if (evalResult.isAccepted) {
    challenge.status = "DEFENDED";
    challenge.resolvedAt = submittedAt;
  } else {
    if (challenge.cyclesUsed >= MAX_CONVERGENCE_CYCLES_PER_GATE) {
      challenge.status = "ESCALATED";
    } else {
      challenge.status = "REJECTED";
    }
  }

  return defenseRecord;
}

/**
 * Escalates a deadlocked challenge to Pareto Arbitration
 */
export function escalateToParetoArbitration(
  this: any,
  input: ParetoArbitrationInput,
): ParetoArbitrationDecision {
  const challenge = this.challenges.get(input.challengeId);
  if (!challenge) {
    throw new HarnessError(
      "NOT_FOUND",
      `Cannot escalate: challenge '${input.challengeId}' not found.`,
    );
  }

  const decision = this.arbitrationEngine.arbitrate(challenge, input);

  // Record binding arbitration
  this.arbitrationHistory.set(decision.arbitrationId, decision);

  // Update challenge to DEFENDED with arbitration defense record
  challenge.status = "DEFENDED";
  challenge.resolvedAt = decision.arbitratedAt;
  challenge.defenseRecord = {
    defenseId: `def-arb-${decision.arbitrationId}`,
    challengeId: challenge.challengeId,
    rationale: `Resolved via binding Pareto Arbitration [${decision.arbitrationId}]: ${decision.winningResolutionDescription}`,
    evidenceReferences: decision.bindingDirectives,
    architecturalTradeoff: "Arbitrated Pareto-optimal compromise.",
    isAccepted: true,
    evaluatedScore: decision.arbitratedScore,
    evaluationFeedback: `Binding arbitration applied. Directives: ${decision.bindingDirectives.join(" ")}`,
    submittedAt: decision.arbitratedAt,
  };

  return decision;
}

/**
 * Evaluates if the gate for a specific round is unlocked and ready to advance
 */
