import { createHash } from "node:crypto";

export interface FailureSignatureInput {
  readonly category?: string | undefined;
  readonly code: string;
  readonly path?: string | undefined;
  readonly file?: string | undefined;
  readonly message?: string | undefined;
  readonly line?: number | undefined;
}

/**
 * Computes a normalized, deterministic SHA-256 failure signature over canonical fields.
 * signature = SHA256(category || code || normalized_path || normalized_message)
 */
export function computeNormalizedFailureSignature(input: FailureSignatureInput): string {
  const category = (input.category ?? "runtime").trim().toLowerCase();
  const code = input.code.trim().toLowerCase();
  const rawPath = (input.path ?? input.file ?? "").trim();
  const normalizedPath = rawPath.replace(/\\/g, "/").toLowerCase();
  const rawMessage = (input.message ?? "").trim();
  const normalizedMessage = rawMessage.toLowerCase().replace(/\s+/g, " ");
  const line = input.line !== undefined && input.line > 0 ? String(input.line) : "";

  const canonicalPayload = [category, code, normalizedPath, line, normalizedMessage].join("::");
  return createHash("sha256").update(canonicalPayload, "utf-8").digest("hex");
}
