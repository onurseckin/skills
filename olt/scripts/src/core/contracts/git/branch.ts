import { isEvidenced, type Evidenced } from "../system/evidence.ts";
import { isJsonObject, isSafeInteger, type JsonObject } from "../json.ts";

export type BranchStatus = "abandoned" | "collected" | "collecting" | "open";

export type BranchSubTaskStatus = "abandoned" | "branched" | "claimed" | "open" | "submitted";

export const BRANCH_STATUSES: readonly BranchStatus[] = [
  "open",
  "collecting",
  "collected",
  "abandoned",
];

export const BRANCH_SUB_TASK_STATUSES: readonly BranchSubTaskStatus[] = [
  "open",
  "claimed",
  "branched",
  "submitted",
  "abandoned",
];

export const TERMINAL_SUB_TASK_STATUSES: readonly BranchSubTaskStatus[] = [
  "submitted",
  "abandoned",
];

export interface BranchLease extends JsonObject {
  agent_id: string;
  token_digest: string;
  issued_at: string;
  expires_at: string;
  duration_seconds: number;
  suspended_at?: string;
}

export interface BranchLeaseRecovery extends JsonObject {
  recovered_at: string;
  expired_agent_id: string;
  expired_at: string;
}

export interface BranchSubTask extends JsonObject {
  id: string;
  label: string;
  write_scope: string[];
  gate?: string;
  status: BranchSubTaskStatus;
  agent_id?: string;
  lease?: BranchLease;
  claimed_at?: string;
  submitted_at?: string;
  abandoned_at?: string;
  summary?: string;
  recovery?: BranchLeaseRecovery;
}

export interface BranchRepositoryEntry extends JsonObject {
  path: string;
  status_code: string;
  sha256: null | string;
}

export interface BranchRepositoryObservation extends JsonObject {
  observed_at: string;
  git_available: boolean;
  head: null | string;
  entries: BranchRepositoryEntry[];
}

export interface BranchRecord extends JsonObject {
  id: string;
  parent_task_id: string;
  parent_agent_id: string;
  reason: string;
  depth: number;
  sub_tasks: BranchSubTask[];
  status: BranchStatus;
  opened_at: string;
  collected_at?: string;
  abandoned_at?: string;
  outcome_summary?: string;
  files_changed?: Evidenced<string[]>;
  opened_observation?: BranchRepositoryObservation;
  collected_observation?: BranchRepositoryObservation;
}

const BRANCH_STATUS_SET = new Set<string>(BRANCH_STATUSES);
const SUB_TASK_STATUS_SET = new Set<string>(BRANCH_SUB_TASK_STATUSES);

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function optionalString(record: JsonObject, key: string): boolean {
  const value = record[key];
  return value === undefined || isNonBlankString(value);
}

export function isBranchStatus(value: unknown): value is BranchStatus {
  return typeof value === "string" && BRANCH_STATUS_SET.has(value);
}

export function isBranchSubTaskStatus(value: unknown): value is BranchSubTaskStatus {
  return typeof value === "string" && SUB_TASK_STATUS_SET.has(value);
}

export function isBranchLease(value: unknown): value is BranchLease {
  if (!isJsonObject(value)) return false;
  return (
    isNonBlankString(value.agent_id) &&
    isNonBlankString(value.token_digest) &&
    isNonBlankString(value.issued_at) &&
    isNonBlankString(value.expires_at) &&
    isSafeInteger(value.duration_seconds) &&
    optionalString(value, "suspended_at")
  );
}

export function isBranchSubTask(value: unknown): value is BranchSubTask {
  if (!isJsonObject(value)) return false;
  if (!isNonBlankString(value.id) || !isNonBlankString(value.label)) return false;
  if (!isStringArray(value.write_scope) || value.write_scope.length === 0) return false;
  if (!isBranchSubTaskStatus(value.status)) return false;
  if (!optionalString(value, "gate") || !optionalString(value, "agent_id")) return false;
  if (!optionalString(value, "claimed_at") || !optionalString(value, "submitted_at")) return false;
  if (!optionalString(value, "abandoned_at") || !optionalString(value, "summary")) return false;
  if (value.lease !== undefined && !isBranchLease(value.lease)) return false;
  return true;
}

function isRepositoryObservation(value: unknown): value is BranchRepositoryObservation {
  if (!isJsonObject(value)) return false;
  if (!isNonBlankString(value.observed_at) || typeof value.git_available !== "boolean") {
    return false;
  }
  if (value.head !== null && !isNonBlankString(value.head)) return false;
  return (
    Array.isArray(value.entries) &&
    value.entries.every(
      (entry) =>
        isJsonObject(entry) &&
        isNonBlankString(entry.path) &&
        typeof entry.status_code === "string" &&
        (entry.sha256 === null || isNonBlankString(entry.sha256)),
    )
  );
}

export function isBranchRecord(value: unknown): value is BranchRecord {
  if (!isJsonObject(value)) return false;
  if (!isNonBlankString(value.id) || !isNonBlankString(value.parent_task_id)) return false;
  if (!isNonBlankString(value.parent_agent_id) || !isNonBlankString(value.reason)) return false;
  if (!isSafeInteger(value.depth) || value.depth < 1) return false;
  if (!isBranchStatus(value.status) || !isNonBlankString(value.opened_at)) return false;
  if (!optionalString(value, "collected_at") || !optionalString(value, "abandoned_at")) {
    return false;
  }
  if (!optionalString(value, "outcome_summary")) return false;
  if (!Array.isArray(value.sub_tasks) || !value.sub_tasks.every(isBranchSubTask)) return false;
  if (value.files_changed !== undefined && !isEvidenced(value.files_changed, isStringArray)) {
    return false;
  }
  for (const key of ["opened_observation", "collected_observation"]) {
    const observation = value[key];
    if (observation !== undefined && !isRepositoryObservation(observation)) return false;
  }
  return true;
}

export function isSubTaskTerminal(subTask: BranchSubTask): boolean {
  return TERMINAL_SUB_TASK_STATUSES.includes(subTask.status);
}

export function isBranchOpen(branch: BranchRecord): boolean {
  return branch.status === "open" || branch.status === "collecting";
}
