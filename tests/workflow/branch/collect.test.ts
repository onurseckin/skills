import { describe, expect, test } from "bun:test";
import {
  abandonBranch,
  collectBranch,
} from "../../../../olt/scripts/src/workflow/branch/collect.ts";
import { readBranchLedger } from "../../../../olt/scripts/src/workflow/branch/ledger.ts";
import { tokenDigest } from "../../../../olt/scripts/src/workflow/lease/token.ts";
import { branchRecord, subTask } from "./fixture.ts";
import { FakeRunStore, seedBranchLedger, seedTask } from "./fake-transact.ts";

const TOKEN = "a-valid-token";
const NOW = new Date("2026-08-19T01:00:00.000Z");
const NO_GIT = { hasGitMetadata: () => false };

function seedBranchedTask(store: FakeRunStore, overrides: Record<string, unknown> = {}): void {
  seedTask(store, "T-1", {
    status: "branched",
    write_scope: ["src/pkg"],
    lease: {
      agent_id: "agent-1",
      role: "implementer",
      attempt: 1,
      token_digest: tokenDigest(TOKEN),
      issued_at: "2026-08-19T00:00:00.000Z",
      expires_at: "2026-08-19T02:00:00.000Z",
      heartbeat_at: "2026-08-19T00:00:00.000Z",
      duration_seconds: 3600,
      suspended_at: "2026-08-19T00:00:00.000Z",
    },
    ...overrides,
  });
}

describe("collectBranch", () => {
  function baseInput(store: FakeRunStore, overrides: Record<string, unknown> = {}) {
    return {
      runRoot: store.runRoot,
      repoRoot: process.cwd(),
      branchId: "B-1",
      agentId: "agent-1",
      token: TOKEN,
      actor: "agent-1",
      summary: "all done",
      now: NOW,
      observation: NO_GIT,
      transact: store.transact,
      ...overrides,
    };
  }

  test("rejects a blank summary", () => {
    const store = new FakeRunStore();
    expect(() => collectBranch(baseInput(store, { summary: "  " }))).toThrow(
      /summary must be non-blank text/,
    );
  });

  test("rejects collecting a branch that is not open", () => {
    const store = new FakeRunStore();
    seedBranchLedger(store, [branchRecord({ id: "B-1", status: "collected" })]);
    expect(() => collectBranch(baseInput(store))).toThrow(/branch B-1 is collected, not open/);
  });

  test("rejects collecting a branch that belongs to a different parent agent", () => {
    const store = new FakeRunStore();
    seedBranchLedger(store, [
      branchRecord({ id: "B-1", status: "open", parent_agent_id: "someone-else" }),
    ]);
    expect(() => collectBranch(baseInput(store))).toThrow(
      /branch B-1 belongs to someone-else, not agent-1/,
    );
  });

  test("rejects collecting while any sub-task is still non-terminal", () => {
    const store = new FakeRunStore();
    seedBranchLedger(store, [
      branchRecord({
        id: "B-1",
        status: "open",
        sub_tasks: [
          subTask({ id: "ST-1", status: "claimed" }),
          subTask({ id: "ST-2", status: "open" }),
        ],
      }),
    ]);
    expect(() => collectBranch(baseInput(store))).toThrow(
      /branch B-1 still has non-terminal sub-tasks: ST-1 \(claimed\), ST-2 \(open\)/,
    );
  });

  test("rejects collecting when the parent task is not in the branched state", () => {
    const store = new FakeRunStore();
    seedTask(store, "T-1", { status: "running" });
    seedBranchLedger(store, [
      branchRecord({
        id: "B-1",
        status: "open",
        parent_task_id: "T-1",
        sub_tasks: [subTask({ status: "submitted" })],
      }),
    ]);
    expect(() => collectBranch(baseInput(store))).toThrow(/T-1 is running, not branched/);
  });

  test("rejects collecting with an invalid lease token", () => {
    const store = new FakeRunStore();
    seedBranchedTask(store);
    seedBranchLedger(store, [
      branchRecord({
        id: "B-1",
        status: "open",
        parent_task_id: "T-1",
        sub_tasks: [subTask({ status: "submitted" })],
      }),
    ]);
    expect(() => collectBranch(baseInput(store, { token: "wrong" }))).toThrow(
      /lease identity or token is invalid/,
    );
  });

  test("collects a branch with no recorded baseline observation: files_changed stays unset", () => {
    const store = new FakeRunStore();
    seedBranchedTask(store);
    seedBranchLedger(store, [
      branchRecord({
        id: "B-1",
        status: "open",
        parent_task_id: "T-1",
        sub_tasks: [subTask({ status: "submitted" })],
      }),
    ]);
    const outcome = collectBranch(baseInput(store));
    expect(outcome.branch.status).toBe("collected");
    expect(outcome.branch.files_changed).toBeUndefined();
    expect(outcome.branch.outcome_summary).toBe("all done");
    const reread = readBranchLedger(outcome.state)[0]!;
    expect(reread.status).toBe("collected");
    const task = (outcome.state as unknown as { tasks: Record<string, { status: string }> }).tasks[
      "T-1"
    ]!;
    expect(task.status).toBe("running");
  });

  test("collects a branch with a recorded baseline: computes and evidences the changed files", () => {
    const store = new FakeRunStore();
    seedBranchedTask(store);
    seedBranchLedger(store, [
      branchRecord({
        id: "B-1",
        status: "open",
        parent_task_id: "T-1",
        sub_tasks: [subTask({ status: "submitted" })],
        opened_observation: {
          observed_at: "2026-08-19T00:00:00.000Z",
          git_available: false,
          head: null,
          entries: [],
        },
      }),
    ]);
    const outcome = collectBranch(baseInput(store));
    expect(outcome.branch.collected_observation).toEqual({
      observed_at: NOW.toISOString(),
      git_available: false,
      head: null,
      entries: [],
    });
    // both observations report git_available: false, so observedFilesChanged returns null,
    // and files_changed is correctly left unset rather than evidenced as an empty list.
    expect(outcome.branch.files_changed).toBeUndefined();
  });
});

describe("abandonBranch", () => {
  function baseInput(store: FakeRunStore, overrides: Record<string, unknown> = {}) {
    return {
      runRoot: store.runRoot,
      branchId: "B-1",
      agentId: "agent-1",
      token: TOKEN,
      actor: "agent-1",
      reason: "no longer needed",
      now: NOW,
      transact: store.transact,
      ...overrides,
    };
  }

  test("rejects a blank reason", () => {
    const store = new FakeRunStore();
    expect(() => abandonBranch(baseInput(store, { reason: "  " }))).toThrow(
      /reason must be non-blank text/,
    );
  });

  test("rejects abandoning a branch that is not open", () => {
    const store = new FakeRunStore();
    seedBranchLedger(store, [branchRecord({ id: "B-1", status: "abandoned" })]);
    expect(() => abandonBranch(baseInput(store))).toThrow(/branch B-1 is abandoned, not open/);
  });

  test("rejects abandoning a branch that belongs to a different parent agent", () => {
    const store = new FakeRunStore();
    seedBranchLedger(store, [
      branchRecord({ id: "B-1", status: "open", parent_agent_id: "someone-else" }),
    ]);
    expect(() => abandonBranch(baseInput(store))).toThrow(
      /branch B-1 belongs to someone-else, not agent-1/,
    );
  });

  test("rejects abandoning when the parent task is not in the branched state", () => {
    const store = new FakeRunStore();
    seedTask(store, "T-1", { status: "running" });
    seedBranchLedger(store, [branchRecord({ id: "B-1", status: "open", parent_task_id: "T-1" })]);
    expect(() => abandonBranch(baseInput(store))).toThrow(/T-1 is running, not branched/);
  });

  test("rejects abandoning with an invalid lease token", () => {
    const store = new FakeRunStore();
    seedBranchedTask(store);
    seedBranchLedger(store, [branchRecord({ id: "B-1", status: "open", parent_task_id: "T-1" })]);
    expect(() => abandonBranch(baseInput(store, { token: "wrong" }))).toThrow(
      /lease identity or token is invalid/,
    );
  });

  test("rejects abandoning while a sub-task itself has an open branch (status branched)", () => {
    const store = new FakeRunStore();
    seedBranchedTask(store);
    seedBranchLedger(store, [
      branchRecord({
        id: "B-1",
        status: "open",
        parent_task_id: "T-1",
        sub_tasks: [subTask({ id: "ST-1", status: "branched" })],
      }),
    ]);
    expect(() => abandonBranch(baseInput(store))).toThrow(
      /sub-task ST-1 has an open branch of its own; collect or abandon it first/,
    );
  });

  test("abandons open sub-tasks, leaves already-terminal ones alone, and resumes the parent", () => {
    const store = new FakeRunStore();
    seedBranchedTask(store);
    seedBranchLedger(store, [
      branchRecord({
        id: "B-1",
        status: "open",
        parent_task_id: "T-1",
        sub_tasks: [
          subTask({ id: "ST-open", status: "open" }),
          subTask({
            id: "ST-claimed",
            status: "claimed",
            lease: {
              agent_id: "sub-agent",
              token_digest: "d",
              issued_at: "t",
              expires_at: "e",
              duration_seconds: 60,
            },
          }),
          subTask({ id: "ST-done", status: "submitted" }),
        ],
      }),
    ]);
    const outcome = abandonBranch(baseInput(store));
    expect(outcome.branch.status).toBe("abandoned");
    expect(outcome.branch.outcome_summary).toBe("no longer needed");
    const byId = new Map(outcome.branch.sub_tasks.map((st) => [st.id, st]));
    expect(byId.get("ST-open")!.status).toBe("abandoned");
    expect(byId.get("ST-claimed")!.status).toBe("abandoned");
    expect(byId.get("ST-claimed")!.lease).toBeUndefined();
    expect(byId.get("ST-done")!.status).toBe("submitted"); // untouched terminal status
    const task = (outcome.state as unknown as { tasks: Record<string, { status: string }> }).tasks[
      "T-1"
    ]!;
    expect(task.status).toBe("running");
  });
});
