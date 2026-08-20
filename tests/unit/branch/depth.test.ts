import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  branchCapsule,
  branchChain,
  branchesOf,
  chainScope,
  cleanupRoots,
  openBranchVia,
  openChainLevel,
} from "./fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

describe("branch nesting depth", () => {
  test("lets a chain of strictly narrowing scopes run four levels deep", async () => {
    const fixture = await branchCapsule(roots, "branch-deep-chain");
    const chain = await branchChain(fixture, 4);
    expect(chain).toHaveLength(4);

    const ledger = branchesOf(fixture.run);
    expect(ledger.map((branch) => branch.depth)).toEqual([1, 2, 3, 4]);
    expect(ledger.map((branch) => branch.sub_tasks[0]!.write_scope[0])).toEqual([
      chainScope(1),
      chainScope(2),
      chainScope(3),
      chainScope(4),
    ]);
    // Every level above the leaf is frozen behind the branch it opened.
    expect(ledger.slice(0, 3).map((branch) => branch.sub_tasks[0]!.status)).toEqual([
      "branched",
      "branched",
      "branched",
    ]);
    expect(ledger[3]!.sub_tasks[0]!.status).toBe("claimed");
  }, 20_000);

  test("trips the depth escalation threshold at the sixth level", async () => {
    const fixture = await branchCapsule(roots, "branch-depth-tripwire");
    const chain = await branchChain(fixture, 5);
    const leaf = chain[4]!;

    await expect(
      openChainLevel(fixture, 6, {
        taskId: leaf.subTaskId,
        agent: leaf.agent,
        token: leaf.token,
      }),
    ).rejects.toThrow(
      "branch depth 6 trips the max_branch_depth escalation threshold of 5: subdividing S-5 again means the original scoping was wrong, so escalate to the human rather than branching deeper",
    );
  }, 25_000);

  test("returns a nested parent to claimed when its own branch collects", async () => {
    const fixture = await branchCapsule(roots, "branch-nested-collect");
    const first = await openBranchVia(fixture);
    const claimed = await execute([
      "branch:claim",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      String(first.branch_id),
      "--sub-task",
      "S-1",
      "--agent",
      "sub-1",
      "--role",
      "sub-implementer",
      "--lease-seconds",
      "600",
    ]);
    const second = await openBranchVia(fixture, {
      parentTask: "S-1",
      agent: "sub-1",
      token: String(claimed.token),
      reason: "the lexer is the real defect",
      subTasks: [{ id: "S-1-a", label: "Lexer", scopes: ["src/one/parser/lexer"] }],
    });
    const nested = await execute([
      "branch:claim",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      String(second.branch_id),
      "--sub-task",
      "S-1-a",
      "--agent",
      "sub-2",
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
      String(second.branch_id),
      "--sub-task",
      "S-1-a",
      "--agent",
      "sub-2",
      "--token",
      String(nested.token),
      "--summary",
      "lexer fixed",
    ]);
    const collected = await execute([
      "branch:collect",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      String(second.branch_id),
      "--agent",
      "sub-1",
      "--token",
      String(claimed.token),
      "--summary",
      "lexer came back fixed",
    ]);
    expect(collected.parent_status).toBe("claimed");
    const ledger = branchesOf(fixture.run);
    expect(ledger[0]!.sub_tasks[0]!.status).toBe("claimed");
    expect(ledger[0]!.sub_tasks[0]!.lease!.suspended_at).toBeUndefined();
  });
});
