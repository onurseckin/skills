import type { TaskRecord, WorkflowState } from "../workflow/types.ts";

export interface AntiBatchingReviewCheckProof {
  readonly command_id: string;
}

export interface AntiBatchingResolvedFinding {
  readonly finding_id: string;
  readonly method?: string | undefined;
  readonly evidence?: readonly AntiBatchingReviewCheckProof[] | undefined;
}

export interface AntiBatchingReviewPayload {
  readonly verdict: "pass" | "fail";
  readonly requirement_ids?: readonly string[] | undefined;
  readonly checks?: readonly AntiBatchingReviewCheckProof[] | undefined;
  readonly findings?: readonly unknown[] | undefined;
  readonly resolved_findings?: readonly AntiBatchingResolvedFinding[] | undefined;
}

export interface AntiBatchingReviewValidationResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
}

export interface AntiBatchingCriticProof {
  readonly kind: string;
  readonly reference: string;
  readonly observation?: string | undefined;
}

export interface AntiBatchingRequirementProof {
  readonly requirement_id: string;
  readonly status: "satisfied" | "violated" | "unverified";
  readonly evidence: readonly AntiBatchingCriticProof[];
}

export interface AntiBatchingCriticPayload {
  readonly summary: string;
  readonly status: "clean" | "findings";
  readonly requirement_proofs?: readonly AntiBatchingRequirementProof[] | undefined;
}

export interface AntiBatchingCriticValidationResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
}

/**
 * Validates a task review for anti-batching rule compliance:
 * - When a task covers multiple requirements, at least as many discriminating test proofs must be provided.
 * - Every resolved finding must carry non-empty evidence.
 */
export function validateReviewAntiBatching(
  task: TaskRecord,
  review: AntiBatchingReviewPayload,
): AntiBatchingReviewValidationResult {
  const violations: string[] = [];

  if (review.verdict === "pass") {
    const reqIds = review.requirement_ids ?? task.requirement_ids ?? [];
    const checks = review.checks ?? [];

    if (reqIds.length > 1 && checks.length < reqIds.length) {
      violations.push(
        `anti-batching violation: passing review covers ${reqIds.length} requirements but only provides ${checks.length} check(s); individual discriminating test proofs required per requirement`,
      );
    }

    if (review.resolved_findings && review.resolved_findings.length > 0) {
      for (const resolved of review.resolved_findings) {
        if (!resolved.evidence || resolved.evidence.length === 0) {
          violations.push(
            `revalidation evidence for ${resolved.finding_id} must contain at least one command proof`,
          );
        }
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Validates a critic review for anti-batching rule compliance:
 * - Disparate requirements cannot reuse identical evidence without discriminating test proofs.
 */
export function validateCriticAntiBatching(
  _workflowState: WorkflowState,
  criticPayload: AntiBatchingCriticPayload,
): AntiBatchingCriticValidationResult {
  const violations: string[] = [];

  if (criticPayload.status === "clean" && criticPayload.requirement_proofs) {
    const satisfiedProofs = criticPayload.requirement_proofs.filter(
      (p) => p.status === "satisfied",
    );

    if (satisfiedProofs.length > 1) {
      const evidenceKeySets: string[] = [];
      for (const proof of satisfiedProofs) {
        const key = proof.evidence
          .map((e) => `${e.kind}:${e.reference}`)
          .sort()
          .join(",");
        if (key) {
          evidenceKeySets.push(key);
        }
      }

      // Check if all satisfied proofs share the exact same single evidence reference
      const uniqueKeys = new Set(evidenceKeySets);
      if (evidenceKeySets.length > 1 && uniqueKeys.size === 1) {
        violations.push(
          "anti-batching violation: critic sign-off cannot claim multiple disparate feedback items/requirements without individual discriminating test proofs per item",
        );
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}
