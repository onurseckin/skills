import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  branchCapsule,
  branchChain,
  branchesOf,
  cleanupRoots,
  taskOf,
  type BranchFixture,
} from "./fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

// The shortest lease the harness accepts, so the parent's window closes inside a test run.
const SHORT_LEASE = 5;

function recover(fixture: BranchFixture): Promise<Record<string, unknown>> {
  return execute([
    "recover",
    "--run",
    fixture.run,
    "--actor",
    "coordinator",
    "--grace-seconds",
    "0",
  ]);
}

function claimSub(
  fixture: BranchFixture,
  branchId: string,
  subTaskId: string,
  agent: string,
): Promise<Record<string, unknown>> {
  return execute([
    "branch:claim",
    "--run",
    fixture.run,
    "--repo",
    fixture.repo,
    "--branch",
    branchId,
    "--sub-task",
    subTaskId,
    "--agent",
    agent,
    "--role",
    "sub-implementer",
    "--lease-seconds",
    "600",
  ]);
}

describe("recovery walks a suspended-lease chain", () => {
  test("reclaims a dead middle agent and strands nothing above it", async () => {
    const fixture = await branchCapsule(roots, "chain-dead-middle");
    const chain = await branchChain(fixture, 3, SHORT_LEASE);
    const middle = chain[1]!;
    const leaf = chain[2]!;
    await execute([
      "branch:submit",
      "--run",
      fixture.run,
      "--branch",
      leaf.branchId,
      "--sub-task",
      leaf.subTaskId,
      "--agent",
      leaf.agent,
      "--token",
      leaf.token,
      "--summary",
      "the deepest fix landed",
    ]);
    // The leaf is done and the middle agent never came back for it.
    await Bun.sleep(SHORT_LEASE * 1_000 + 200);

    const recovered = await recover(fixture);
    expect(recovered.recovered_sub_tasks).toEqual([middle.subTaskId]);

    const ledger = branchesOf(fixture.run);
    const leafBranch = ledger.find((branch) => branch.id === leaf.branchId)!;
    expect(leafBranch.status).toBe("abandoned");
    expect(leafBranch.outcome_summary).toContain(middle.agent);
    // The work the leaf did stays on the record; only the branch closes.
    expect(leafBranch.sub_tasks[0]!.status).toBe("submitted");

    const middleBranch = ledger.find((branch) => branch.id === middle.branchId)!;
    const reclaimed = middleBranch.sub_tasks[0]!;
    expect(reclaimed.status).toBe("open");
    expect(reclaimed.lease).toBeUndefined();
    expect(reclaimed.recovery?.expired_agent_id).toBe(middle.agent);

    // Everything above the dead level is untouched and still holds its frozen lease.
    expect(ledger[0]!.sub_tasks[0]!.status).toBe("branched");
    expect(ledger[0]!.sub_tasks[0]!.lease!.suspended_at).toBeString();
    expect(taskOf(fixture.run, "task-1").status).toBe("branched");

    // And the reclaimed level is workable again, so the chain can finish.
    const reclaimedClaim = await claimSub(
      fixture,
      middle.branchId,
      middle.subTaskId,
      "sub-2-replacement",
    );
    expect(reclaimedClaim.token).toBeString();
  }, 25_000);

  test("a dead leaf leaves its ancestors able to finish", async () => {
    const fixture = await branchCapsule(roots, "chain-dead-leaf");
    const chain = await branchChain(fixture, 2, SHORT_LEASE);
    const parent = chain[0]!;
    const leaf = chain[1]!;
    await Bun.sleep(SHORT_LEASE * 1_000 + 200);

    const recovered = await recover(fixture);
    expect(recovered.recovered_sub_tasks).toEqual([leaf.subTaskId]);
    expect(taskOf(fixture.run, "task-1").status).toBe("branched");

    const afterRecovery = branchesOf(fixture.run);
    expect(afterRecovery.find((branch) => branch.id === leaf.branchId)!.status).toBe("open");
    expect(afterRecovery[0]!.sub_tasks[0]!.status).toBe("branched");

    const replacement = await claimSub(fixture, leaf.branchId, leaf.subTaskId, "sub-2-replacement");
    await execute([
      "branch:submit",
      "--run",
      fixture.run,
      "--branch",
      leaf.branchId,
      "--sub-task",
      leaf.subTaskId,
      "--agent",
      "sub-2-replacement",
      "--token",
      String(replacement.token),
      "--summary",
      "picked the work back up",
    ]);
    const collectedLeaf = await execute([
      "branch:collect",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      leaf.branchId,
      "--agent",
      parent.agent,
      "--token",
      parent.token,
      "--summary",
      "the replacement finished it",
    ]);
    expect(collectedLeaf.parent_status).toBe("claimed");

    await execute([
      "branch:submit",
      "--run",
      fixture.run,
      "--branch",
      parent.branchId,
      "--sub-task",
      parent.subTaskId,
      "--agent",
      parent.agent,
      "--token",
      parent.token,
      "--summary",
      "level one is done",
    ]);
    const collectedTop = await execute([
      "branch:collect",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      parent.branchId,
      "--agent",
      "worker-1",
      "--token",
      fixture.token,
      "--summary",
      "the whole chain came back",
    ]);
    expect(collectedTop.parent_status).toBe("running");
    expect(taskOf(fixture.run, "task-1").status).toBe("running");
  }, 25_000);

  test("never reclaims a parent whose branch is still moving", async () => {
    const fixture = await branchCapsule(roots, "chain-live-parent");
    await branchChain(fixture, 3, 600);

    const recovered = await recover(fixture);
    expect(recovered.recovered).toEqual([]);
    expect(recovered.recovered_sub_tasks).toEqual([]);
    expect(branchesOf(fixture.run).every((branch) => branch.status === "open")).toBeTrue();
    expect(taskOf(fixture.run, "task-1").status).toBe("branched");
  }, 20_000);
});
