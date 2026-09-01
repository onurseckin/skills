import {
  MIN_SUBSTANTIVE_DEFENSE_LENGTH,
  TRIVIAL_DEFENSE_PATTERNS,
  type DefenseRecord,
  type DefenseSubmission,
  type DefenseEvaluationResult,
  type CollateralDefect,
} from "./types.ts";

export function evaluateSubstantiveDefense(submission: DefenseSubmission): DefenseEvaluationResult {
  const reasons: string[] = [];
  const trimmedRationale = submission.rationale?.trim() ?? "";

  // 1. Minimum character length check
  if (trimmedRationale.length < MIN_SUBSTANTIVE_DEFENSE_LENGTH) {
    reasons.push(
      `Rationale is too brief (${trimmedRationale.length} chars). Substantive defenses require at least ${MIN_SUBSTANTIVE_DEFENSE_LENGTH} characters of architectural justification.`,
    );
  }

  // 2. Trivial canned / boilerplate defense check
  for (const pattern of TRIVIAL_DEFENSE_PATTERNS) {
    if (pattern.test(trimmedRationale)) {
      reasons.push(
        `Rationale matched trivial boilerplate pattern "${pattern}". Substantive defenses must articulate specific UI/architectural reasoning.`,
      );
      break;
    }
  }

  // 3. Evidence references or architectural tradeoff explanation check
  const evidenceCount = submission.evidenceReferences?.length ?? 0;
  const hasTradeoff = !!submission.architecturalTradeoff && submission.architecturalTradeoff.trim().length >= 10;

  if (evidenceCount === 0 && !hasTradeoff) {
    reasons.push(
      "Defense must provide at least one concrete evidence reference (e.g. token ID, diff artifact, test result) OR a substantive architectural tradeoff explanation.",
    );
  }

  // Calculate score (0 - 100)
  let score = 0;
  if (reasons.length === 0) {
    score = 70; // Base passing score
    if (evidenceCount > 0) score += Math.min(15, evidenceCount * 5);
    if (hasTradeoff) score += 15;
    score = Math.min(100, score);
  } else {
    score = Math.max(0, 50 - reasons.length * 20);
  }

  const isAccepted = reasons.length === 0 && score >= 70;
  const feedback = isAccepted
    ? `Defense accepted with substantive score ${score}/100.`
    : `Defense rejected (${score}/100): ${reasons.join(" ")}`;

  return {
    isAccepted,
    score,
    feedback,
    reasons,
  };
}

/**
 * ============================================================================
 * 7. Inter-Round Regression Auditor
 * ============================================================================
 */
