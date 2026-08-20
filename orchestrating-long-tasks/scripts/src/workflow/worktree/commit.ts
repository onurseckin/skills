import { isJsonObject } from "../../contracts/json.ts";
import type { WorktreeCommitRecord } from "../../contracts/worktree.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { transact } from "../../store/index.ts";
import { commitChangedLines, stageAndCommit } from "./git-ops.ts";
import { readWorktreeLedger, writeWorktreeLedger } from "./ledger.ts";

/** Core tags plus the extended ones this project's own commit-message convention adds. */
const CONVENTIONAL_COMMIT_TYPES = new Set([
  "feat",
  "fix",
  "chore",
  "docs",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "revert",
  "hotfix",
  "security",
  "deps",
  "migration",
]);

/** A trailing `/**` names everything under a directory, which a plain `git add <dir>` already
 *  covers recursively; any other `*` needs the glob pathspec magic to mean what it looks like. */
function toPathspec(scope: string): string {
  if (scope.endsWith("/**")) {
    const directory = scope.slice(0, -3);
    // A scope of exactly "/**" trims to nothing, and the repository root is "." as a pathspec.
    return directory === "" ? "." : directory;
  }
  if (scope.includes("*")) return `:(glob)${scope}`;
  return scope;
}

/** Truncates the label to fit `<type>: <description>` under 70 chars — every accepted type is
 *  short enough that the budget stays positive, so this never produces an empty description. */
function buildSubject(commitType: string, label: string): string {
  const prefix = `${commitType}: `;
  const budget = 70 - prefix.length;
  const description = label.length > budget ? `${label.slice(0, budget - 1)}…` : label;
  return `${prefix}${description}`;
}

export interface CommitSubphaseInput {
  taskId: string;
  worktreeId: string;
  worktreePath: string;
  writeScope: readonly string[];
  label: string;
  /**
   * No default here: a silent `?? "chore"` would tag every harness-made commit with a type nobody
   * actually chose, misrepresenting Conventional Commits history to anyone reading it later. Nothing
   * on `TaskRecord` yet declares what kind of change a task is (and guessing from its label/name is
   * exactly what the HONESTY rule against inferring from a name forbids), so today's one caller
   * (`task-claim.ts`) passes the literal `"chore"` itself, visibly, as its own stated interim policy
   * — not a fallback buried in this function for every future caller to inherit unknowingly.
   */
  commitType: string;
  maxCommitLines: number;
  now?: Date;
}

export interface CommitSubphaseOutcome {
  committed: boolean;
  commit?: WorktreeCommitRecord;
  warning?: string;
}

/** B22.3: stages a task's write scope inside its assigned worktree and commits it, measuring the
 *  change against `maxCommitLines` as a warning, never a refusal. Pure git + measurement — does not
 *  touch run state; call `recordWorktreeCommit` with the result to persist it. */
export function commitSubphase(input: CommitSubphaseInput): CommitSubphaseOutcome {
  const commitType = input.commitType;
  if (!CONVENTIONAL_COMMIT_TYPES.has(commitType)) {
    throw new HarnessError("INVALID_ARGUMENT", `commit type '${commitType}' is not a recognised tag`);
  }
  if (input.writeScope.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", `task ${input.taskId} has no write scope to commit`);
  }
  const subject = buildSubject(commitType, input.label);
  const sha = stageAndCommit(input.worktreePath, input.writeScope.map(toPathspec), subject);
  if (sha === null) return { committed: false };
  const changedLines = commitChangedLines(input.worktreePath, sha);
  const overLimit = changedLines > input.maxCommitLines;
  const commit: WorktreeCommitRecord = {
    task_id: input.taskId,
    worktree_id: input.worktreeId,
    sha,
    subject,
    changed_lines: changedLines,
    over_limit: overLimit,
    committed_at: (input.now ?? new Date()).toISOString(),
  };
  return {
    committed: true,
    commit,
    ...(overLimit
      ? {
          warning: `commit ${sha.slice(0, 12)} changed ${changedLines} lines, over the ${input.maxCommitLines}-line target (B22.3)`,
        }
      : {}),
  };
}

/** Persists a completed sub-phase commit onto both the worktree ledger and the task record — B22.3's
 *  "recorded on the task record and emitted onto the graph node" for the task-record half; the graph
 *  node half is summary-generator territory and is not touched here (see the run report). */
export function recordWorktreeCommit(
  runRoot: string,
  actor: string,
  taskId: string,
  commit: WorktreeCommitRecord,
): void {
  transact(runRoot, actor, "worktree-subphase-committed", { task_id: taskId, sha: commit.sha }, (draft) => {
    const ledger = readWorktreeLedger(draft);
    if (!ledger) throw new HarnessError("INVALID_STATE", "no worktree ledger to record a commit against");
    writeWorktreeLedger(draft, { ...ledger, commits: [...ledger.commits, commit] });
    const tasks = draft.tasks;
    if (!isJsonObject(tasks) || !isJsonObject(tasks[taskId])) {
      throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId}`);
    }
    tasks[taskId].worktree_commit = commit;
  });
}
