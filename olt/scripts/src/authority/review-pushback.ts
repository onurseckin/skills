import { MAX_REPAIR_ROUNDS } from "../core/config/constants.ts";
import type { JsonObject } from "../core/contracts/index.ts";
import {
  isCoordinatorPushbackCause,
  isValidatorDomain,
  VALIDATOR_DOMAINS,
  type CoordinatorPushbackCause,
  type TaskStatus,
  type ValidatorDomain,
} from "../core/contracts/index.ts";
import { HarnessError } from "../core/errors/index.ts";

/**
 * Common superficial patterns and canned phrases that indicate rubber-stamping or lack of concrete verification.
 */
export const SUPERFICIAL_PATTERNS: readonly RegExp[] = [
  /^(lgtm|looks good|looks fine|looks ok|looks okay)\b/i,
  /^(all tests pass|tests pass|all passing|tests green)\b/i,
  /^(done|verified|approved|passed|complete|finished)\b/i,
  /^(everything works|works as expected|no issues found|no problems)\b/i,
  /^(passed without issues|all requirements met|looks good to me)\b/i,
  /^(checked and verified|verified manually|good to go)\b/i,
];

export interface SuperficialityDetectionResult {
  readonly isSuperficial: boolean;
  readonly matchedPatterns: readonly string[];
  readonly reason: string | null;
  readonly confidenceScore: number;
}

export interface DomainBatchingDetectionResult {
  readonly isBatched: boolean;
  readonly reasons: readonly string[];
  readonly domainsEvaluated: readonly ValidatorDomain[];
  readonly violatingDomains: readonly ValidatorDomain[];
}

export interface CounterfactualEvidenceEvaluation {
  readonly isSufficient: boolean;
  readonly hypothesisCount: number;
  readonly falsificationCheckCount: number;
  readonly details: string;
}

export type ScepticismViolationType =
  | "superficial_claim"
  | "domain_batching"
  | "missing_counterfactual_evidence"
  | "unsubstantiated_verdict"
  | "stagnant_repair"
  | "repetition_across_tasks"
  | "empty_rationale";

export interface ScepticismViolation {
  readonly type: ScepticismViolationType;
  readonly message: string;
  readonly domain?: ValidatorDomain | undefined;
  readonly taskId?: string | undefined;
  readonly details?: Readonly<Record<string, string | number | boolean>> | undefined;
}

export interface TaskVerificationCheckInput {
  readonly command?: string | undefined;
  readonly command_id?: string | undefined;
  readonly status?: string | undefined;
  readonly output?: string | undefined;
  readonly exit_code?: number | undefined;
}

export interface TaskVerificationEvidenceItem {
  readonly kind?: string | undefined;
  readonly description?: string | undefined;
  readonly diff?: string | undefined;
  readonly data?: string | undefined;
}

export interface CounterfactualEvidenceItem {
  readonly hypothesis?: string | undefined;
  readonly negativeCheck?: string | undefined;
  readonly falsified?: boolean | undefined;
  readonly observation?: string | undefined;
}

export interface TaskVerificationEvidenceInput {
  readonly taskId: string;
  readonly requirementIds?: readonly string[] | undefined;
  readonly filesChanged?: readonly string[] | undefined;
  readonly summary?: string | undefined;
  readonly checks?: readonly TaskVerificationCheckInput[] | undefined;
  readonly evidence?: readonly TaskVerificationEvidenceItem[] | undefined;
  readonly counterfactualEvidence?: readonly CounterfactualEvidenceItem[] | undefined;
  readonly notes?: string | undefined;
  readonly domainEvidence?: Readonly<Record<string, unknown>> | undefined;
}

export interface ScepticismAuditOptions {
  readonly maxAcceptableSuperficialityScore?: number | undefined;
  readonly requireCounterfactual?: boolean | undefined;
  readonly requiredDomains?: readonly ValidatorDomain[] | undefined;
  readonly previousSummary?: string | undefined;
  readonly previousFilesChanged?: readonly string[] | undefined;
}

export interface TaskVerificationAuditResult {
  readonly valid: boolean;
  readonly scepticismScore: number;
  readonly violations: readonly ScepticismViolation[];
  readonly rejectionReasons: readonly string[];
  readonly superficiality: SuperficialityDetectionResult;
  readonly domainBatching: DomainBatchingDetectionResult;
  readonly counterfactual: CounterfactualEvidenceEvaluation;
  readonly recommendedAction: "accept" | "pushback_procedural" | "pushback_substantive";
  readonly correctiveGuidance: readonly string[];
}

export interface PushbackRoundRecord {
  readonly round: number;
  readonly id: string;
  readonly timestamp: string;
  readonly coordinatorId: string;
  readonly validatorId: string;
  readonly domain: ValidatorDomain;
  readonly cause: CoordinatorPushbackCause;
  readonly observation: string;
  readonly remediation: string;
  readonly rejectionReasons: readonly string[];
  readonly previousEvidenceDigest?: string | undefined;
  readonly previousEvidenceSummary?: string | undefined;
  readonly correctiveGuidance: readonly string[];
  readonly statusAfter: TaskStatus;
}

export interface PushbackHistory {
  readonly taskId: string;
  readonly currentRound: number;
  readonly maxRepairRounds: number;
  readonly rounds: readonly PushbackRoundRecord[];
  readonly isExhausted: boolean;
  readonly lastCause?: CoordinatorPushbackCause | undefined;
  readonly unresolvedRejectionReasons: readonly string[];
}

export interface RepairProgressionEvaluation {
  readonly progressMade: boolean;
  readonly stagnant: boolean;
  readonly addressedReasons: readonly string[];
  readonly unaddressedReasons: readonly string[];
  readonly correctiveGuidance: readonly string[];
  readonly diffSummary?: string | undefined;
}

export interface ValidatedReviewPushback {
  readonly validatorId: string;
  readonly domain: ValidatorDomain;
  readonly cause: CoordinatorPushbackCause;
  readonly observation: string;
  readonly remediation: string;
  readonly guidance: readonly string[];
  readonly rejectionReasons: readonly string[];
  readonly maxRepairRounds: number;
}

/**
 * Evaluates whether a claim summary is superficial rubber-stamping.
 */
export function rejectSuperficialClaims(
  claimText: string,
  evidenceItems?: readonly unknown[] | undefined,
): SuperficialityDetectionResult {
  const trimmed = claimText.trim();
  if (trimmed.length === 0) {
    return {
      isSuperficial: true,
      matchedPatterns: ["empty_text"],
      reason: "Claim text is empty or whitespace only.",
      confidenceScore: 1.0,
    };
  }

  const matched: string[] = [];
  for (const pattern of SUPERFICIAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      matched.push(pattern.source);
    }
  }

  const hasSubstantialEvidence = Array.isArray(evidenceItems) && evidenceItems.length > 0;
  const isShortVaguePhrase = trimmed.length < 25 && matched.length > 0;
  const isSuperficial = matched.length > 0 && (!hasSubstantialEvidence || isShortVaguePhrase);

  let reason: string | null = null;
  if (isSuperficial) {
    reason = `Claim '${trimmed}' matches superficial pattern without substantive task-specific proof.`;
  }

  const confidenceScore = isSuperficial ? (isShortVaguePhrase ? 0.95 : 0.75) : 0.0;

  return {
    isSuperficial,
    matchedPatterns: matched,
    reason,
    confidenceScore,
  };
}

/**
 * Detects domain batching where multiple validation domains or tasks are bundled without discriminating evidence.
 */
export function detectDomainBatching(
  domains: readonly ValidatorDomain[],
  domainEvidenceMap: Readonly<Record<string, unknown>> = {},
): DomainBatchingDetectionResult {
  if (domains.length <= 1) {
    return {
      isBatched: false,
      reasons: [],
      domainsEvaluated: domains,
      violatingDomains: [],
    };
  }

  const reasons: string[] = [];
  const violatingDomains: ValidatorDomain[] = [];
  const evidenceFingerprints = new Map<string, ValidatorDomain>();

  for (const domain of domains) {
    const rawEvidence = domainEvidenceMap[domain];
    if (rawEvidence === undefined || rawEvidence === null) {
      violatingDomains.push(domain);
      reasons.push(
        `Domain '${domain}' is claimed in batch without dedicated domain-specific evidence.`,
      );
      continue;
    }

    const serialized = JSON.stringify(rawEvidence);
    if (serialized === "{}" || serialized === "[]" || serialized === '""') {
      violatingDomains.push(domain);
      reasons.push(`Domain '${domain}' has empty evidence payload.`);
      continue;
    }

    const existingDomain = evidenceFingerprints.get(serialized);
    if (existingDomain !== undefined) {
      violatingDomains.push(domain);
      reasons.push(
        `Domain '${domain}' shares identical duplicate evidence payload with domain '${existingDomain}' (undifferentiated domain batching).`,
      );
    } else {
      evidenceFingerprints.set(serialized, domain);
    }
  }

  const isBatched = violatingDomains.length > 0 || reasons.length > 0;

  return {
    isBatched,
    reasons,
    domainsEvaluated: domains,
    violatingDomains,
  };
}

/**
 * Evaluates whether discriminating counterfactual / falsifiable evidence is present.
 */
export function evaluateCounterfactualEvidence(
  counterfactuals?: readonly unknown[] | undefined,
  checks?: readonly TaskVerificationCheckInput[] | undefined,
): CounterfactualEvidenceEvaluation {
  const items = Array.isArray(counterfactuals) ? counterfactuals : [];
  const checkItems = Array.isArray(checks) ? checks : [];

  let hypothesisCount = 0;
  let falsificationCheckCount = 0;

  for (const item of items) {
    if (typeof item === "object" && item !== null) {
      const rec = item as Record<string, unknown>;
      if (typeof rec.hypothesis === "string" && rec.hypothesis.trim().length > 0) {
        hypothesisCount++;
      }
      if (
        (typeof rec.negativeCheck === "string" && rec.negativeCheck.trim().length > 0) ||
        rec.falsified === true
      ) {
        falsificationCheckCount++;
      }
    }
  }

  // Also check if any check command has explicit negative or edge test verification
  for (const c of checkItems) {
    const cmd = c.command ?? "";
    const out = c.output ?? "";
    if (
      cmd.includes("falsif") ||
      cmd.includes("negative") ||
      cmd.includes("counterfactual") ||
      out.includes("counterfactual")
    ) {
      falsificationCheckCount++;
    }
  }

  const isSufficient = hypothesisCount > 0 || falsificationCheckCount > 0;
  const details = isSufficient
    ? `Counterfactual evidence verified with ${hypothesisCount} hypothesis(es) and ${falsificationCheckCount} falsification check(s).`
    : "No discriminating counterfactual or negative falsification evidence found.";

  return {
    isSufficient,
    hypothesisCount,
    falsificationCheckCount,
    details,
  };
}

/**
 * Strict 1:1 Individual Task Verification Scepticism Audit.
 * Rejects superficial claims, domain batching, and missing counterfactual proof.
 */
export function auditTaskVerificationEvidence(
  evidence: TaskVerificationEvidenceInput,
  options: ScepticismAuditOptions = {},
): TaskVerificationAuditResult {
  const violations: ScepticismViolation[] = [];
  const rejectionReasons: string[] = [];
  const correctiveGuidance: string[] = [];

  // 1. Validate 1:1 task identity
  if (
    !evidence.taskId ||
    typeof evidence.taskId !== "string" ||
    evidence.taskId.trim().length === 0
  ) {
    violations.push({
      type: "empty_rationale",
      message: "Task ID is required for 1:1 individual task verification.",
    });
    rejectionReasons.push("Missing task ID in verification claim.");
  }

  // 2. Evaluate superficial claims
  const summary = evidence.summary ?? "";
  const superficiality = rejectSuperficialClaims(summary, evidence.evidence);
  if (superficiality.isSuperficial) {
    violations.push({
      type: "superficial_claim",
      message: superficiality.reason ?? "Superficial claim detected.",
      taskId: evidence.taskId,
      details: { confidence: superficiality.confidenceScore },
    });
    rejectionReasons.push(
      superficiality.reason ?? "Verification contains superficial rubber-stamping claim.",
    );
    correctiveGuidance.push(
      "**Resolution Path:**\n1. Review the task requirements and assigned write scope.\n2. Extract concrete, task-specific observations (e.g., file paths, line references).\n3. Execute targeted test commands relevant to the task.\n4. Incorporate the test execution evidence directly into the verification claim.",
    );
  }

  // 3. Evaluate domain batching
  const domains = options.requiredDomains ?? (["code-quality"] as const);
  const domainEvidence = evidence.domainEvidence ?? {};
  const domainBatching = detectDomainBatching(domains, domainEvidence);
  if (domainBatching.isBatched) {
    for (const reason of domainBatching.reasons) {
      violations.push({
        type: "domain_batching",
        message: reason,
        taskId: evidence.taskId,
      });
      rejectionReasons.push(reason);
    }
    correctiveGuidance.push(
      "**Resolution Path:**\n1. Separate the verification evidence for each required domain.\n2. Verify each domain independently with distinct checks.\n3. Ensure the evidence payload for each domain is unique and not copy-pasted.",
    );
  }

  // 4. Evaluate counterfactual / falsifiable evidence
  const counterfactual = evaluateCounterfactualEvidence(
    evidence.counterfactualEvidence,
    evidence.checks,
  );
  if (options.requireCounterfactual && !counterfactual.isSufficient) {
    violations.push({
      type: "missing_counterfactual_evidence",
      message: "Missing discriminating counterfactual evidence or falsification proof.",
      taskId: evidence.taskId,
    });
    rejectionReasons.push(
      "Verification lacks counterfactual falsification proof demonstrating the check fails under negative conditions.",
    );
    correctiveGuidance.push(
      "**Resolution Path:**\n1. Formulate a negative hypothesis or edge-case scenario.\n2. Execute a check demonstrating that the condition would fail under this scenario.\n3. Document the falsification proof and the observation in the counterfactual evidence section.",
    );
  }

  // 5. Check concrete check commands & exit codes
  const checks = evidence.checks ?? [];
  if (checks.length === 0 && (!evidence.evidence || evidence.evidence.length === 0)) {
    violations.push({
      type: "unsubstantiated_verdict",
      message: "No check commands or artifact proofs were provided for verification.",
      taskId: evidence.taskId,
    });
    rejectionReasons.push(
      "Verification lacks any executed check commands or tangible evidence artifacts.",
    );
    correctiveGuidance.push(
      "**Resolution Path:**\n1. Identify the task gate check command for this verification.\n2. Execute the command to verify functionality.\n3. Record the exact exit code and relevant output.\n4. Attach this structured proof to the verification verdict.",
    );
  } else {
    for (const check of checks) {
      if (check.exit_code !== undefined && check.exit_code !== 0) {
        violations.push({
          type: "unsubstantiated_verdict",
          message: `Check command '${check.command ?? check.command_id ?? "unknown"}' exited with non-zero code ${check.exit_code}.`,
          taskId: evidence.taskId,
          details: { exit_code: check.exit_code },
        });
        rejectionReasons.push(
          `Verification check command '${check.command ?? check.command_id ?? "unknown"}' failed with exit code ${check.exit_code}.`,
        );
      }
    }
  }

  // 6. Calculate scepticism score (0 - 100)
  let score = 100;
  if (superficiality.isSuperficial) score -= 35;
  if (domainBatching.isBatched) score -= 30;
  if (!counterfactual.isSufficient && options.requireCounterfactual) score -= 20;
  if (checks.length === 0) score -= 25;
  const violationPenalty = violations.length * 10;
  score = Math.max(0, Math.min(100, score - violationPenalty));

  const valid = violations.length === 0 && rejectionReasons.length === 0;

  let recommendedAction: "accept" | "pushback_procedural" | "pushback_substantive" = "accept";
  if (!valid) {
    const hasSubstantiveViolation = violations.some(
      (v) => v.type === "unsubstantiated_verdict" || v.type === "stagnant_repair",
    );
    recommendedAction = hasSubstantiveViolation ? "pushback_substantive" : "pushback_procedural";
  }

  return {
    valid,
    scepticismScore: score,
    violations,
    rejectionReasons,
    superficiality,
    domainBatching,
    counterfactual,
    recommendedAction,
    correctiveGuidance,
  };
}

/**
 * Creates an initial pushback history tracker for a task.
 */
export function createPushbackHistory(
  taskId: string,
  maxRepairRounds: number = MAX_REPAIR_ROUNDS,
): PushbackHistory {
  return {
    taskId,
    currentRound: 0,
    maxRepairRounds,
    rounds: [],
    isExhausted: false,
    unresolvedRejectionReasons: [],
  };
}

/**
 * Appends a pushback round record to the history tracker, maintaining lineage across rounds 1 to 5+.
 */
export function appendPushbackRound(
  history: PushbackHistory,
  roundData: {
    readonly round?: number | undefined;
    readonly timestamp?: string | undefined;
    readonly coordinatorId: string;
    readonly validatorId: string;
    readonly domain: ValidatorDomain;
    readonly cause: CoordinatorPushbackCause;
    readonly observation: string;
    readonly remediation: string;
    readonly rejectionReasons?: readonly string[] | undefined;
    readonly previousEvidenceDigest?: string | undefined;
    readonly previousEvidenceSummary?: string | undefined;
    readonly correctiveGuidance?: readonly string[] | undefined;
    readonly statusAfter?: TaskStatus | undefined;
  },
): PushbackHistory {
  const roundNumber = roundData.round ?? history.currentRound + 1;
  const timestamp = roundData.timestamp ?? new Date().toISOString();
  const id = `cpb-${history.taskId}-r${roundNumber}-${Date.now().toString(36)}`;
  const statusAfter: TaskStatus =
    roundData.statusAfter ??
    (roundData.cause === "procedural"
      ? "validating"
      : roundNumber >= history.maxRepairRounds
        ? "escalated"
        : "changes_requested");

  const rejectionReasons = roundData.rejectionReasons ?? [];
  const correctiveGuidance = roundData.correctiveGuidance ?? [
    `Address observation in round ${roundNumber}: ${roundData.observation}`,
    `Remediation required: ${roundData.remediation}`,
  ];

  const roundRecord: PushbackRoundRecord = {
    round: roundNumber,
    id,
    timestamp,
    coordinatorId: roundData.coordinatorId,
    validatorId: roundData.validatorId,
    domain: roundData.domain,
    cause: roundData.cause,
    observation: roundData.observation,
    remediation: roundData.remediation,
    rejectionReasons,
    previousEvidenceDigest: roundData.previousEvidenceDigest,
    previousEvidenceSummary: roundData.previousEvidenceSummary,
    correctiveGuidance,
    statusAfter,
  };

  const updatedRounds = [...history.rounds, roundRecord];
  const isExhausted = roundNumber >= history.maxRepairRounds && roundData.cause === "substantive";

  return {
    taskId: history.taskId,
    currentRound: roundNumber,
    maxRepairRounds: history.maxRepairRounds,
    rounds: updatedRounds,
    isExhausted,
    lastCause: roundData.cause,
    unresolvedRejectionReasons: rejectionReasons,
  };
}

/**
 * Evaluates whether an iterative repair in round N makes genuine progress over round N-1.
 * Detects stagnant or repeating evidence loops.
 */
export function evaluateRepairProgression(
  history: PushbackHistory,
  newEvidence: TaskVerificationEvidenceInput,
): RepairProgressionEvaluation {
  if (history.rounds.length === 0) {
    return {
      progressMade: true,
      stagnant: false,
      addressedReasons: [],
      unaddressedReasons: [],
      correctiveGuidance: [],
    };
  }

  const lastRound = history.rounds.at(-1)!;
  const previousSummary = lastRound.previousEvidenceSummary ?? "";
  const currentSummary = (newEvidence.summary ?? "").trim();

  // Check for stagnant submission
  const summaryUnchanged =
    previousSummary.length > 0 &&
    currentSummary.length > 0 &&
    previousSummary.toLowerCase() === currentSummary.toLowerCase();

  const addressedReasons: string[] = [];
  const unaddressedReasons: string[] = [];
  const guidance: string[] = [];

  for (const reason of lastRound.rejectionReasons) {
    const reasonLower = reason.toLowerCase();
    const addressedInSummary = currentSummary.toLowerCase().includes(reasonLower);
    const addressedInChecks = (newEvidence.checks ?? []).some(
      (c) =>
        (c.command ?? "").toLowerCase().includes(reasonLower) ||
        (c.output ?? "").toLowerCase().includes(reasonLower),
    );

    if (addressedInSummary || addressedInChecks) {
      addressedReasons.push(reason);
    } else {
      unaddressedReasons.push(reason);
    }
  }

  const stagnant = summaryUnchanged && unaddressedReasons.length > 0;
  const progressMade = !stagnant && (addressedReasons.length > 0 || !summaryUnchanged);

  if (stagnant) {
    guidance.push(
      `Repair in round ${history.currentRound + 1} is stagnant: previous rejection reasons were not addressed and evidence is unchanged.`,
    );
  }

  for (const unaddressed of unaddressedReasons) {
    guidance.push(`Unresolved rejection reason from round ${lastRound.round}: ${unaddressed}`);
  }

  return {
    progressMade,
    stagnant,
    addressedReasons,
    unaddressedReasons,
    correctiveGuidance: guidance,
    diffSummary: `Compared round ${lastRound.round} against round ${history.currentRound + 1}. Addressed ${addressedReasons.length}/${lastRound.rejectionReasons.length} reason(s).`,
  };
}

/**
 * Evaluates whether repair attempts have reached or exceeded the maximum allowed rounds.
 */
export function isRepairExhausted(round: number, maxRounds: number = MAX_REPAIR_ROUNDS): boolean {
  return round >= maxRounds;
}

/**
 * Generates structured corrective guidance based on multi-round pushback history.
 */
export function generateCorrectiveGuidance(
  history: PushbackHistory,
  auditResult?: TaskVerificationAuditResult | undefined,
): readonly string[] {
  const guidance: string[] = [];

  if (history.rounds.length > 0) {
    const latest = history.rounds.at(-1)!;
    guidance.push(
      `[Round ${latest.round} ${latest.cause.toUpperCase()} Pushback]: ${latest.observation}`,
    );
    guidance.push(`Remediation Required: ${latest.remediation}`);
    for (const g of latest.correctiveGuidance) {
      if (!guidance.includes(g)) guidance.push(g);
    }
  }

  if (auditResult) {
    for (const g of auditResult.correctiveGuidance) {
      if (!guidance.includes(g)) guidance.push(g);
    }
    for (const r of auditResult.rejectionReasons) {
      guidance.push(`Resolve rejection reason: ${r}`);
    }
  }

  return guidance;
}

/**
 * Validates coordinator review pushback input structure.
 */
export function validateReviewPushbackInput(value: unknown): ValidatedReviewPushback {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HarnessError("INVALID_ARGUMENT", "coordinator pushback must be an object");
  }

  const raw = value as Record<string, unknown>;

  const rawValidatorId =
    "validator_id" in raw && typeof raw.validator_id === "string"
      ? raw.validator_id
      : "validatorId" in raw && typeof raw.validatorId === "string"
        ? raw.validatorId
        : "";

  if (rawValidatorId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "validator_id is required for review pushback");
  }

  const rawDomain = typeof raw.domain === "string" ? raw.domain : "";
  if (!isValidatorDomain(rawDomain)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `domain must be a recognized validator domain, got: ${JSON.stringify(raw.domain)}`,
    );
  }

  const rawCause = raw.cause;
  if (!isCoordinatorPushbackCause(rawCause)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "cause must be 'procedural' (the review was not properly evidenced) or 'substantive' (the work itself is wrong)",
    );
  }

  const observation = typeof raw.observation === "string" ? raw.observation.trim() : "";
  if (observation.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Coordinator pushback requires a non-empty observation explaining the rationale.",
    );
  }

  const remediation = typeof raw.remediation === "string" ? raw.remediation.trim() : "";
  if (remediation.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Coordinator pushback requires a non-empty remediation plan.",
    );
  }

  const guidance: string[] = [];
  if (Array.isArray(raw.guidance)) {
    for (const g of raw.guidance) {
      if (typeof g === "string" && g.trim().length > 0) {
        guidance.push(g.trim());
      }
    }
  }

  const rejectionReasons: string[] = [];
  if (Array.isArray(raw.rejection_reasons)) {
    for (const r of raw.rejection_reasons) {
      if (typeof r === "string" && r.trim().length > 0) {
        rejectionReasons.push(r.trim());
      }
    }
  }

  const maxRepairRounds =
    typeof raw.max_repair_rounds === "number" && raw.max_repair_rounds > 0
      ? raw.max_repair_rounds
      : typeof raw.maxRepairRounds === "number" && raw.maxRepairRounds > 0
        ? raw.maxRepairRounds
        : MAX_REPAIR_ROUNDS;

  return {
    validatorId: rawValidatorId,
    domain: rawDomain,
    cause: rawCause,
    observation,
    remediation,
    guidance,
    rejectionReasons,
    maxRepairRounds,
  };
}

/**
 * Validates pushback criteria at the authority boundary.
 */
export function validateReviewPushbackCriteria(
  taskId: string,
  coordinatorId: string,
  input: unknown,
): void {
  if (!taskId || typeof taskId !== "string" || taskId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "taskId is required for review pushback");
  }
  if (!coordinatorId || typeof coordinatorId !== "string" || coordinatorId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "coordinatorId is required for review pushback");
  }
  validateReviewPushbackInput(input);
}
