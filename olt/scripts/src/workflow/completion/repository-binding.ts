import type { RepositoryBinding } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import type { WorkflowState } from "../types.ts";

const SHA256 = /^[0-9a-f]{64}$/u;

export type RepositoryBindingVerifier = (expected: Readonly<RepositoryBinding>) => unknown;

export function validateRepositoryBinding(value: unknown, label: string): RepositoryBinding {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new HarnessError("INTEGRITY", `${label} is missing`);
  const input = value as Record<string, unknown>;
  if (
    input.schema !== "harness.repository-binding" ||
    input.version !== 1 ||
    typeof input.inspection_sha256 !== "string" ||
    !SHA256.test(input.inspection_sha256) ||
    typeof input.content_sha256 !== "string" ||
    !SHA256.test(input.content_sha256) ||
    typeof input.git_identity_sha256 !== "string" ||
    !SHA256.test(input.git_identity_sha256) ||
    !Number.isSafeInteger(input.file_count) ||
    (input.file_count as number) < 0 ||
    !Number.isSafeInteger(input.total_bytes) ||
    (input.total_bytes as number) < 0
  ) {
    throw new HarnessError("INTEGRITY", `${label} is invalid`);
  }
  return {
    schema: "harness.repository-binding",
    version: 1,
    inspection_sha256: input.inspection_sha256,
    git_identity_sha256: input.git_identity_sha256,
    content_sha256: input.content_sha256,
    file_count: input.file_count as number,
    total_bytes: input.total_bytes as number,
  };
}

export function currentRepositoryBinding(state: WorkflowState): RepositoryBinding {
  return validateRepositoryBinding(state.current_repository_binding, "repository binding");
}

export function repositoryBindingIsValid(value: unknown): boolean {
  try {
    validateRepositoryBinding(value, "repository binding");
    return true;
  } catch {
    return false;
  }
}

export function sameRepositoryBinding(left: unknown, right: unknown): boolean {
  try {
    return (
      JSON.stringify(validateRepositoryBinding(left, "repository binding")) ===
      JSON.stringify(validateRepositoryBinding(right, "repository binding"))
    );
  } catch {
    return false;
  }
}

export function verifyRepositoryBinding(
  expected: RepositoryBinding,
  verifier: RepositoryBindingVerifier,
): RepositoryBinding {
  const observed = validateRepositoryBinding(verifier(expected), "verified repository binding");
  if (!sameRepositoryBinding(expected, observed))
    throw new HarnessError("INVALID_STATE", "repository bytes changed after critic authorization");
  return observed;
}
