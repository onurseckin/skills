import { HarnessError } from "../../../core/errors/index.ts";
import type { DefectEntry, DefectResolutionProof } from "../core/types.ts";

export function validateResolutionProof(
  proof: unknown,
  options: { readonly requireCommitSha?: boolean | undefined } = {},
): DefectResolutionProof {
  if (typeof proof !== "object" || proof === null || Array.isArray(proof)) {
    throw new HarnessError("INVALID_ARGUMENT", "resolution proof must be an object");
  }

  const p = proof as Record<string, unknown>;
  const taskId = typeof p.task_id === "string" ? p.task_id.trim() : "";
  const testAssertion = typeof p.test_assertion === "string" ? p.test_assertion.trim() : "";
  const resolvedAt = typeof p.resolved_at === "string" ? p.resolved_at.trim() : "";
  const commitSha =
    typeof p.commit_sha === "string" && p.commit_sha.trim() ? p.commit_sha.trim() : undefined;

  const remediationNotes =
    typeof p.remediation_notes === "string" && p.remediation_notes.trim()
      ? p.remediation_notes.trim()
      : undefined;

  const verifiedBy =
    typeof p.verified_by === "string" && p.verified_by.trim() ? p.verified_by.trim() : undefined;

  if (!taskId) {
    throw new HarnessError("INVALID_ARGUMENT", "resolution proof requires non-empty task_id");
  }
  if (!testAssertion) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "resolution proof requires non-empty test_assertion",
    );
  }
  if (!resolvedAt) {
    throw new HarnessError("INVALID_ARGUMENT", "resolution proof requires non-empty resolved_at");
  }

  const parsedDate = Date.parse(resolvedAt);
  if (!Number.isFinite(parsedDate)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `resolution proof resolved_at '${resolvedAt}' is not a valid ISO date timestamp`,
    );
  }

  if (options.requireCommitSha && (!commitSha || commitSha.length < 7)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "resolution proof requires valid commit_sha when requireCommitSha is enabled",
    );
  }

  return {
    task_id: taskId,
    test_assertion: testAssertion,
    resolved_at: resolvedAt,
    ...(commitSha !== undefined ? { commit_sha: commitSha } : {}),
    ...(remediationNotes !== undefined ? { remediation_notes: remediationNotes } : {}),
    ...(verifiedBy !== undefined ? { verified_by: verifiedBy } : {}),
  };
}

export function verifyResolutionProofEmpirical(
  proof: DefectResolutionProof,
  options: { readonly requireCommitSha?: boolean | undefined } = {},
): { readonly isValid: boolean; readonly reason?: string | undefined } {
  try {
    validateResolutionProof(proof, options);
    if ((proof.test_assertion?.length ?? 0) < 5) {
      return {
        isValid: false,
        reason: "test_assertion is too brief to be empirical",
      };
    }
    return { isValid: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { isValid: false, reason: msg };
  }
}

export function resolveDefect(
  defect: DefectEntry,
  proof: DefectResolutionProof,
  options: { readonly requireCommitSha?: boolean | undefined } = {},
): DefectEntry {
  const validatedProof = validateResolutionProof(proof, options);
  return {
    ...defect,
    status: "resolved",
    resolution: validatedProof,
  };
}
