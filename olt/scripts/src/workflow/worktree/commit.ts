import { isJsonObject } from "../../core/contracts/json.ts";
import type { WorktreeCommitRecord } from "../../core/contracts/worktree.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { transact } from "../../engine/store/index.ts";
import { commitChangedLines, runGit, stageAndCommit, type GitRunner } from "./git-ops.ts";
import { readWorktreeLedger, writeWorktreeLedger } from "./ledger.ts";

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

function toPathspec(scope: string): string {
  if (scope.endsWith("/**")) {
    const directory = scope.slice(0, -3);
    return directory === "" ? "." : directory;
  }
  if (scope.includes("*")) return `:(glob)${scope}`;
  return scope;
}

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
  commitType: string;
  maxCommitLines: number;
  now?: Date;
  runner?: GitRunner;
}

export interface CommitSubphaseOutcome {
  committed: boolean;
  commit?: WorktreeCommitRecord;
  warning?: string;
}

export function commitSubphase(input: CommitSubphaseInput): CommitSubphaseOutcome {
  const commitType = input.commitType;
  if (!CONVENTIONAL_COMMIT_TYPES.has(commitType)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `commit type '${commitType}' is not a recognised tag`,
    );
  }
  if (input.writeScope.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", `task ${input.taskId} has no write scope to commit`);
  }
  const runner = input.runner ?? runGit;
  const subject = buildSubject(commitType, input.label);
  const sha = stageAndCommit(input.worktreePath, input.writeScope.map(toPathspec), subject, runner);
  if (sha === null) return { committed: false };
  const changedLines = commitChangedLines(input.worktreePath, sha, runner);
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

export function recordWorktreeCommit(
  runRoot: string,
  actor: string,
  taskId: string,
  commit: WorktreeCommitRecord,
  transactFn: typeof transact = transact,
): void {
  transactFn(
    runRoot,
    actor,
    "worktree-subphase-committed",
    { task_id: taskId, sha: commit.sha },
    (draft) => {
      const ledger = readWorktreeLedger(draft);
      if (!ledger)
        throw new HarnessError("INVALID_STATE", "no worktree ledger to record a commit against");
      writeWorktreeLedger(draft, { ...ledger, commits: [...ledger.commits, commit] });
      const tasks = draft.tasks;
      if (!isJsonObject(tasks) || !isJsonObject(tasks[taskId])) {
        throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId}`);
      }
      tasks[taskId].worktree_commit = commit;
    },
  );
}
