import type { JsonObject } from "../../contracts/json.ts";

export interface AuthorityDecisionInput {
  decision: "grant" | "decline";
  rationale: string;
}

export interface AuthorityDecisionRecord extends JsonObject {
  decision_id: string;
  requirement_id: string;
  decision: "grant" | "decline";
  actor: string;
  rationale: string;
  decided_at: string;
  prior_disposition: "needs_authority";
  resulting_disposition: "actionable" | "out_of_scope";
  decision_sha256: string;
}
