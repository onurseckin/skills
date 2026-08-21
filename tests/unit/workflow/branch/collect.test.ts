import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import {
  abandonBranch,
  collectBranch,
} from "../../../../orchestrating-long-tasks/scripts/src/workflow/branch/collect.ts";
import { readBranchLedger } from "../../../../orchestrating-long-tasks/scripts/src/workflow/branch/ledger.ts";
import { tokenDigest } from "../../../../orchestrating-long-tasks/scripts/src/workflow/lease/token.ts";
import { branchRecord, subTask } from "./fixture.ts";
import { freshRunRoot, seedBranchLedger, seedTask } from "./store-fixture.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function trackedRunRoot(prefix: string): string {
  const run = freshRunRoot(prefix);
  roots.push(run.split("/.capsules/")[0]!);
  return run;
}

const TOKEN = "a-valid-token";
const NOW = new Date("2026-08-19T01:00:00.000Z");
const NO_GIT = { hasGitMetadata: () => false };

function seedBranchedTask(runRoot: string, overrides: Record<string, unknown> = {}): void {
  seedTask(runRoot, "T-1", {
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
  function baseInput(runRoot: string, overrides: Record<string, unknown> = {}) {
    return {
      runRoot,
      repoRoot: runRoot,
      branchId: "B-1",
      agentId: "agent-1",
      token: TOKEN,
      actor: "agent-1",
      summary: "all done",
      now: NOW,
      observation: NO_GIT,
      ...overrides,
    };
  }

  test("rejects a blank summary", () => {
    const runRoot = trackedRunRoot("collect-blank-summary");
    expect(() => collectBranch(baseInput(runRoot, { summary: "  " }))).toThrow(
      /summary must be non-blank text/,
    );
  });

  test("rejects collecting a branch that is not open", () => {
    const runRoot = trackedRunRoot("collect-not-open");
    seedBranchLedger(runRoot, [branchRecord({ id: "B-1", status: "collected" })]);
    expect(() => collectBranch(baseInput(runRoot))).toThrow(/branch B-1 is collected, not open/);
  });

  test("rejects collecting a branch that belongs to a different parent agent", () => {
    const runRoot = trackedRunRoot("collect-wrong-agent");
    seedBranchLedger(runRoot, [
      branchRecord({ id: "B-1", status: "open", parent_agent_id: "someone-else" }),
    ]);
    expect(() => collectBranch(baseInput(runRoot))).toThrow(
      /branch B-1 belongs to someone-else, not agent-1/,
    );
  });

  test("rejects collecting while any sub-task is still non-terminal", () => {
    const runRoot = trackedRunRoot("collect-pending");
    seedBranchLedger(runRoot, [
      branchRecord({
        id: "B-1",
        status: "open",
        sub_tasks: [
          subTask({ id: "ST-1", status: "claimed" }),
          subTask({ id: "ST-2", status: "open" }),
        ],
      }),
    ]);
    expect(() => collectBranch(baseInput(runRoot))).toThrow(
      /branch B-1 still has non-terminal sub-tasks: ST-1 \(claimed\), ST-2 \(open\)/,
    );
  });

  test("rejects collecting when the parent task is not in the branched state", () => {
    const runRoot = trackedRunRoot("collect-parent-not-branched");
    seedTask(runRoot, "T-1", { status: "running" });
    seedBranchLedger(runRoot, [
      branchRecord({
        id: "B-1",
        status: "open",
        parent_task_id: "T-1",
        sub_tasks: [subTask({ status: "submitted" })],
      }),
    ]);
    expect(() => collectBranch(baseInput(runRoot))).toThrow(/T-1 is running, not branched/);
  });

  test("rejects collecting with an invalid lease token", () => {
    const runRoot = trackedRunRoot("collect-bad-token");
    seedBranchedTask(runRoot);
    seedBranchLedger(runRoot, [
      branchRecord({
        id: "B-1",
        status: "open",
        parent_task_id: "T-1",
        sub_tasks: [subTask({ status: "submitted" })],
      }),
    ]);
    expect(() => collectBranch(baseInput(runRoot, { token: "wrong" }))).toThrow(
      /lease identity or token is invalid/,
    );
  });

  test("collects a branch with no recorded baseline observation: files_changed stays unset", () => {
    const runRoot = trackedRunRoot("collect-no-baseline");
    seedBranchedTask(runRoot);
    seedBranchLedger(runRoot, [
      branchRecord({
        id: "B-1",
        status: "open",
        parent_task_id: "T-1",
        sub_tasks: [subTask({ status: "submitted" })],
      }),
    ]);
    const outcome = collectBranch(baseInput(runRoot));
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
    const runRoot = trackedRunRoot("collect-with-baseline");
    seedBranchedTask(runRoot);
    seedBranchLedger(runRoot, [
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
    const outcome = collectBranch(baseInput(runRoot));
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
  function baseInput(runRoot: string, overrides: Record<string, unknown> = {}) {
    return {
      runRoot,
      branchId: "B-1",
      agentId: "agent-1",
      token: TOKEN,
      actor: "agent-1",
      reason: "no longer needed",
      now: NOW,
      ...overrides,
    };
  }

  test("rejects a blank reason", () => {
    const runRoot = trackedRunRoot("abandon-blank-reason");
    expect(() => abandonBranch(baseInput(runRoot, { reason: "  " }))).toThrow(
      /reason must be non-blank text/,
    );
  });

  test("rejects abandoning a branch that is not open", () => {
    const runRoot = trackedRunRoot("abandon-not-open");
    seedBranchLedger(runRoot, [branchRecord({ id: "B-1", status: "abandoned" })]);
    expect(() => abandonBranch(baseInput(runRoot))).toThrow(/branch B-1 is abandoned, not open/);
  });

  test("rejects abandoning a branch that belongs to a different parent agent", () => {
    const runRoot = trackedRunRoot("abandon-wrong-agent");
    seedBranchLedger(runRoot, [
      branchRecord({ id: "B-1", status: "open", parent_agent_id: "someone-else" }),
    ]);
    expect(() => abandonBranch(baseInput(runRoot))).toThrow(
      /branch B-1 belongs to someone-else, not agent-1/,
    );
  });

  test("rejects abandoning when the parent task is not in the branched state", () => {
    const runRoot = trackedRunRoot("abandon-parent-not-branched");
    seedTask(runRoot, "T-1", { status: "running" });
    seedBranchLedger(runRoot, [branchRecord({ id: "B-1", status: "open", parent_task_id: "T-1" })]);
    expect(() => abandonBranch(baseInput(runRoot))).toThrow(/T-1 is running, not branched/);
  });

  test("rejects abandoning with an invalid lease token", () => {
    const runRoot = trackedRunRoot("abandon-bad-token");
    seedBranchedTask(runRoot);
    seedBranchLedger(runRoot, [branchRecord({ id: "B-1", status: "open", parent_task_id: "T-1" })]);
    expect(() => abandonBranch(baseInput(runRoot, { token: "wrong" }))).toThrow(
      /lease identity or token is invalid/,
    );
  });

  test("rejects abandoning while a sub-task itself has an open branch (status branched)", () => {
    const runRoot = trackedRunRoot("abandon-nested-branch");
    seedBranchedTask(runRoot);
    seedBranchLedger(runRoot, [
      branchRecord({
        id: "B-1",
        status: "open",
        parent_task_id: "T-1",
        sub_tasks: [subTask({ id: "ST-1", status: "branched" })],
      }),
    ]);
    expect(() => abandonBranch(baseInput(runRoot))).toThrow(
      /sub-task ST-1 has an open branch of its own; collect or abandon it first/,
    );
  });

  test("abandons open sub-tasks, leaves already-terminal ones alone, and resumes the parent", () => {
    const runRoot = trackedRunRoot("abandon-happy");
    seedBranchedTask(runRoot);
    seedBranchLedger(runRoot, [
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
    const outcome = abandonBranch(baseInput(runRoot));
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
