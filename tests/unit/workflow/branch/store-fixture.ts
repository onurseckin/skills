import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BranchRecord } from "../../../../orchestrating-long-tasks/scripts/src/contracts/branch.ts";
import { initRun } from "../../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { transact } from "../../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";
import { writeBranchLedger } from "../../../../orchestrating-long-tasks/scripts/src/workflow/branch/ledger.ts";

export function scratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `harness-${prefix}-`));
}

export function freshRunRoot(prefix: string): string {
  const repo = scratchDir(prefix);
  return initRun(repo, `${prefix}-run`, new TextEncoder().encode("prompt"), "file", true);
}

export function seedBranchLedger(runRoot: string, branches: readonly BranchRecord[]): void {
  transact(runRoot, "tester", "branches-seeded", {}, (draft) => {
    writeBranchLedger(draft, branches);
  });
}

export function seedTask(
  runRoot: string,
  taskId: string,
  overrides: Record<string, unknown> = {},
): void {
  transact(runRoot, "tester", "task-seeded", { task_id: taskId }, (draft) => {
    (draft as typeof draft & { tasks: Record<string, unknown> }).tasks = {
      ...(draft as unknown as { tasks?: Record<string, unknown> }).tasks,
      [taskId]: {
        id: taskId,
        status: "running",
        requirement_ids: [],
        write_scope: ["src/a"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
        ...overrides,
      },
    };
  });
}
