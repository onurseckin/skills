import type { JsonObject } from "../../contracts/json.ts";

export interface PlanFinding extends JsonObject {
  id: string;
  invariant?: string;
  severity: "critical" | "important" | "minor";
  observation: string;
  remediation: string;
}

export interface PlanValidationAuthorization extends JsonObject {
  validator_id: string;
  token_digest: string;
  attempt: number;
  status: "assigned" | "packet_published" | "reviewed" | "expired";
  started_at: string;
  deadline_at: string;
  graph_revision: number;
  plan_digest: string;
  packet_id?: string;
}

export interface PlanReview extends JsonObject {
  validator_id: string;
  packet_id: string;
  packet_sha256?: string;
  graph_revision: number;
  plan_digest: string;
  summary: string;
  status: "approved" | "changes_requested";
  decomposition_answer: string;
  dependency_answer: string;
  gate_answer: string;
  straggler_answer: string;
  findings: PlanFinding[];
  checks: { command_id: string }[];
  reviewed_at: string;
  review_sha256: string;
}
