import { describe, expect, test } from "bun:test";
import {
  claimSubTask,
  submitSubTask,
} from "../../../../olt/scripts/src/workflow/branch/sub-tasks.ts";
import { readBranchLedger } from "../../../../olt/scripts/src/workflow/branch/ledger.ts";
import { tokenDigest } from "../../../../olt/scripts/src/workflow/lease/token.ts";
import { branchRecord, subTask } from "../fixtures/fixture.ts";
import { FakeRunStore, seedBranchLedger } from "../fixtures/fake-transact.ts";

describe("submitSubTask", () => {
  test("rejects a blank summary", () => {
    const store = new FakeRunStore();
    expect(() =>
      submitSubTask({
        runRoot: store.runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "a",
        token: "tok",
        actor: "a",
        summary: "  ",
        transact: store.transact,
      }),
    ).toThrow(/summary must be non-blank text/);
  });

  test("rejects submitting on a branch that is not open", () => {
    const store = new FakeRunStore();
    seedBranchLedger(store, [branchRecord({ id: "B-1", status: "collected" })]);
    expect(() =>
      submitSubTask({
        runRoot: store.runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "a",
        token: "tok",
        actor: "a",
        summary: "done",
        transact: store.transact,
      }),
    ).toThrow(/branch B-1 is collected, not open/);
  });

  test("rejects submitting a sub-task that is not claimed or holds no lease", () => {
    const store = new FakeRunStore();
    seedBranchLedger(store, [
      branchRecord({
        id: "B-1",
        status: "open",
        sub_tasks: [subTask({ id: "ST-1", status: "open" })],
      }),
    ]);
    expect(() =>
      submitSubTask({
        runRoot: store.runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "a",
        token: "tok",
        actor: "a",
        summary: "done",
        transact: store.transact,
      }),
    ).toThrow(/sub-task ST-1 is open and holds no submittable lease/);
  });

  test("rejects a mismatched agent id or token", () => {
    const store = new FakeRunStore();
    const token = "correct-token";
    seedBranchLedger(store, [
      branchRecord({
        id: "B-1",
        status: "open",
        sub_tasks: [
          subTask({
            id: "ST-1",
            status: "claimed",
            agent_id: "agent-1",
            lease: {
              agent_id: "agent-1",
              token_digest: tokenDigest(token),
              issued_at: "t",
              expires_at: "2026-08-19T01:00:00.000Z",
              duration_seconds: 600,
            },
          }),
        ],
      }),
    ]);
    expect(() =>
      submitSubTask({
        runRoot: store.runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "agent-2",
        token,
        actor: "a",
        summary: "done",
        transact: store.transact,
      }),
    ).toThrow(/lease identity or token is invalid/);
    expect(() =>
      submitSubTask({
        runRoot: store.runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "agent-1",
        token: "wrong",
        actor: "a",
        summary: "done",
        transact: store.transact,
      }),
    ).toThrow(/lease identity or token is invalid/);
  });

  test("rejects submitting once the (non-suspended) lease has expired", () => {
    const store = new FakeRunStore();
    const token = "correct-token";
    seedBranchLedger(store, [
      branchRecord({
        id: "B-1",
        status: "open",
        sub_tasks: [
          subTask({
            id: "ST-1",
            status: "claimed",
            agent_id: "agent-1",
            lease: {
              agent_id: "agent-1",
              token_digest: tokenDigest(token),
              issued_at: "t",
              expires_at: "2026-08-19T00:00:00.000Z",
              duration_seconds: 600,
            },
          }),
        ],
      }),
    ]);
    expect(() =>
      submitSubTask({
        runRoot: store.runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "agent-1",
        token,
        actor: "a",
        summary: "done",
        now: new Date("2026-08-19T01:00:00.000Z"),
        transact: store.transact,
      }),
    ).toThrow(/lease has expired/);
  });

  test("submits a claimed sub-task, clearing the lease and recording the summary", () => {
    const store = new FakeRunStore();
    const token = "correct-token";
    seedBranchLedger(store, [
      branchRecord({
        id: "B-1",
        status: "open",
        sub_tasks: [
          subTask({
            id: "ST-1",
            status: "claimed",
            agent_id: "agent-1",
            lease: {
              agent_id: "agent-1",
              token_digest: tokenDigest(token),
              issued_at: "t",
              expires_at: "2026-08-19T01:00:00.000Z",
              duration_seconds: 600,
            },
          }),
        ],
      }),
    ]);
    const now = new Date("2026-08-19T00:30:00.000Z");
    const outcome = submitSubTask({
      runRoot: store.runRoot,
      branchId: "B-1",
      subTaskId: "ST-1",
      agentId: "agent-1",
      token,
      actor: "agent-1",
      summary: "did the thing",
      now,
      transact: store.transact,
    });
    const st = outcome.ledger[0]!.sub_tasks[0]!;
    expect(st.status).toBe("submitted");
    expect(st.summary).toBe("did the thing");
    expect(st.lease).toBeUndefined();
    expect(st.submitted_at).toBe(now.toISOString());
    const reread = readBranchLedger(outcome.state)[0]!;
    expect(reread.sub_tasks[0]!.status).toBe("submitted");
  });

  test("accepts submitting against a suspended (clock-paused) lease even past its recorded expiry", () => {
    const store = new FakeRunStore();
    const token = "correct-token";
    seedBranchLedger(store, [
      branchRecord({
        id: "B-1",
        status: "open",
        sub_tasks: [
          subTask({
            id: "ST-1",
            status: "claimed",
            agent_id: "agent-1",
            lease: {
              agent_id: "agent-1",
              token_digest: tokenDigest(token),
              issued_at: "t",
              expires_at: "2026-08-19T00:00:00.000Z",
              duration_seconds: 600,
              suspended_at: "2026-08-19T00:05:00.000Z",
            },
          }),
        ],
      }),
    ]);
    const outcome = submitSubTask({
      runRoot: store.runRoot,
      branchId: "B-1",
      subTaskId: "ST-1",
      agentId: "agent-1",
      token,
      actor: "agent-1",
      summary: "still fine",
      now: new Date("2026-08-19T02:00:00.000Z"),
      transact: store.transact,
    });
    expect(outcome.ledger[0]!.sub_tasks[0]!.status).toBe("submitted");
  });
});
