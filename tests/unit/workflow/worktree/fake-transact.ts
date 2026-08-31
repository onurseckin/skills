import type { JsonObject } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import type { WorktreeLedgerState } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { writeWorktreeLedger } from "../../../../olt/scripts/src/workflow/worktree/ledger.ts";

export const FAKE_RUN_ROOT = "fake-run-root";

function freshRunState(): RunState {
  return {
    schema: "harness.state",
    version: 1,
    revision: 0,
    event_sequence: 0,
    event_head: null,
  };
}

export class FakeRunStore {
  public readonly runRoot = FAKE_RUN_ROOT;
  public readonly events: { actor: string; kind: string; payload: JsonObject }[] = [];
  private state: RunState;
  public constructor(state: RunState = freshRunState()) {
    this.state = state;
  }
  public read(): RunState {
    return structuredClone(this.state);
  }
  public loadState = (_runRoot: string): RunState => this.read();
  public transact: typeof transact = (_runRoot, actor, kind, payload, mutate) => {
    const draft = structuredClone(this.state);
    mutate(draft);
    this.events.push({ actor, kind, payload: structuredClone(payload) });
    this.state = draft;
    return this.read();
  };
}

export function seedLedger(store: FakeRunStore, ledger: WorktreeLedgerState): void {
  store.transact(store.runRoot, "tester", "worktrees-seeded", {}, (draft) => {
    writeWorktreeLedger(draft, ledger);
  });
}

export function seedTask(store: FakeRunStore, taskId: string): void {
  store.transact(store.runRoot, "tester", "task-seeded", { task_id: taskId }, (draft) => {
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
