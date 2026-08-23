import { HarnessError } from "../../core/errors/harness-error.ts";
import { requireSubstantiveObjects } from "../evidence.ts";
import { requireText, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import type { OrphanEvidenceDisposition } from "./types.ts";
import { orphanEvidenceSha256 } from "./digest.ts";
import { jsonDigest } from "../completion/completion-review-digest.ts";

const TERMINAL = new Set(["ignored_non_authoritative", "rejected", "superseded"]);

export function dispositionOrphanEvidence(
  port: TransactionPort,
  actor: string,
  value: unknown,
  clock: Clock = systemClock,
) {
  actor = requireText(actor, "actor");
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new HarnessError("INVALID_ARGUMENT", "orphan disposition must be an object");
  const input = value as Record<string, unknown>;
  const orphanSha = requireText(input.orphan_sha256, "orphan_sha256");
  if (!TERMINAL.has(String(input.disposition)))
    throw new HarnessError("INVALID_ARGUMENT", "orphan disposition is invalid");
  const rationale = requireText(input.rationale, "rationale");
  const evidence = requireSubstantiveObjects(input.evidence, "orphan disposition evidence");
  const now = clock.now();
  return port.transact(
    actor,
    "orphan-evidence-dispositioned",
    { orphan_sha256: orphanSha },
    (draft) => {
      if (!draft.orphan_evidence.some((entry) => orphanEvidenceSha256(entry) === orphanSha))
        throw new HarnessError("INVALID_STATE", "orphan evidence does not exist");
      if (
        (draft.orphan_evidence_dispositions ?? []).some(
          (entry) => entry.orphan_sha256 === orphanSha,
        )
      )
        throw new HarnessError("INVALID_STATE", "orphan evidence is already dispositioned");
      const base = {
        orphan_sha256: orphanSha,
        disposition: input.disposition as OrphanEvidenceDisposition["disposition"],
        actor,
        rationale,
        evidence,
        decided_at: utc(now),
      };
      draft.orphan_evidence_dispositions ??= [];
      draft.orphan_evidence_dispositions.push({
        ...base,
        disposition_sha256: jsonDigest(base),
      });
    },
  );
}
