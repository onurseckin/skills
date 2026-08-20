import type { EvidenceClass } from "../../contracts/evidence.ts";
import type { JsonObject } from "../../contracts/json.ts";
import { verifyIntegrity } from "../../store/integrity.ts";

export interface CapsuleIntegrityEvidence extends JsonObject {
  kind: "capsule_integrity";
  status: "passed" | "failed";
  evidence_class: EvidenceClass;
  event_head: string | null;
  issues: { code: string; message: string }[];
}

/**
 * Runs the capsule integrity check and reports what it found. `passed` means the manifest, the
 * event hash chain and the state projection were all verified clean here and now — it is never
 * asserted on the critic's behalf, and a failing check is recorded as `failed` so completion
 * blocks on it. Deliberately free of timestamps: the evidence is a function of the capsule bytes
 * alone, so an independently published critic packet can digest the identical object.
 */
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
