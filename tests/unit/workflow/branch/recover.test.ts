import { describe, expect, test } from "bun:test";
import { recoverBranchSubTasks } from "../../../../olt/scripts/src/workflow/branch/recover.ts";
import {
  BRANCH_LEDGER_KEY,
  readBranchLedger,
} from "../../../../olt/scripts/src/workflow/branch/ledger.ts";
import type { JsonObject } from "../../../../olt/scripts/src/contracts/json.ts";
import type { BranchLease } from "../../../../olt/scripts/src/contracts/branch.ts";
import { branchRecord, subTask } from "./fixture.ts";

function lease(overrides: Partial<BranchLease> = {}): BranchLease {
  return {
    agent_id: "agent-1",
    token_digest: "digest",
    issued_at: "2026-08-19T00:00:00.000Z",
    expires_at: "2026-08-19T00:10:00.000Z",
    duration_seconds: 600,
    ...overrides,
  };
}

const NOW = new Date("2026-08-19T00:20:00.000Z");

describe("recoverBranchSubTasks", () => {
  test("returns no recoveries and leaves the draft untouched when the ledger is empty", () => {
    const draft: JsonObject = {};
    expect(recoverBranchSubTasks(draft, NOW, 0)).toEqual([]);
    expect(draft[BRANCH_LEDGER_KEY]).toBeUndefined();
  });

  test("ignores sub-tasks on branches that are not open or collecting", () => {
    const branch = branchRecord({
      status: "collected",
      sub_tasks: [subTask({ status: "claimed", agent_id: "agent-1", lease: lease() })],
    });
    const draft: JsonObject = { [BRANCH_LEDGER_KEY]: [branch] as unknown as JsonObject[] };
    expect(recoverBranchSubTasks(draft, NOW, 0)).toEqual([]);
  });

  test("ignores a sub-task with no lease, and one that is not claimed", () => {
    const branch = branchRecord({
      sub_tasks: [
        subTask({ id: "ST-open", status: "open" }),
        subTask({ id: "ST-submitted", status: "submitted", agent_id: "agent-1" }),
      ],
    });
    const draft: JsonObject = { [BRANCH_LEDGER_KEY]: [branch] as unknown as JsonObject[] };
    expect(recoverBranchSubTasks(draft, NOW, 0)).toEqual([]);
  });

  test("ignores a claimed sub-task whose lease has not expired", () => {
    const branch = branchRecord({
      sub_tasks: [
        subTask({
          status: "claimed",
          agent_id: "agent-1",
          lease: lease({ expires_at: "2026-08-19T00:30:00.000Z" }),
        }),
      ],
    });
    const draft: JsonObject = { [BRANCH_LEDGER_KEY]: [branch] as unknown as JsonObject[] };
    expect(recoverBranchSubTasks(draft, NOW, 0)).toEqual([]);
  });

  test("recovers an expired claimed sub-task: clears the lease and agent, reopens it, and records the recovery", () => {
    const branch = branchRecord({
      id: "B-1",
      sub_tasks: [subTask({ id: "ST-1", status: "claimed", agent_id: "agent-1", lease: lease() })],
    });
    const draft: JsonObject = { [BRANCH_LEDGER_KEY]: [branch] as unknown as JsonObject[] };
    const recovered = recoverBranchSubTasks(draft, NOW, 0);
    expect(recovered).toEqual([
      { branch_id: "B-1", sub_task_id: "ST-1", expired_agent_id: "agent-1" },
    ]);
    const stored = readBranchLedger(draft)[0]!;
    const st = stored.sub_tasks[0]!;
    expect(st.status).toBe("open");
    expect(st.lease).toBeUndefined();
    expect(st.agent_id).toBeUndefined();
    expect(st.recovery).toEqual({
      recovered_at: NOW.toISOString(),
      expired_agent_id: "agent-1",
      expired_at: "2026-08-19T00:10:00.000Z",
    });
  });

  test("honours the grace period before treating a lease as expired", () => {
    const branch = branchRecord({
      sub_tasks: [
        subTask({
          status: "claimed",
          agent_id: "agent-1",
          lease: lease({ expires_at: "2026-08-19T00:19:00.000Z" }),
        }),
      ],
    });
    const draft: JsonObject = { [BRANCH_LEDGER_KEY]: [branch] as unknown as JsonObject[] };
    // 1 minute past expiry, but a 2 minute grace period should still protect it
    expect(recoverBranchSubTasks(draft, NOW, 120_000)).toEqual([]);
  });

  test("recovers multiple expired sub-tasks across multiple open branches", () => {
    const branchA = branchRecord({
      id: "B-1",
      sub_tasks: [subTask({ id: "ST-1", status: "claimed", agent_id: "agent-1", lease: lease() })],
    });
    const branchB = branchRecord({
      id: "B-2",
      parent_task_id: "T-2",
      sub_tasks: [
        subTask({
          id: "ST-2",
          status: "claimed",
          agent_id: "agent-2",
          lease: lease({ agent_id: "agent-2" }),
        }),
      ],
    });
    const draft: JsonObject = {
      [BRANCH_LEDGER_KEY]: [branchA, branchB] as unknown as JsonObject[],
    };
    const recovered = recoverBranchSubTasks(draft, NOW, 0);
    expect(recovered).toEqual([
      { branch_id: "B-1", sub_task_id: "ST-1", expired_agent_id: "agent-1" },
      { branch_id: "B-2", sub_task_id: "ST-2", expired_agent_id: "agent-2" },
    ]);
  });
});
