import { HarnessError } from "../../../core/errors/index.ts";

export type OrchestratorLifecycleStatus =
  | "INITIALIZING"
  | "ACTIVE"
  | "COMPLETED"
  | "FAILED"
  | "ZOMBIE_RECLAIMED"
  | "GHOST_TERMINATED";

export const VALID_LIFECYCLE_STATUSES: readonly OrchestratorLifecycleStatus[] = [
  "INITIALIZING",
  "ACTIVE",
  "COMPLETED",
  "FAILED",
  "ZOMBIE_RECLAIMED",
  "GHOST_TERMINATED",
] as const;

export const VALID_HOST_TYPES = ["antigravity", "claude_code", "codex", "cursor"] as const;
export type OrchestratorHostType = (typeof VALID_HOST_TYPES)[number];

export interface OrchestratorRegistrationRecord {
  readonly orchestrator_id: string;
  readonly run_id: string;
  readonly conversation_id: string;
  readonly pid: number;
  readonly host_type: OrchestratorHostType;
  readonly spawned_at: string;
  readonly status: OrchestratorLifecycleStatus;
  readonly manifest_sha256: string;
  readonly last_heartbeat_at: string;
}

export interface NewOrchestratorRecordInput {
  readonly orchestrator_id: string;
  readonly run_id: string;
  readonly conversation_id: string;
  readonly pid: number;
  readonly host_type: OrchestratorHostType;
  readonly status?: OrchestratorLifecycleStatus;
  readonly manifest_sha256: string;
}

export const DEFAULT_ORCHESTRATOR_LEDGER_FILE = ".olt/orchestrators.jsonl";
export const DEFAULT_ORCHESTRATOR_LOCK_FILE = ".olt/locks/orchestrators.lock";

export function isValidHostType(val: unknown): val is OrchestratorHostType {
  return typeof val === "string" && (VALID_HOST_TYPES as readonly string[]).includes(val);
}

export function isValidStatus(val: unknown): val is OrchestratorLifecycleStatus {
  return typeof val === "string" && (VALID_LIFECYCLE_STATUSES as readonly string[]).includes(val);
}

export function validateNewOrchestratorInput(input: NewOrchestratorRecordInput): void {
  if (!input || typeof input !== "object") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "INVALID_REGISTRATION_RECORD: record input must be an object",
    );
  }
  if (typeof input.orchestrator_id !== "string" || !input.orchestrator_id.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "INVALID_REGISTRATION_RECORD: orchestrator_id must be a non-empty string",
    );
  }
  if (typeof input.run_id !== "string" || !input.run_id.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "INVALID_REGISTRATION_RECORD: run_id must be a non-empty string",
    );
  }
  if (typeof input.conversation_id !== "string" || !input.conversation_id.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "INVALID_REGISTRATION_RECORD: conversation_id must be a non-empty string",
    );
  }
  if (typeof input.pid !== "number" || !Number.isInteger(input.pid) || input.pid <= 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "INVALID_REGISTRATION_RECORD: pid must be a positive integer",
    );
  }
  if (!isValidHostType(input.host_type)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "INVALID_REGISTRATION_RECORD: host_type must be one of antigravity, claude_code, codex, cursor",
    );
  }
  if (typeof input.manifest_sha256 !== "string" || !input.manifest_sha256.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "INVALID_REGISTRATION_RECORD: manifest_sha256 must be a non-empty string",
    );
  }
  if (input.status !== undefined && !isValidStatus(input.status)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "INVALID_REGISTRATION_RECORD: status is not a valid OrchestratorLifecycleStatus",
    );
  }
}

export function parseRecord(raw: unknown, lineNumber: number): OrchestratorRegistrationRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HarnessError(
      "INTEGRITY",
      `corrupted record at line ${lineNumber}: expected JSON object`,
    );
  }
  const obj = raw as Record<string, unknown>;
  const orchestrator_id =
    typeof obj["orchestrator_id"] === "string" ? obj["orchestrator_id"].trim() : "";
  const run_id = typeof obj["run_id"] === "string" ? obj["run_id"].trim() : "";
  const conversation_id =
    typeof obj["conversation_id"] === "string" ? obj["conversation_id"].trim() : "";
  const pid = typeof obj["pid"] === "number" && Number.isInteger(obj["pid"]) ? obj["pid"] : 0;
  const host_type = obj["host_type"];
  const spawned_at = typeof obj["spawned_at"] === "string" ? obj["spawned_at"].trim() : "";
  const status = obj["status"];
  const manifest_sha256 =
    typeof obj["manifest_sha256"] === "string" ? obj["manifest_sha256"].trim() : "";
  const last_heartbeat_at =
    typeof obj["last_heartbeat_at"] === "string" ? obj["last_heartbeat_at"].trim() : "";

  if (
    !orchestrator_id ||
    !run_id ||
    !conversation_id ||
    pid <= 0 ||
    !isValidHostType(host_type) ||
    !spawned_at ||
    !isValidStatus(status) ||
    !manifest_sha256 ||
    !last_heartbeat_at
  ) {
    throw new HarnessError("INTEGRITY", `corrupted record fields at line ${lineNumber}`);
  }
  return {
    orchestrator_id,
    run_id,
    conversation_id,
    pid,
    host_type,
    spawned_at,
    status,
    manifest_sha256,
    last_heartbeat_at,
  };
}
