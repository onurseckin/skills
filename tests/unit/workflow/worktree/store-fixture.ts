import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorktreeLedgerState } from "../../../../orchestrating-long-tasks/scripts/src/contracts/worktree.ts";
import { initRun } from "../../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { transact } from "../../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";
import { writeWorktreeLedger } from "../../../../orchestrating-long-tasks/scripts/src/workflow/worktree/ledger.ts";

export function scratchRepo(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `harness-${prefix}-`));
}

export function freshRunRoot(prefix: string): string {
  const repo = scratchRepo(prefix);
  return initRun(repo, `${prefix}-run`, new TextEncoder().encode("prompt"), "file", true);
}

export function seedLedger(runRoot: string, ledger: WorktreeLedgerState): void {
  transact(runRoot, "tester", "worktrees-seeded", {}, (draft) => {
    writeWorktreeLedger(draft, ledger);
  });
}

export function seedTask(runRoot: string, taskId: string): void {
  transact(runRoot, "tester", "task-seeded", { task_id: taskId }, (draft) => {
    (draft as typeof draft & { tasks: Record<string, unknown> }).tasks = {
      ...(draft as unknown as { tasks?: Record<string, unknown> }).tasks,
      [taskId]: { status: "claimed" },
    };
  });
}

export function baseLedger(overrides: Partial<WorktreeLedgerState> = {}): WorktreeLedgerState {
  return {
    harness_branch: "harness/run-1",
    base_sha: "base-sha",
    root: "/tmp/worktree-root",
    worktrees: [],
    assignments: [],
    commits: [],
    ...overrides,
  };
}
