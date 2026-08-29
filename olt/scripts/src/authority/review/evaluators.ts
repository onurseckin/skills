import { MAX_REPAIR_ROUNDS } from "../../core/config/contracts.ts";
import type { ValidatorDomain } from "../../core/contracts/index.ts";
import { SUPERFICIAL_PATTERNS } from "./constants.ts";
import type {
  CounterfactualEvidenceEvaluation,
  DomainBatchingDetectionResult,
  PushbackHistory,
  RepairProgressionEvaluation,
  SuperficialityDetectionResult,
  TaskVerificationCheckInput,
  TaskVerificationEvidenceInput,
} from "./types.ts";

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

  const reason = isSuperficial
    ? `Claim '${trimmed}' matches superficial pattern without substantive task-specific proof.`
    : null;
  const confidenceScore = isSuperficial ? (isShortVaguePhrase ? 0.95 : 0.75) : 0.0;

  return {
    isSuperficial,
    matchedPatterns: matched,
    reason,
    confidenceScore,
  };
}

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

  return {
    isBatched: violatingDomains.length > 0 || reasons.length > 0,
    reasons,
    domainsEvaluated: domains,
    violatingDomains,
  };
}

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

export function isRepairExhausted(round: number, maxRounds: number = MAX_REPAIR_ROUNDS): boolean {
  return round >= maxRounds;
}
