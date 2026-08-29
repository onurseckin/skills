import type { BranchRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { JsonObject } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { transact } from "../../../../olt/scripts/src/engine/store/transaction.ts";
import { writeBranchLedger } from "../../../../olt/scripts/src/workflow/branch/ledger.ts";

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
  public transact: typeof transact = (_runRoot, actor, kind, payload, mutate) => {
    const draft = structuredClone(this.state);
    mutate(draft);
    this.events.push({ actor, kind, payload: structuredClone(payload) });
    this.state = draft;
    return this.read();
  };
}

export function seedBranchLedger(store: FakeRunStore, branches: readonly BranchRecord[]): void {
  store.transact(store.runRoot, "tester", "branches-seeded", {}, (draft) => {
    writeBranchLedger(draft, branches);
  });
}

export function seedTask(
  store: FakeRunStore,
  taskId: string,
  overrides: Record<string, unknown> = {},
): void {
  store.transact(store.runRoot, "tester", "task-seeded", { task_id: taskId }, (draft) => {
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
