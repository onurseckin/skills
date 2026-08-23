import type { JsonObject } from "../../core/contracts/json.ts";
import { jsonDigest } from "../completion/completion-review-digest.ts";
import type { WorkflowState } from "../types.ts";

export function orphanEvidenceSha256(evidence: JsonObject): string {
  return jsonDigest(evidence);
}

export function orphanEvidenceIssues(state: WorkflowState): string[] {
  const originals = state.orphan_evidence.map(orphanEvidenceSha256);
  const dispositions = state.orphan_evidence_dispositions ?? [];
  const issues: string[] = [];
  if (new Set(originals).size !== originals.length)
    issues.push("orphan evidence history contains duplicate records");
  const seen = new Set<string>();
  for (const disposition of dispositions) {
    if (seen.has(disposition.orphan_sha256))
      issues.push(`orphan evidence has duplicate disposition: ${disposition.orphan_sha256}`);
    seen.add(disposition.orphan_sha256);
    if (!originals.includes(disposition.orphan_sha256))
      issues.push(`orphan disposition has no immutable source: ${disposition.orphan_sha256}`);
    const { disposition_sha256: digest, ...base } = disposition;
    if (digest !== jsonDigest(base))
      issues.push(`orphan disposition digest is invalid: ${disposition.orphan_sha256}`);
  }
  for (const sha of originals) if (!seen.has(sha)) issues.push(`orphan evidence is open: ${sha}`);
  return issues;
}
