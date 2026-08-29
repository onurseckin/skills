import type { JsonObject } from "../../core/contracts/index.ts";
import type { CommandProof } from "../types.ts";
import type { RepositoryBinding } from "../../core/contracts/index.ts";

export interface CompletionEvidenceItem extends JsonObject {
  kind: "command" | "artifact" | "state";
  reference: string;
  observation: string;
}

export interface CompletionRequirementProof extends JsonObject {
  requirement_id: string;
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
  packet_sha256?: string;
  graph_revision: number;
  readiness_sha256: string;
  repository_binding: RepositoryBinding;
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
