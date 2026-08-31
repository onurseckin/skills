import { describe, expect, test } from "bun:test";
import {
  claimSubTask,
  submitSubTask,
} from "../../../../olt/scripts/src/workflow/branch/sub-tasks.ts";
import { readBranchLedger } from "../../../../olt/scripts/src/workflow/branch/ledger.ts";
import { tokenDigest } from "../../../../olt/scripts/src/workflow/lease/token.ts";
import { branchRecord, subTask } from "../fixtures/fixture.ts";
import { FakeRunStore, seedBranchLedger } from "../fixtures/fake-transact.ts";

describe("claimSubTask", () => {
  test("rejects a lease duration outside the 5s-86400s window", () => {
    const store = new FakeRunStore();
    expect(() =>
      claimSubTask({
        runRoot: store.runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "a",
        actor: "a",
        leaseSeconds: 1,
        transact: store.transact,
      }),
    ).toThrow(/lease_seconds must be an integer from 5 to 86400/);
    expect(() =>
      claimSubTask({
        runRoot: store.runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "a",
        actor: "a",
        leaseSeconds: 100_000,
        transact: store.transact,
      }),
    ).toThrow(/lease_seconds must be an integer from 5 to 86400/);
    expect(() =>
      claimSubTask({
        runRoot: store.runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "a",
        actor: "a",
        leaseSeconds: 5.5,
        transact: store.transact,
      }),
    ).toThrow(/lease_seconds must be an integer from 5 to 86400/);
  });

  test("rejects claiming on a branch that is not open (collecting/collected/abandoned)", () => {
    const store = new FakeRunStore();
    seedBranchLedger(store, [branchRecord({ id: "B-1", status: "collecting" })]);
    expect(() =>
      claimSubTask({
        runRoot: store.runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "a",
        actor: "a",
        leaseSeconds: 60,
        transact: store.transact,
      }),
    ).toThrow(/branch B-1 is collecting, not open/);
  });

  test("rejects claiming a sub-task that is not open", () => {
    const store = new FakeRunStore();
    seedBranchLedger(store, [
      branchRecord({
        id: "B-1",
        status: "open",
        sub_tasks: [subTask({ id: "ST-1", status: "claimed" })],
      }),
    ]);
    expect(() =>
      claimSubTask({
        runRoot: store.runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "a",
        actor: "a",
        leaseSeconds: 60,
        transact: store.transact,
      }),
    ).toThrow(/sub-task ST-1 is claimed and cannot be claimed/);
  });

  test("claims an open sub-task, issuing a lease and token that can be verified against the stored digest", () => {
    const store = new FakeRunStore();
    seedBranchLedger(store, [
      branchRecord({
        id: "B-1",
        status: "open",
        sub_tasks: [subTask({ id: "ST-1", status: "open" })],
      }),
    ]);
    const now = new Date("2026-08-19T00:00:00.000Z");
    const outcome = claimSubTask({
      runRoot: store.runRoot,
      branchId: "B-1",
      subTaskId: "ST-1",
      agentId: "agent-1",
      actor: "agent-1",
      leaseSeconds: 600,
      now,
      transact: store.transact,
    });
    expect(outcome.token).toBeTruthy();
    expect(outcome.branch.id).toBe("B-1");
    const st = outcome.ledger[0]!.sub_tasks[0]!;
    expect(st.status).toBe("claimed");
    expect(st.agent_id).toBe("agent-1");
    expect(st.lease?.token_digest).toBe(tokenDigest(outcome.token));
    expect(st.lease?.expires_at).toBe(new Date(now.valueOf() + 600_000).toISOString());
  });
});
