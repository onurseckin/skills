import { canonicalJsonBytes } from "../../core/json.ts";

export const SHA256 = /^[0-9a-f]{64}$/u;
export const REPOSITORY_FIELDS = [
  "content_sha256",
  "file_count",
  "git_identity_sha256",
  "inspection_sha256",
  "schema",
  "total_bytes",
  "version",
] as const;

export function sameCommandJson(left: unknown, right: unknown): boolean {
  try {
    return Buffer.from(canonicalJsonBytes(left as never)).equals(
      Buffer.from(canonicalJsonBytes(right as never)),
    );
  } catch {
    return false;
  }
}

export function repositoryObservationIssues(value: unknown, label: string): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return [`${label} is missing`];
  const input = value as Record<string, unknown>;
  if (
    !sameCommandJson(Object.keys(input).sort(), [...REPOSITORY_FIELDS]) ||
    input.schema !== "harness.repository-binding" ||
    input.version !== 1 ||
    typeof input.inspection_sha256 !== "string" ||
    !SHA256.test(input.inspection_sha256) ||
    typeof input.git_identity_sha256 !== "string" ||
    !SHA256.test(input.git_identity_sha256) ||
    typeof input.content_sha256 !== "string" ||
    !SHA256.test(input.content_sha256) ||
    !Number.isSafeInteger(input.file_count) ||
    (input.file_count as number) < 0 ||
    !Number.isSafeInteger(input.total_bytes) ||
    (input.total_bytes as number) < 0
  )
    return [`${label} is invalid`];
  return [];
}
