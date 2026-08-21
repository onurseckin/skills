import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  branchCapsule,
  branchesOf,
  cleanupRoots,
  eventKinds,
  openBranchVia,
  taskOf,
} from "../unit/branch/fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

describe("branch failure recovery", () => {
  test("never reaps a parent that is blocked on its children", async () => {
    const fixture = await branchCapsule(roots, "branch-not-reaped");
    await openBranchVia(fixture);
    const recovered = await execute([
      "recover",
      "--run",
      fixture.run,
      "--actor",
      "coordinator",
      "--grace-seconds",
      "0",
    ]);
    expect(recovered.recovered).toEqual([]);
    expect(taskOf(fixture.run, "task-1").status).toBe("branched");
    expect(taskOf(fixture.run, "task-1").lease).toBeDefined();
  });

  test("reclaims a sub-task whose sub-agent died holding the lease", async () => {
    const fixture = await branchCapsule(roots, "branch-dead-sub");
    const opened = await openBranchVia(fixture);
    await execute([
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
      "5",
    ]);
    await Bun.sleep(5_500);

    const recovered = await execute([
      "recover",
      "--run",
      fixture.run,
      "--actor",
      "coordinator",
      "--grace-seconds",
      "0",
    ]);
    expect(recovered.recovered_sub_tasks).toEqual(["S-1"]);
    expect(String(recovered.markdown)).toContain("**Branch Sub-leases Reclaimed**: 1");

    const subTask = branchesOf(fixture.run)[0]!.sub_tasks[0]!;
    expect(subTask.status).toBe("open");
    expect(subTask.lease).toBeUndefined();
    expect(subTask.recovery?.expired_agent_id).toBe("sub-1");

    // The reclaimed sub-task is claimable again, so the branch can still reach collect.
    const reclaimed = await execute([
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
      "sub-2",
      "--role",
      "sub-implementer",
      "--lease-seconds",
      "600",
    ]);
    expect(reclaimed.token).toBeString();
  }, 15_000);

  test("abandons the branch, releases the sub-leases and resumes the parent", async () => {
    const fixture = await branchCapsule(roots, "branch-abandon");
    const opened = await openBranchVia(fixture);
    await execute([
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

    const abandoned = await execute([
      "branch:abandon",
      "--run",
      fixture.run,
      "--branch",
      String(opened.branch_id),
      "--agent",
      "worker-1",
      "--token",
      fixture.token,
      "--reason",
      "the sub-agent could not reproduce the failure",
    ]);
    expect(abandoned.parent_status).toBe("running");

    const branch = branchesOf(fixture.run)[0]!;
    expect(branch.status).toBe("abandoned");
    expect(branch.sub_tasks[0]!.status).toBe("abandoned");
    expect(branch.sub_tasks[0]!.lease).toBeUndefined();
    expect(branch.files_changed).toBeUndefined();
    expect(taskOf(fixture.run, "task-1").status).toBe("running");
    expect(eventKinds(fixture.run)).toContain("branch-abandoned");
  });

  test("task:release hands a live lease back without waiting for expiry", async () => {
    const fixture = await branchCapsule(roots, "branch-release");
    const released = await execute([
      "task:release",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--agent",
      "worker-1",
      "--token",
      fixture.token,
    ]);
    expect(released.run_root).toBe(fixture.run);
    expect(taskOf(fixture.run, "task-1").status).toBe("retry_ready");
    expect(taskOf(fixture.run, "task-1").lease).toBeUndefined();
    expect(eventKinds(fixture.run)).toContain("lease-released");
  });

  test("task:release refuses a branched task until the branch closes", async () => {
    const fixture = await branchCapsule(roots, "branch-release-blocked");
    await openBranchVia(fixture);
    await expect(
      execute([
        "task:release",
        "--run",
        fixture.run,
        "--task",
        "task-1",
        "--agent",
        "worker-1",
        "--token",
        fixture.token,
      ]),
    ).rejects.toThrow("does not hold a releasable lease");
  });
});
