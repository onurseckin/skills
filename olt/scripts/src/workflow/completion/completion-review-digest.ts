import { createHash } from "node:crypto";
import type { JsonValue } from "../../contracts/json.ts";
import { canonicalJsonBytes } from "../../core/json.ts";
import type { CompletionReview } from "../types.ts";

export function jsonDigest(value: JsonValue): string {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}

export function completionReviewDigest(review: CompletionReview): string {
  const { review_sha256: _digest, ...content } = review;
  return jsonDigest(content);
}
