import { describe, expect, test } from "bun:test";
import { recoverSuspendedChains } from "../../../olt/scripts/src/workflow/branch/chain-recovery.ts";
import {
  BRANCH_LEDGER_KEY,
  readBranchLedger,
} from "../../../olt/scripts/src/workflow/branch/ledger.ts";
import { branchRecord, subTask } from "./fixture.ts";
import { draftWithTask, scopedLease, taskRecord } from "./task-fixture.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { BranchRecord } from "../../../olt/scripts/src/core/contracts/index.ts";

const NOW = new Date("2026-08-19T02:00:00.000Z");

function draftWith(task: ReturnType<typeof taskRecord>, branches: BranchRecord[]): JsonObject {
  const draft = draftWithTask(task);
  draft[BRANCH_LEDGER_KEY] = branches as unknown as JsonObject[];
  return draft;
}

describe("recoverSuspendedChains", () => {
  test("returns nothing when the branch ledger is empty", () => {
    expect(recoverSuspendedChains({}, "coordinator", NOW, 0)).toEqual([]);
  });

  test("ignores branches that are already terminal (collected/abandoned)", () => {
    const task = taskRecord({
      status: "branched",
      lease: scopedLease({ suspended_at: "2026-08-19T00:00:00.000Z", duration_seconds: 60 }),
    });
    const branch = branchRecord({
      status: "collected",
      parent_task_id: "T-1",
      opened_at: "2026-08-19T00:00:00.000Z",
    });
    expect(recoverSuspendedChains(draftWith(task, [branch]), "coordinator", NOW, 0)).toEqual([]);
  });

  test("skips a branch that still has active work: a branched sub-task", () => {
    const task = taskRecord({
      status: "branched",
      lease: scopedLease({ suspended_at: "2026-08-19T00:00:00.000Z", duration_seconds: 60 }),
    });
    const branch = branchRecord({
      parent_task_id: "T-1",
      opened_at: "2026-08-19T00:00:00.000Z",
      sub_tasks: [subTask({ status: "branched" })],
    });
    expect(recoverSuspendedChains(draftWith(task, [branch]), "coordinator", NOW, 0)).toEqual([]);
  });

  test("skips a branch with a claimed sub-task whose lease has not expired", () => {
    const task = taskRecord({
      status: "branched",
      lease: scopedLease({ suspended_at: "2026-08-19T00:00:00.000Z", duration_seconds: 60 }),
    });
    const branch = branchRecord({
      parent_task_id: "T-1",
      opened_at: "2026-08-19T00:00:00.000Z",
      sub_tasks: [
        subTask({
          status: "claimed",
          lease: {
            agent_id: "a",
            token_digest: "d",
            issued_at: "t",
            expires_at: "2026-08-19T03:00:00.000Z",
            duration_seconds: 60,
          },
        }),
      ],
    });
    expect(recoverSuspendedChains(draftWith(task, [branch]), "coordinator", NOW, 0)).toEqual([]);
  });

  test("skips a branch whose parent cannot be resolved at all", () => {
    const branch = branchRecord({
      parent_task_id: "ghost-parent",
      opened_at: "2026-08-19T00:00:00.000Z",
    });
    const draft: JsonObject = {
      tasks: {},
      [BRANCH_LEDGER_KEY]: [branch] as unknown as JsonObject[],
    };
    expect(recoverSuspendedChains(draft, "coordinator", NOW, 0)).toEqual([]);
  });

  test("skips a branch whose parent lease is not suspended", () => {
    const task = taskRecord({ status: "running", lease: scopedLease() }); // not suspended
    const branch = branchRecord({ parent_task_id: "T-1", opened_at: "2026-08-19T00:00:00.000Z" });
    expect(recoverSuspendedChains(draftWith(task, [branch]), "coordinator", NOW, 0)).toEqual([]);
  });

  test("skips a branch whose parent holds no lease at all", () => {
    const task = taskRecord({ status: "branched" }); // no lease field
    const branch = branchRecord({ parent_task_id: "T-1", opened_at: "2026-08-19T00:00:00.000Z" });
    expect(recoverSuspendedChains(draftWith(task, [branch]), "coordinator", NOW, 0)).toEqual([]);
  });

  test("skips a branch whose parent lease has no usable positive duration", () => {
    const task = taskRecord({
      status: "branched",
      lease: scopedLease({ suspended_at: "2026-08-19T00:00:00.000Z", duration_seconds: 0 }),
    });
    const branch = branchRecord({ parent_task_id: "T-1", opened_at: "2026-08-19T00:00:00.000Z" });
    expect(recoverSuspendedChains(draftWith(task, [branch]), "coordinator", NOW, 0)).toEqual([]);
  });

  test("skips a branch whose grace window since last activity has not yet elapsed", () => {
    const task = taskRecord({
      status: "branched",
      lease: scopedLease({ suspended_at: "2026-08-19T00:00:00.000Z", duration_seconds: 3600 }),
    });
    // opened 30 min ago; duration is 1h, so it isn't due for reclaim yet
    const branch = branchRecord({ parent_task_id: "T-1", opened_at: "2026-08-19T01:30:00.000Z" });
    expect(recoverSuspendedChains(draftWith(task, [branch]), "coordinator", NOW, 0)).toEqual([]);
  });

  test("reclaims an abandoned branch off a suspended task parent: closes the branch, retries the task, and reports the link", () => {
    const task = taskRecord({
      id: "T-1",
      status: "branched",
      lease: scopedLease({
        agent_id: "agent-dead",
        suspended_at: "2026-08-19T00:00:00.000Z",
        duration_seconds: 60,
      }),
    });
    const branch = branchRecord({
      id: "B-1",
      parent_task_id: "T-1",
      parent_agent_id: "agent-dead",
      depth: 1,
      opened_at: "2026-08-19T00:00:00.000Z",
      sub_tasks: [subTask({ id: "ST-1", status: "open" })],
    });
    const draft = draftWith(task, [branch]);
    const reclaimed = recoverSuspendedChains(draft, "coordinator", NOW, 0);
    expect(reclaimed).toEqual([
      { branch_id: "B-1", parent_id: "T-1", parent_kind: "task", dead_agent_id: "agent-dead" },
    ]);
    expect(task.status).toBe("retry_ready");
    expect(task.lease).toBeUndefined();
    expect(task.attempts).toEqual([]);
    const storedBranch = readBranchLedger(draft)[0]!;
    expect(storedBranch.status).toBe("abandoned");
    expect(storedBranch.sub_tasks[0]!.status).toBe("abandoned");
    expect(storedBranch.outcome_summary).toContain(
      "agent-dead never returned to collect branch B-1",
    );
  });

  test("marks a repair attempt's most recent entry stale and returns the task to changes_requested", () => {
    const task = taskRecord({
      id: "T-1",
      status: "branched",
      lease: scopedLease({
        agent_id: "agent-dead",
        token_digest: "digest-1",
        suspended_at: "2026-08-19T00:00:00.000Z",
        duration_seconds: 60,
      }),
      attempts: [{ kind: "repair", role: "implementer" }],
    });
    const branch = branchRecord({
      id: "B-1",
      parent_task_id: "T-1",
      opened_at: "2026-08-19T00:00:00.000Z",
    });
    const draft = draftWith(task, [branch]);
    recoverSuspendedChains(draft, "coordinator", NOW, 0);
    expect(task.status).toBe("changes_requested");
    const attempt = task.attempts.at(-1)!;
    expect(attempt.stale_at).toBe(NOW.toISOString());
    expect(attempt.result).toBe("stale");
    expect(attempt.expired_agent_id).toBe("agent-dead");
    expect(attempt.expired_token_digest).toBe("digest-1");
  });

  test("reclaims a sub-task parent: records a recovery, reopens the sub-task, and reports parent_kind sub_task", () => {
    const grandparentSubTask = subTask({
      id: "ST-parent",
      status: "branched",
      lease: {
        agent_id: "agent-dead",
        token_digest: "d",
        issued_at: "t",
        expires_at: "e",
        duration_seconds: 60,
        suspended_at: "2026-08-19T00:00:00.000Z",
      },
    });
    const parentBranch = branchRecord({
      id: "B-parent",
      depth: 1,
      parent_task_id: "T-1",
      sub_tasks: [grandparentSubTask],
    });
    const childBranch = branchRecord({
      id: "B-child",
      depth: 2,
      parent_task_id: "ST-parent",
      opened_at: "2026-08-19T00:00:00.000Z",
    });
    const draft: JsonObject = {
      tasks: {},
      [BRANCH_LEDGER_KEY]: [parentBranch, childBranch] as unknown as JsonObject[],
    };
    const reclaimed = recoverSuspendedChains(draft, "coordinator", NOW, 0);
    expect(reclaimed).toEqual([
      {
        branch_id: "B-child",
        parent_id: "ST-parent",
        parent_kind: "sub_task",
        dead_agent_id: "agent-dead",
      },
    ]);
    const stored = readBranchLedger(draft);
    const storedParentSubTask = stored.find((b) => b.id === "B-parent")!.sub_tasks[0]!;
    expect(storedParentSubTask.status).toBe("open");
    expect(storedParentSubTask.lease).toBeUndefined();
    expect(storedParentSubTask.recovery).toEqual({
      recovered_at: NOW.toISOString(),
      expired_agent_id: "agent-dead",
      expired_at: "e",
    });
  });

  test("uses the latest sub-task activity timestamp, not just opened_at, to gate the reclaim window", () => {
    const task = taskRecord({
      id: "T-1",
      status: "branched",
      lease: scopedLease({
        agent_id: "agent-dead",
        suspended_at: "2026-08-19T00:00:00.000Z",
        duration_seconds: 60,
      }),
    });
    // opened long ago, but a sub-task was submitted 30s before "now" — that recent activity
    // should be what the grace window is measured from, not the stale opened_at.
    const branch = branchRecord({
      id: "B-1",
      parent_task_id: "T-1",
      opened_at: "2026-01-01T00:00:00.000Z",
      sub_tasks: [
        subTask({ id: "ST-1", status: "submitted", submitted_at: "2026-08-19T01:59:30.000Z" }),
      ],
    });
    expect(recoverSuspendedChains(draftWith(task, [branch]), "coordinator", NOW, 0)).toEqual([]);
  });

  test("processes deepest branches first, each against its own independent parent", () => {
    const parentLease = () =>
      scopedLease({
        agent_id: "agent-dead",
        suspended_at: "2026-08-19T00:00:00.000Z",
        duration_seconds: 60,
      });
    const draft: JsonObject = {
      tasks: {
        "T-1": taskRecord({
          id: "T-1",
          status: "branched",
          lease: parentLease(),
        }) as unknown as JsonObject,
        "T-2": taskRecord({
          id: "T-2",
          status: "branched",
          lease: parentLease(),
        }) as unknown as JsonObject,
        "T-3": taskRecord({
          id: "T-3",
          status: "branched",
          lease: parentLease(),
        }) as unknown as JsonObject,
      },
      [BRANCH_LEDGER_KEY]: [
        branchRecord({
          id: "B-shallow",
          depth: 1,
          parent_task_id: "T-1",
          opened_at: "2026-08-19T00:00:00.000Z",
        }),
        branchRecord({
          id: "B-deep",
          depth: 3,
          parent_task_id: "T-3",
          opened_at: "2026-08-19T00:00:00.000Z",
        }),
        branchRecord({
          id: "B-mid",
          depth: 2,
          parent_task_id: "T-2",
          opened_at: "2026-08-19T00:00:00.000Z",
        }),
      ] as unknown as JsonObject[],
    };
    const reclaimed = recoverSuspendedChains(draft, "coordinator", NOW, 0);
    expect(reclaimed.map((r) => r.branch_id)).toEqual(["B-deep", "B-mid", "B-shallow"]);
  });
});
