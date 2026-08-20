import type { JsonObject } from "../../contracts/json.ts";
import type { CommandProof } from "../types.ts";
import type { RepositoryBinding } from "../../contracts/repository.ts";

export interface CompletionEvidenceItem extends JsonObject {
  kind: "command" | "artifact" | "state";
  reference: string;
  observation: string;
}

export interface CompletionRequirementProof extends JsonObject {
  requirement_id: string;
  // `unproven` is what the harness records for a requirement the critic never proved. It is never
  // something a critic can claim, and it blocks completion.
  status: "satisfied" | "out_of_scope" | "unproven";
  evidence: CompletionEvidenceItem[];
}

export interface CompletionFinding extends JsonObject {
  id: string;
  requirement_id: string;
  severity: "critical" | "important" | "minor";
  observation: string;
  file_paths?: string[];
  evidence: JsonObject[];
  remediation: string;
  revalidation: string;
}

export interface CompletionResidualRisk extends JsonObject {
  id: string;
  severity: "critical" | "important" | "minor";
  description: string;
  disposition: "accepted";
  rationale: string;
  evidence: JsonObject[];
}

export interface CompletionReview extends JsonObject {
  critic_id: string;
  packet_id: string;
  // Absent when the review was recorded without a published critic packet; a review that has no
  // packet carries no packet digest rather than an empty-string stand-in.
  packet_sha256?: string;
  graph_revision: number;
  readiness_sha256: string;
  repository_binding: RepositoryBinding;
  // B21: the critic's own account of what the whole diff shows, closing out the run's final
  // lifecycle transition. Required so this durable, hash-chained record — not only the CLI flag
  // parser — is where the requirement actually lives.
  summary: string;
  status: "clean" | "findings";
  unresolved_finding_ids: string[];
  findings: CompletionFinding[];
  requirement_proofs: CompletionRequirementProof[];
  residual_risks: CompletionResidualRisk[];
  integrity_evidence: JsonObject[];
  repository_command_ids: string[];
  checks: CommandProof[];
  reviewed_at: string;
  review_sha256: string;
}

export interface CompletionFindingResolution extends JsonObject {
  finding_id: string;
  method: string;
  command_ids: string[];
}

export interface CompletionRemediation extends JsonObject {
  actor: string;
  review_sha256: string;
  resolutions: CompletionFindingResolution[];
  recorded_at: string;
  remediation_sha256: string;
}

export interface CompletionCriticAuthorization extends JsonObject {
  critic_id: string;
  token_digest: string;
  attempt: number;
  status: "assigned" | "packet_published" | "reviewed" | "expired";
  started_at: string;
  deadline_at: string;
  readiness_sha256: string;
  repository_binding: RepositoryBinding;
  packet_id?: string;
}

export interface CompletionResult extends JsonObject {
  status: "complete";
  actor: string;
  completed_at: string;
  graph_revision: number;
  readiness_sha256: string;
  repository_binding: RepositoryBinding;
  critic_review_sha256: string;
  artifact_verification_sha256: string;
  mandatory_run_gate_commands: { [gateId: string]: string };
}

export interface CompletionArtifactPacket extends JsonObject {
  id: string;
  packet_sha256: string;
}

export interface CompletionArtifactVerification extends JsonObject {
  verified_at: string;
  command_ids: string[];
  packets: CompletionArtifactPacket[];
  repository_binding: RepositoryBinding;
  verification_sha256: string;
}
