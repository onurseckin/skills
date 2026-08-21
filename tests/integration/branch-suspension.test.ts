import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { workflowView } from "../../orchestrating-long-tasks/scripts/src/reporting/workflow-view.ts";
import { branchCapsule, cleanupRoots, openBranchVia, taskOf } from "../unit/branch/fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

function leaseOf(run: string, taskId: string): Record<string, unknown> {
  const lease = taskOf(run, taskId).lease;
  if (typeof lease !== "object" || lease === null || Array.isArray(lease)) {
    throw new Error(`${taskId} holds no lease`);
  }
  return lease;
}

describe("a suspended lease reads the same way everywhere", () => {
  test("task:heartbeat refuses to wind a frozen clock forward", async () => {
    const fixture = await branchCapsule(roots, "suspend-heartbeat");
    await openBranchVia(fixture);
    const frozen = leaseOf(fixture.run, "task-1").expires_at;

    await expect(
      execute([
        "task:heartbeat",
        "--run",
        fixture.run,
        "--task",
        "task-1",
        "--agent",
        "worker-1",
        "--token",
        fixture.token,
      ]),
    ).rejects.toThrow("lease clock is suspended while a branch is open");
    expect(leaseOf(fixture.run, "task-1").expires_at).toBe(frozen);
  });

  test("the status view does not call a frozen lease expired", async () => {
    const fixture = await branchCapsule(roots, "suspend-status");
    await openBranchVia(fixture);
    const wellPastExpiry = new Date(Date.now() + 86_400_000);

    const branched = workflowView(fixture.run, wellPastExpiry);
    expect(branched.stale_evidence).toEqual([]);
  });

  test("still reports a genuinely expired lease once the branch is collected", async () => {
    const fixture = await branchCapsule(roots, "suspend-status-collected");
    const opened = await openBranchVia(fixture);
    const claimed = await execute([
      "branch:claim",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      String(opened.branch_id),
      "--sub-task",
      "S-1",
      "--agent",
      "sub-1",
      "--role",
      "sub-implementer",
      "--lease-seconds",
      "600",
    ]);
    await execute([
      "branch:submit",
      "--run",
      fixture.run,
      "--branch",
      String(opened.branch_id),
      "--sub-task",
      "S-1",
      "--agent",
      "sub-1",
      "--token",
      String(claimed.token),
      "--summary",
      "done",
    ]);
    await execute([
      "branch:collect",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      String(opened.branch_id),
      "--agent",
      "worker-1",
      "--token",
      fixture.token,
      "--summary",
      "collected",
    ]);

    const view = workflowView(fixture.run, new Date(Date.now() + 86_400_000));
    const restored = leaseOf(fixture.run, "task-1").expires_at;
    expect(view.stale_evidence).toEqual([`task task-1 lease expired at ${String(restored)}`]);
  });
});
