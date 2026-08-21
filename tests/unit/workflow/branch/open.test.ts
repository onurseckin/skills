import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { openBranch } from "../../../../orchestrating-long-tasks/scripts/src/workflow/branch/open.ts";
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
const NOW = new Date("2026-08-19T00:30:00.000Z");
const NO_GIT = { hasGitMetadata: () => false };

function seedLeasedTask(runRoot: string, overrides: Record<string, unknown> = {}): void {
  seedTask(runRoot, "T-1", {
    status: "running",
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
    },
    ...overrides,
  });
}

function baseInput(runRoot: string, repoRoot: string, overrides: Record<string, unknown> = {}) {
  return {
    runRoot,
    repoRoot,
    parentTaskId: "T-1",
    agentId: "agent-1",
    token: TOKEN,
    reason: "needs a scoped sub-agent",
    subTasks: [{ id: "ST-1", label: "Sub 1", writeScope: ["src/pkg/a.ts"] }],
    actor: "agent-1",
    maxDepth: 3,
    maxAgents: 10,
    now: NOW,
    observation: NO_GIT,
    ...overrides,
  };
}

describe("openBranch", () => {
  test("rejects an empty list of sub-tasks", () => {
    const runRoot = trackedRunRoot("open-empty");
    expect(() => openBranch(baseInput(runRoot, runRoot, { subTasks: [] }))).toThrow(
      /a branch needs at least one sub-task/,
    );
  });

  test("rejects a blank reason", () => {
    const runRoot = trackedRunRoot("open-blank-reason");
    expect(() => openBranch(baseInput(runRoot, runRoot, { reason: "   " }))).toThrow(
      /reason must be non-blank text/,
    );
  });

  test("rejects opening against a parent task that is not leased or running", () => {
    const runRoot = trackedRunRoot("open-not-working");
    seedLeasedTask(runRoot, { status: "done" });
    expect(() => openBranch(baseInput(runRoot, runRoot))).toThrow(
      /task T-1 is done and cannot open a branch/,
    );
  });

  test("rejects an invalid lease token", () => {
    const runRoot = trackedRunRoot("open-bad-token");
    seedLeasedTask(runRoot);
    expect(() => openBranch(baseInput(runRoot, runRoot, { token: "wrong-token" }))).toThrow(
      /lease identity or token is invalid/,
    );
  });

  test("rejects a branch that would trip the max depth escalation threshold", () => {
    const runRoot = trackedRunRoot("open-max-depth");
    seedLeasedTask(runRoot);
    expect(() => openBranch(baseInput(runRoot, runRoot, { maxDepth: 0 }))).toThrow(
      /branch depth 1 trips the max_branch_depth escalation threshold of 0/,
    );
  });

  test("rejects a branch that would exceed the max_agents budget", () => {
    const runRoot = trackedRunRoot("open-max-agents");
    seedLeasedTask(runRoot);
    expect(() => openBranch(baseInput(runRoot, runRoot, { maxAgents: 0 }))).toThrow(
      /max_agents budget of 0 is exhausted/,
    );
  });

  test("rejects duplicate sub-task ids within the same open call", () => {
    const runRoot = trackedRunRoot("open-dup-ids");
    seedLeasedTask(runRoot);
    expect(() =>
      openBranch(
        baseInput(runRoot, runRoot, {
          subTasks: [
            { id: "ST-1", label: "a", writeScope: ["src/pkg/a.ts"] },
            { id: "ST-1", label: "b", writeScope: ["src/pkg/b.ts"] },
          ],
        }),
      ),
    ).toThrow(/duplicate sub-task id: ST-1/);
  });

  test("rejects a sub-task id that collides with an existing plan task", () => {
    const runRoot = trackedRunRoot("open-collide-task");
    seedLeasedTask(runRoot);
    seedTask(runRoot, "ST-1");
    expect(() => openBranch(baseInput(runRoot, runRoot))).toThrow(
      /sub-task id ST-1 collides with a plan task/,
    );
  });

  test("rejects a sub-task id already claimed by another branch", () => {
    const runRoot = trackedRunRoot("open-id-in-use");
    seedLeasedTask(runRoot);
    seedBranchLedger(runRoot, [
      branchRecord({ id: "B-other", sub_tasks: [subTask({ id: "ST-1" })] }),
    ]);
    expect(() => openBranch(baseInput(runRoot, runRoot))).toThrow(
      /sub-task id ST-1 is already in use/,
    );
  });

  test("rejects a sub-task write scope that escapes the parent's scope", () => {
    const runRoot = trackedRunRoot("open-bad-scope");
    seedLeasedTask(runRoot);
    expect(() =>
      openBranch(
        baseInput(runRoot, runRoot, {
          subTasks: [{ id: "ST-1", label: "a", writeScope: ["src/other/a.ts"] }],
        }),
      ),
    ).toThrow(/write scope escapes the parent scope/);
  });

  test("opens a branch: suspends the parent lease, records the observation baseline, and persists the ledger", () => {
    const runRoot = trackedRunRoot("open-happy");
    seedLeasedTask(runRoot);
    const outcome = openBranch(
      baseInput(runRoot, runRoot, {
        subTasks: [
          {
            id: "ST-1",
            label: "Sub 1",
            writeScope: ["src/pkg/a.ts"],
            gate: "bun test tests/a.test.ts",
          },
        ],
      }),
    );
    expect(outcome.branch.id).toMatch(/^B-/);
    expect(outcome.branch.parent_task_id).toBe("T-1");
    expect(outcome.branch.depth).toBe(1);
    expect(outcome.branch.status).toBe("open");
    expect(outcome.branch.sub_tasks).toEqual([
      {
        id: "ST-1",
        label: "Sub 1",
        write_scope: ["src/pkg/a.ts"],
        gate: "bun test tests/a.test.ts",
        status: "open",
      },
    ]);
    expect(outcome.branch.opened_observation).toEqual({
      observed_at: NOW.toISOString(),
      git_available: false,
      head: null,
      entries: [],
    });
    const reread = readBranchLedger(outcome.state);
    expect(reread).toHaveLength(1);
    expect(reread[0]!.id).toBe(outcome.branch.id);
    const task = (
      outcome.state as unknown as {
        tasks: Record<string, { status: string; lease?: { suspended_at?: string } }>;
      }
    ).tasks["T-1"]!;
    expect(task.status).toBe("branched");
    expect(task.lease?.suspended_at).toBe(NOW.toISOString());
  });

  test("throws INVALID_STATE when there is nothing at all for the parent id to resolve against", () => {
    const runRoot = trackedRunRoot("open-unknown-parent");
    expect(() => openBranch(baseInput(runRoot, runRoot, { parentTaskId: "ghost" }))).toThrow(
      /unknown parent ghost/,
    );
  });
});
