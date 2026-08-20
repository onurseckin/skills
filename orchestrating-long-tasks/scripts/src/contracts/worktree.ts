import { isJsonObject, isSafeInteger, type JsonObject } from "./json.ts";

/**
 * One git worktree the harness provisioned for a run. Never inside the repository being worked on
 * (B22.1) — `path` is always outside it, verified at provisioning time, not merely assumed here.
 */
export interface WorktreeRecord extends JsonObject {
  /** Stable index within the run, e.g. `wt-0`. Also the pool slot `assignWorktrees` reuses. */
  id: string;
  path: string;
  /** The worktree's own branch, e.g. `harness/<run-id>--wt-0` — a sibling of the shared
   *  `harness/<run-id>` ref, never a path nested under it (git's ref namespace forbids a ref and a
   *  ref-path-prefix of the same name coexisting), and never checked out anywhere else. */
  branch: string;
  base_sha: string;
  created_at: string;
}

/** Which worktree a task ran in, and in which wave — the provenance B22.2 asks for. */
export interface WorktreeAssignment extends JsonObject {
  task_id: string;
  worktree_id: string;
  wave: number;
}

/** One sub-phase commit, B22.3. `over_limit` is a warning flag, never a refusal. */
export interface WorktreeCommitRecord extends JsonObject {
  task_id: string;
  worktree_id: string;
  sha: string;
  subject: string;
  changed_lines: number;
  over_limit: boolean;
  committed_at: string;
}

/**
 * Persisted at `state.worktree_ledger`. `harness_branch` is the shared anchor ref every worktree's
 * own branch is created from and will eventually merge back into (B22.4, not yet implemented) —
 * never checked out anywhere itself, so it never collides with a worktree's own branch.
 */
export interface WorktreeLedgerState extends JsonObject {
  harness_branch: string;
  base_sha: string;
  root: string;
  worktrees: WorktreeRecord[];
  assignments: WorktreeAssignment[];
  commits: WorktreeCommitRecord[];
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

export function isWorktreeLedgerState(value: unknown): value is WorktreeLedgerState {
  return (
    isJsonObject(value) &&
    typeof value.harness_branch === "string" &&
    typeof value.base_sha === "string" &&
    typeof value.root === "string" &&
    Array.isArray(value.worktrees) &&
    value.worktrees.every(isWorktreeRecord) &&
    Array.isArray(value.assignments) &&
    value.assignments.every(isWorktreeAssignment) &&
    Array.isArray(value.commits) &&
    value.commits.every(isWorktreeCommitRecord)
  );
}
