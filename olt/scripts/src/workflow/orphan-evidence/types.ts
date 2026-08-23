import type { JsonObject } from "../../core/contracts/json.ts";

export interface OrphanEvidenceDisposition extends JsonObject {
  orphan_sha256: string;
  disposition: "ignored_non_authoritative" | "rejected" | "superseded";
  actor: string;
  rationale: string;
  evidence: JsonObject[];
  decided_at: string;
  disposition_sha256: string;
}
