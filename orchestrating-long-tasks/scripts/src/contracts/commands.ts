import type { JsonObject } from "./json.ts";
import type { RepositoryBinding } from "./repository.ts";

export type CommandAssurance = "trusted_host_observed_v1";

export type CommandStatus = "failed" | "running" | "succeeded" | "timed_out";
export type CommandTimeoutKind = "idle" | "wall";

export interface CommandLogMetadata extends JsonObject {
  path: string;
  bytes: number;
  sha256: string;
}

export interface CommandPolicyRecord extends JsonObject {
  wall_timeout_ms: number;
  idle_timeout_ms: number;
  grace_ms: number;
  drain_timeout_ms: number;
  heartbeat_interval_ms: number;
  max_output_bytes: number;
  max_retries: number;
  idempotent: boolean;
}

export interface CommandPathBinding extends JsonObject {
  argv_index: number;
  argument: string;
  operand: string;
  scope: "repository" | "system";
  role: "config" | "executable" | "program" | "target";
  canonical_path: string;
  relative_path?: string;
  kind: "directory" | "file";
  executable: boolean;
  device: string;
  inode: string;
  mode: number;
  bytes?: number;
  sha256?: string;
  entries?: number;
  tree_bytes?: number;
  tree_sha256?: string;
}

export interface CommandProcessIdentity extends JsonObject {
  pid: number;
  parent: number;
  group: number;
  birth: string;
}

export interface CommandAttemptCleanupDisposition extends JsonObject {
  status: "record_pending" | "terminal_proof" | "uncertain";
  sequence: number;
  recorded_at: string;
  reason: string;
  signals_sent: string[];
  root_pid_identity: CommandProcessIdentity | null;
  proof_kind: "settled" | "strong_absence" | null;
  previous_sha256: string;
  previous_signature: string | null;
  signature: string;
  sha256: string;
}

export interface CommandAttemptStartedRecord extends JsonObject {
  schema: "harness.command-attempt-started";
  version: 1;
  command_id: string;
  attempt: number;
  status: "running";
  started_at: string;
  ownership_token_sha256: string;
  verification_public_key: string;
  root_pid_identity: CommandProcessIdentity | null;
  base_sha256: string;
  disposition_head_sha256: string;
  cleanup_disposition: CommandAttemptCleanupDisposition | null;
  cleanup_history: CommandAttemptCleanupDisposition[];
}

export interface CommandAttemptRecord extends JsonObject {
  id: string;
  attempt: number;
  status: CommandStatus;
  started_at: string;
  finished_at: string;
  exit_code: null | number;
  signal: null | string;
  signals_sent: string[];
  timeout_kind: null | CommandTimeoutKind;
  failure_class: null | string;
  activity_path: string;
  activity: CommandLogMetadata;
  logs: { stdout: CommandLogMetadata; stderr: CommandLogMetadata };
  evidence_issues?: string[];
  integrity_failure?: string;
  gate_finalized_at?: string;
  repository_after?: RepositoryBinding;
}

export interface CommandRecord extends JsonObject {
  id: string;
  argv: string[];
  execution_argv?: string[];
  cwd: string;
  cwd_relative: string;
  repository_root: string;
  status: CommandStatus;
  task_id: null | string;
  gate_id: null | string;
  started_at: string;
  finished_at: null | string;
  exit_code: null | number;
  signal: null | string;
  fingerprint: string;
  attempt_signing_public_key: string;
  record_path: string;
  actor: string;
  timeout_kind?: null | CommandTimeoutKind;
  signals_sent?: string[];
  logs?: { stdout: CommandLogMetadata; stderr: CommandLogMetadata };
  policy?: CommandPolicyRecord;
  attempts?: CommandAttemptRecord[];
  retry_exhausted?: boolean;
  retry_pending?: true;
  evidence_error?: string;
  preflight_failure?: string;
  evidence_issues?: string[];
  assurance?: CommandAssurance;
  repository_before?: RepositoryBinding;
  repository_after?: RepositoryBinding | null;
  path_bindings?: CommandPathBinding[];
  environment?: Record<string, string>;
}
