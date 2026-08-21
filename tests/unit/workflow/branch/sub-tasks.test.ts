import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import {
  claimSubTask,
  submitSubTask,
} from "../../../../orchestrating-long-tasks/scripts/src/workflow/branch/sub-tasks.ts";
import { readBranchLedger } from "../../../../orchestrating-long-tasks/scripts/src/workflow/branch/ledger.ts";
import { tokenDigest } from "../../../../orchestrating-long-tasks/scripts/src/workflow/lease/token.ts";
import { branchRecord, subTask } from "./fixture.ts";
import { freshRunRoot, seedBranchLedger } from "./store-fixture.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function trackedRunRoot(prefix: string): string {
  const run = freshRunRoot(prefix);
  roots.push(run.split("/.capsules/")[0]!);
  return run;
}

describe("claimSubTask", () => {
  test("rejects a lease duration outside the 5s-86400s window", () => {
    const runRoot = trackedRunRoot("claim-bad-lease");
    expect(() =>
      claimSubTask({
        runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "a",
        actor: "a",
        leaseSeconds: 1,
      }),
    ).toThrow(/lease_seconds must be an integer from 5 to 86400/);
    expect(() =>
      claimSubTask({
        runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "a",
        actor: "a",
        leaseSeconds: 100_000,
      }),
    ).toThrow(/lease_seconds must be an integer from 5 to 86400/);
    expect(() =>
      claimSubTask({
        runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "a",
        actor: "a",
        leaseSeconds: 5.5,
      }),
    ).toThrow(/lease_seconds must be an integer from 5 to 86400/);
  });

  test("rejects claiming on a branch that is not open (collecting/collected/abandoned)", () => {
    const runRoot = trackedRunRoot("claim-not-open");
    seedBranchLedger(runRoot, [branchRecord({ id: "B-1", status: "collecting" })]);
    expect(() =>
      claimSubTask({
        runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "a",
        actor: "a",
        leaseSeconds: 60,
      }),
    ).toThrow(/branch B-1 is collecting, not open/);
  });

  test("rejects claiming a sub-task that is not open", () => {
    const runRoot = trackedRunRoot("claim-not-open-subtask");
    seedBranchLedger(runRoot, [
      branchRecord({
        id: "B-1",
        status: "open",
        sub_tasks: [subTask({ id: "ST-1", status: "claimed" })],
      }),
    ]);
    expect(() =>
      claimSubTask({
        runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "a",
        actor: "a",
        leaseSeconds: 60,
      }),
    ).toThrow(/sub-task ST-1 is claimed and cannot be claimed/);
  });

  test("claims an open sub-task, issuing a lease and token that can be verified against the stored digest", () => {
    const runRoot = trackedRunRoot("claim-happy");
    seedBranchLedger(runRoot, [
      branchRecord({
        id: "B-1",
        status: "open",
        sub_tasks: [subTask({ id: "ST-1", status: "open" })],
      }),
    ]);
    const now = new Date("2026-08-19T00:00:00.000Z");
    const outcome = claimSubTask({
      runRoot,
      branchId: "B-1",
      subTaskId: "ST-1",
      agentId: "agent-1",
      actor: "agent-1",
      leaseSeconds: 600,
      now,
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

describe("submitSubTask", () => {
  test("rejects a blank summary", () => {
    const runRoot = trackedRunRoot("submit-blank-summary");
    expect(() =>
      submitSubTask({
        runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "a",
        token: "tok",
        actor: "a",
        summary: "  ",
      }),
    ).toThrow(/summary must be non-blank text/);
  });

  test("rejects submitting on a branch that is not open", () => {
    const runRoot = trackedRunRoot("submit-not-open");
    seedBranchLedger(runRoot, [branchRecord({ id: "B-1", status: "collected" })]);
    expect(() =>
      submitSubTask({
        runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "a",
        token: "tok",
        actor: "a",
        summary: "done",
      }),
    ).toThrow(/branch B-1 is collected, not open/);
  });

  test("rejects submitting a sub-task that is not claimed or holds no lease", () => {
    const runRoot = trackedRunRoot("submit-not-claimed");
    seedBranchLedger(runRoot, [
      branchRecord({
        id: "B-1",
        status: "open",
        sub_tasks: [subTask({ id: "ST-1", status: "open" })],
      }),
    ]);
    expect(() =>
      submitSubTask({
        runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "a",
        token: "tok",
        actor: "a",
        summary: "done",
      }),
    ).toThrow(/sub-task ST-1 is open and holds no submittable lease/);
  });

  test("rejects a mismatched agent id or token", () => {
    const runRoot = trackedRunRoot("submit-bad-token");
    const token = "correct-token";
    seedBranchLedger(runRoot, [
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
        runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "agent-2",
        token,
        actor: "a",
        summary: "done",
      }),
    ).toThrow(/lease identity or token is invalid/);
    expect(() =>
      submitSubTask({
        runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "agent-1",
        token: "wrong",
        actor: "a",
        summary: "done",
      }),
    ).toThrow(/lease identity or token is invalid/);
  });

  test("rejects submitting once the (non-suspended) lease has expired", () => {
    const runRoot = trackedRunRoot("submit-expired");
    const token = "correct-token";
    seedBranchLedger(runRoot, [
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
        runRoot,
        branchId: "B-1",
        subTaskId: "ST-1",
        agentId: "agent-1",
        token,
        actor: "a",
        summary: "done",
        now: new Date("2026-08-19T01:00:00.000Z"),
      }),
    ).toThrow(/lease has expired/);
  });

  test("submits a claimed sub-task, clearing the lease and recording the summary", () => {
    const runRoot = trackedRunRoot("submit-happy");
    const token = "correct-token";
    seedBranchLedger(runRoot, [
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
      runRoot,
      branchId: "B-1",
      subTaskId: "ST-1",
      agentId: "agent-1",
      token,
      actor: "agent-1",
      summary: "did the thing",
      now,
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
    const runRoot = trackedRunRoot("submit-suspended");
    const token = "correct-token";
    seedBranchLedger(runRoot, [
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
      runRoot,
      branchId: "B-1",
      subTaskId: "ST-1",
      agentId: "agent-1",
      token,
      actor: "agent-1",
      summary: "still fine",
      now: new Date("2026-08-19T02:00:00.000Z"),
    });
    expect(outcome.ledger[0]!.sub_tasks[0]!.status).toBe("submitted");
  });
});
