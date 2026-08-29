import type { JsonObject } from "../json.ts";
import type { RepositoryBinding } from "../git/repository.ts";

export const TRUSTED_HOST_ASSURANCE = "trusted_host_observed_v1" as const;

const surface = {
  assurance: TRUSTED_HOST_ASSURANCE,
  sandboxed: false,
  trusted_boundary: "local OS user, host-selected toolchain and transitive processes",
} as const;

const limitations = [
  "The host or coding application may add a sandbox; the harness neither configures nor attests it.",
  "Same-user mutate, execute, and restore between observations is outside this assurance.",
  "Process ownership signaling remains independently fail-closed.",
] as const;

export function trustedHostEvidence(): JsonObject {
  return structuredClone(surface);
}

export function trustedHostLimitations(): string[] {
  return [...limitations];
}

export function sameTrustedHostRepositoryBinding(
  left: RepositoryBinding,
  right: RepositoryBinding,
): boolean {
  return (
    left.schema === right.schema &&
    left.version === right.version &&
    left.inspection_sha256 === right.inspection_sha256 &&
    left.git_identity_sha256 === right.git_identity_sha256 &&
    left.content_sha256 === right.content_sha256 &&
    left.file_count === right.file_count &&
    left.total_bytes === right.total_bytes
  );
}
