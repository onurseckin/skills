import type { EvidenceClass } from "../../core/contracts/evidence.ts";
import type { JsonObject } from "../../core/contracts/json.ts";
import { verifyIntegrity } from "../../engine/store/integrity.ts";

export interface CapsuleIntegrityEvidence extends JsonObject {
  kind: "capsule_integrity";
  status: "passed" | "failed";
  evidence_class: EvidenceClass;
  event_head: string | null;
  issues: { code: string; message: string }[];
}

export function observeCapsuleIntegrity(
  runRoot: string,
  eventHead: string | null,
): CapsuleIntegrityEvidence {
  const issues = verifyIntegrity(runRoot).map(({ code, message }) => ({ code, message }));
  return {
    kind: "capsule_integrity",
    status: issues.length === 0 ? "passed" : "failed",
    evidence_class: "harness_observed",
    event_head: eventHead,
    issues,
  };
}
