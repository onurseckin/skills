import { HarnessError } from "../../../core/errors/index.ts";
import type { EmpiricalFailureProof } from "../../contracts/defect-contracts.ts";

export type { EmpiricalFailureProof };

export interface ProofVerificationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validates whether an empirical failure proof satisfies all required fields (commit_sha, test_assertion, task_id).
 */
export function verifyFailureProof(proof: unknown): ProofVerificationResult {
  const errors: string[] = [];

  if (proof === undefined) {
    return { valid: false, errors: ["Failure proof must be a non-null object"] };
  }
  if (proof === null) {
    return { valid: false, errors: ["Failure proof must be a non-null object"] };
  }
  if (typeof proof !== "object") {
    return { valid: false, errors: ["Failure proof must be a non-null object"] };
  }

  const p = proof as Record<string, unknown>;

  const commitSha = typeof p["commit_sha"] === "string" ? p["commit_sha"].trim() : "";
  if (commitSha.length === 0) {
    errors.push("Missing or invalid 'commit_sha' in empirical failure proof");
  } else if (commitSha === "empirical-proof-pending") {
    errors.push("Missing or invalid 'commit_sha' in empirical failure proof");
  }

  const testAssertion = typeof p["test_assertion"] === "string" ? p["test_assertion"].trim() : "";
  if (!testAssertion) {
    errors.push("Missing or invalid 'test_assertion' in empirical failure proof");
  }

  const taskId = typeof p["task_id"] === "string" ? p["task_id"].trim() : "";
  if (!taskId) {
    errors.push("Missing or invalid 'task_id' in empirical failure proof");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Asserts that an empirical failure proof is valid, throwing HarnessError("INTEGRITY") otherwise.
 */
export function assertFailureProofValid(proof: unknown): asserts proof is EmpiricalFailureProof {
  const result = verifyFailureProof(proof);
  if (!result.valid) {
    throw new HarnessError(
      "INTEGRITY",
      `Cannot reopen previously completed defect without empirical failure proof: ${result.errors.join("; ")}`,
    );
  }
}
