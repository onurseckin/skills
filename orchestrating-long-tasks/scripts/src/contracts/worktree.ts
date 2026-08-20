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

/** The worktree and branch a merge conflict happened in, and the paths it touched — named (rather
 *  than inlined at each use) so `isMergeConflict`'s predicate return type is a plain identifier: an
 *  inline `value is { ... }` return type opens a brace of its own right after `is`, which reads to
 *  the unread-parameter scanner as the function body and hides every real read of `value` inside it. */
export interface WorktreeMergeConflict extends JsonObject {
  worktree_id: string;
  branch: string;
  paths: string[];
}

/**
 * B22.4's outcome. A conflict (merge or rebase) is not an error here — the run still completed —
 * so this is a report of what consolidation actually did, not a pass/fail flag. `rebased: false`
 * with `rebase_conflict_paths` set means exactly what B22.4.2 asks for: STOP, leave the branch
 * unrebased, name the paths, never resolve on the user's behalf. The same STOP applies to a merge
 * conflict between two worktree branches (not named in B22.4's own text, but the same rule the
 * rebase step states explicitly) — `merge_conflict` carries that case instead.
 */
export interface WorktreeConsolidationRecord extends JsonObject {
  harness_branch: string;
  /** Worktree ids whose commits were merged onto `harness_branch` before any conflict stopped it. */
  merged_worktree_ids: string[];
  merge_conflict?: WorktreeMergeConflict;
  rebased: boolean;
  rebase_target?: string;
  rebase_conflict_paths?: string[];
  /** Worktree directories actually removed. Empty whenever a merge conflict stopped consolidation
   *  before cleanup — B22.6's "cleanup is explicit, never implicit on failure" extends to a
   *  consolidation that did not finish cleanly, not only to a crash. */
  removed_worktree_ids: string[];
  commit_count: number;
  diffstat: string;
  consolidated_at: string;
}

/**
 * Persisted at `state.worktree_ledger`. `harness_branch` is the shared anchor ref every worktree's
 * own branch is created from and merges back into at run completion (B22.4) — never checked out
 * anywhere itself during the run, so it never collides with a worktree's own branch; consolidation
 * is the one point that legitimately checks it out, in the harness's own scratch space.
 */
export interface WorktreeLedgerState extends JsonObject {
  harness_branch: string;
  base_sha: string;
  /** The branch HEAD pointed at when this run was provisioned, e.g. `main` — B22.4's rebase target
   *  ("the latest default branch"). Absent means HEAD was detached at provisioning, so there is
   *  nothing to rebase onto; consolidation skips the rebase step rather than inventing a branch. */
  base_branch?: string;
  root: string;
  worktrees: WorktreeRecord[];
  assignments: WorktreeAssignment[];
  commits: WorktreeCommitRecord[];
  /** Set once B22.4 consolidation has run to completion (merge + optional rebase + cleanup, no
   *  conflict left open). Absent, not `false` — a run that never reached `run:complete`, and a run
   *  that reached it but stopped on a conflict, look the same here: neither is "done". */
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
