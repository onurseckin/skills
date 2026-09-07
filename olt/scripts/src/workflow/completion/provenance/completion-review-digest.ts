import { createHash } from "node:crypto";
import type { JsonValue } from "../../../core/contracts/index.ts";
import { canonicalJsonBytes } from "../../../core/index.ts";
import type { CompletionReview } from "../../index.ts";

export function jsonDigest(value: JsonValue): string {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}

export function completionReviewDigest(review: CompletionReview): string {
  const { review_sha256: _digest, ...content } = review;
  return jsonDigest(content);
}
