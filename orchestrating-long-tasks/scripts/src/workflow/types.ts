import type { BranchRecord } from "../contracts/branch.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import type {
  Finding,
  GateResult,
  Lease,
  TaskStatus,
  ValidatorDomain,
} from "../contracts/workflow.ts";
import type { JsonObject, JsonValue } from "../contracts/json.ts";
import type {
  CompletionArtifactVerification,
  CompletionCriticAuthorization,
  CompletionRemediation,
  CompletionResult,
  CompletionReview,
} from "./completion/types.ts";
import type { RepositoryBinding } from "../contracts/repository.ts";
import type { OrphanEvidenceDisposition } from "./orphan-evidence/types.ts";

export type {
  CompletionArtifactPacket,
  CompletionArtifactVerification,
  CompletionCriticAuthorization,
  CompletionEvidenceItem,
  CompletionFinding,
  CompletionFindingResolution,
  CompletionRemediation,
  CompletionRequirementProof,
  CompletionResidualRisk,
  CompletionResult,
  CompletionReview,
} from "./completion/types.ts";
export type { OrphanEvidenceDisposition } from "./orphan-evidence/types.ts";
// B12.2: the validator-domain type and its derivation live in contracts/workflow.ts (see that
// file's own comment for why); re-exported here so callers that already import task/workflow types
// from this module do not need a second import path for them.
export { applicableValidatorDomains, isValidatorDomain, VALIDATOR_DOMAINS } from "../contracts/workflow.ts";
export type { ValidatorDomain } from "../contracts/workflow.ts";

export interface TaskHistory extends JsonObject {
  at: string;
  actor: string;
  from: TaskStatus;
  to: TaskStatus;
  reason: string;
  attempt: number;
}

export interface ValidationAttempt extends JsonObject {
  validator_id: string;
  /** B12.2: which validator-family domain this attempt belongs to — explicit or derived from the
   *  task's write scope (`applicableValidatorDomains`), never left implicit, so a task's per-domain
   *  collection (`TaskRecord.validations`) can be keyed and completion can require every applicable
   *  domain to pass rather than the first one. */
  domain: ValidatorDomain;
  token_digest: string;
  attempt: number;
  started_at: string;
  deadline_at: string;
  verdict?: "pass" | "probe" | "reject";
  reviewed_requirement_ids?: string[];
  checks?: CommandProof[];
}

export interface CommandProof extends JsonObject {
  command_id: string;
}

export interface ScopedLease extends Lease {
  write_scope: string[];
  resource_scope: string[];
}

export interface TaskRecord extends JsonObject {
  id: string;
  status: TaskStatus;
  requirement_ids: string[];
  write_scope: string[];
  resource_scope?: string[];
  dependencies: string[];
  attempts: JsonObject[];
  history: TaskHistory[];
  repair_round: number;
  probe_round?: number;
  original_implementer?: string;
  repair_assignee?: string;
  replacement_reason?: "repeated_failure" | "stale" | "unavailable";
  replacement_evidence?: string;
  lease?: ScopedLease;
  report?: JsonObject;
  /**
   * B12.2: the task's currently OPEN validation attempts, at most one per domain (`begin-validation`
   * enforces that), one entry per domain the task's write scope drew (or was explicitly assigned).
   * A domain's entry stays here after it records a pass — the task's terminal `validated` transition
   * requires every applicable domain to have one — so this is not merely "in flight" work; it also
   * carries the settled record for a domain that finished before its siblings. A reject from any one
   * domain archives every open entry into `validation_history` and clears this collection, ending
   * the round for every domain the same way a single validator's reject always ended it (B36 finding
   * #3). Was a singleton `validation?: ValidationAttempt`; renamed on the shape change so every call
   * site had to be looked at rather than silently compiling against the old assumption.
   */
  validations?: ValidationAttempt[];
  validation_history?: ValidationAttempt[];
  findings?: Finding[];
  gate_results?: GateResult[];
}

export interface RequirementRuntime extends JsonObject {
  id: string;
  status: "planned" | "satisfied";
  disposition?: "actionable" | "needs_authority" | "out_of_scope";
  authority_status?: "granted" | "declined";
  authority_history?: JsonObject[];
  dependencies?: string[];
  evidence: string[];
}

export interface GateRuntime extends JsonObject {
  id: string;
  command: string | string[];
  cwd: string;
  scope: "run" | "task";
  requirement_ids: string[];
  mandatory: boolean;
}

export interface RunGateRuntime extends JsonObject {
  id: string;
  command: string | string[];
  command_id: string;
  mandatory: boolean;
}

export interface CompletionEvidence extends JsonObject {
  integrity_issues: string[];
  critic: {
    status: "clean" | "findings";
    unresolved_finding_ids: string[];
  };
  run_gates: RunGateRuntime[];
}

export interface PacketRecord extends JsonObject {
  id: string;
  status: "preparing" | "published";
  role: string;
  agent_id: string;
  task_id: string | null;
  attempt: number;
  graph_revision: number;
  markdown_path: string;
  metadata_path: string;
  packet_sha256: string;
  readiness_sha256?: string;
  repository_binding?: RepositoryBinding;
  repository_command_ids?: string[];
  integrity_evidence_sha256?: string;
  published_at: string;
}

export interface WorkflowState extends JsonObject {
  tasks: { [taskId: string]: TaskRecord };
  requirements: RequirementRuntime[];
  gates: GateRuntime[];
  commands: { [commandId: string]: CommandRecord };
  orphan_evidence: JsonObject[];
  orphan_evidence_dispositions?: OrphanEvidenceDisposition[];
  graph_revision?: number;
  current_repository_binding?: RepositoryBinding;
  packets?: { [packetId: string]: PacketRecord };
  branches?: BranchRecord[];
  completion_critic?: CompletionCriticAuthorization;
  completion_critic_history?: CompletionCriticAuthorization[];
  completion_review?: CompletionReview;
  completion_reviews?: CompletionReview[];
  completion_remediations?: CompletionRemediation[];
  completion_verification?: CompletionArtifactVerification;
  completion_result?: CompletionResult;
  completion?: CompletionEvidence;
}

export interface TransactionPort {
  read(): WorkflowState;
  transact(
    actor: string,
    kind: string,
    payload: JsonObject,
    mutate: (draft: WorkflowState) => void,
  ): WorkflowState;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
export type OperationResult = { state: WorkflowState; data: JsonValue };
