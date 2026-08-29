import { isJsonObject, isSafeInteger, type JsonObject } from "../json.ts";

export interface WorktreeRecord extends JsonObject {
  id: string;
  path: string;
  branch: string;
  base_sha: string;
  created_at: string;
}

export interface WorktreeAssignment extends JsonObject {
  task_id: string;
  worktree_id: string;
  wave: number;
}

export interface WorktreeCommitRecord extends JsonObject {
  task_id: string;
  worktree_id: string;
  sha: string;
  subject: string;
  changed_lines: number;
  over_limit: boolean;
  committed_at: string;
}

export interface WorktreeMergeConflict extends JsonObject {
  worktree_id: string;
  branch: string;
  paths: string[];
}

export interface WorktreeConsolidationRecord extends JsonObject {
  harness_branch: string;
  merged_worktree_ids: string[];
  merge_conflict?: WorktreeMergeConflict;
  rebased: boolean;
  rebase_target?: string;
  rebase_conflict_paths?: string[];
  removed_worktree_ids: string[];
  commit_count: number;
  diffstat: string;
  consolidated_at: string;
}

export interface WorktreeLedgerState extends JsonObject {
  harness_branch: string;
  base_sha: string;
  base_branch?: string;
  root: string;
  worktrees: WorktreeRecord[];
  assignments: WorktreeAssignment[];
  commits: WorktreeCommitRecord[];
  consolidation?: WorktreeConsolidationRecord;
}

function isWorktreeRecord(value: unknown): value is WorktreeRecord {
  return (
    isJsonObject(value) &&
    typeof value.id === "string" &&
    typeof value.path === "string" &&
    typeof value.branch === "string" &&
    typeof value.base_sha === "string" &&
    typeof value.created_at === "string"
  );
}

function isWorktreeAssignment(value: unknown): value is WorktreeAssignment {
  return (
    isJsonObject(value) &&
    typeof value.task_id === "string" &&
    typeof value.worktree_id === "string" &&
    isSafeInteger(value.wave)
  );
}

function isWorktreeCommitRecord(value: unknown): value is WorktreeCommitRecord {
  return (
    isJsonObject(value) &&
    typeof value.task_id === "string" &&
    typeof value.worktree_id === "string" &&
    typeof value.sha === "string" &&
    typeof value.subject === "string" &&
    isSafeInteger(value.changed_lines) &&
    typeof value.over_limit === "boolean" &&
    typeof value.committed_at === "string"
  );
}

function isMergeConflict(value: unknown): value is WorktreeMergeConflict {
  return (
    isJsonObject(value) &&
    typeof value.worktree_id === "string" &&
    typeof value.branch === "string" &&
    Array.isArray(value.paths) &&
    value.paths.every((path) => typeof path === "string")
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function isWorktreeConsolidationRecord(
  value: unknown,
): value is WorktreeConsolidationRecord {
  return (
    isJsonObject(value) &&
    typeof value.harness_branch === "string" &&
    isStringArray(value.merged_worktree_ids) &&
    (value.merge_conflict === undefined || isMergeConflict(value.merge_conflict)) &&
    typeof value.rebased === "boolean" &&
    (value.rebase_target === undefined || typeof value.rebase_target === "string") &&
    (value.rebase_conflict_paths === undefined || isStringArray(value.rebase_conflict_paths)) &&
    isStringArray(value.removed_worktree_ids) &&
    isSafeInteger(value.commit_count) &&
    typeof value.diffstat === "string" &&
    typeof value.consolidated_at === "string"
  );
}

export function isWorktreeLedgerState(value: unknown): value is WorktreeLedgerState {
  return (
    isJsonObject(value) &&
    typeof value.harness_branch === "string" &&
    typeof value.base_sha === "string" &&
    (value.base_branch === undefined || typeof value.base_branch === "string") &&
    typeof value.root === "string" &&
    Array.isArray(value.worktrees) &&
    value.worktrees.every(isWorktreeRecord) &&
    Array.isArray(value.assignments) &&
    value.assignments.every(isWorktreeAssignment) &&
    Array.isArray(value.commits) &&
    value.commits.every(isWorktreeCommitRecord) &&
    (value.consolidation === undefined || isWorktreeConsolidationRecord(value.consolidation))
  );
}
