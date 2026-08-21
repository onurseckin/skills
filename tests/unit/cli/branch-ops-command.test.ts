import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  branchCapsule,
  branchChain,
  branchesOf,
  openBranchVia,
  taskOf,
  type BranchFixture,
} from "../branch/fixture.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function withFixture(name: string): Promise<BranchFixture> {
  return branchCapsule(roots, name);
}

describe("branch:open", () => {
  test("subdivides the parent's lease into sub-tasks a sub-agent can claim", async () => {
    const fixture = await withFixture("branch-open-basic");
    const opened = await openBranchVia(fixture);
    expect(String(opened.markdown)).toBeString();
    expect(opened.run_root).toBe(fixture.run);
    expect(opened.branch_id).toBeString();
    const branch = opened.branch as { id: string; sub_tasks: { id: string }[] };
    expect(branch.sub_tasks.map((s) => s.id)).toEqual(["S-1"]);
  });

  test("opens multiple sub-tasks, one of them carrying its own revalidation gate", async () => {
    const fixture = await withFixture("branch-open-multi");
    const opened = await execute([
      "branch:open",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--parent-task",
      "task-1",
      "--agent",
      "worker-1",
      "--token",
      fixture.token,
      "--reason",
      "split the parser and the lexer",
      "--sub-task",
      "S-1",
      "--sub-label",
      "S-1=Fix the parser",
      "--sub-scope",
      "S-1=src/one/parser",
      "--sub-gate",
      "S-1=bun test tests/unit/parser.test.ts",
      "--sub-task",
      "S-2",
      "--sub-label",
      "S-2=Fix the lexer",
      "--sub-scope",
      "S-2=src/one/lexer",
    ]);
    const branch = opened.branch as { sub_tasks: { id: string; gate?: unknown }[] };
    expect(branch.sub_tasks.map((s) => s.id)).toEqual(["S-1", "S-2"]);
  });

  // One shared fixture: every case below fails argument parsing before a branch is ever opened,
  // so the parent lease is never touched and the same run root is reusable across all of them.
  test("validates sub-task argument pairing before opening anything", async () => {
    const fixture = await withFixture("branch-open-argument-errors");
    const base = [
      "branch:open",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--parent-task",
      "task-1",
      "--agent",
      "worker-1",
      "--token",
      fixture.token,
    ];

    await expect(
      execute([
        ...base,
        "--reason",
        "malformed pair",
        "--sub-task",
        "S-1",
        "--sub-label",
        "S-1-no-equals",
        "--sub-scope",
        "S-1=src/one/parser",
      ]),
    ).rejects.toThrow("--sub-label must be given as <sub-task-id>=<value>");

    await expect(
      execute([
        ...base,
        "--reason",
        "undeclared sub-task",
        "--sub-task",
        "S-1",
        "--sub-label",
        "S-1=Fix the parser",
        "--sub-scope",
        "S-1=src/one/parser",
        "--sub-scope",
        "S-2=src/one/lexer",
      ]),
    ).rejects.toThrow("--sub-scope names undeclared sub-task S-2");

    await expect(
      execute([
        ...base,
        "--reason",
        "missing label",
        "--sub-task",
        "S-1",
        "--sub-scope",
        "S-1=src/one/parser",
      ]),
    ).rejects.toThrow("sub-task S-1 has no --sub-label");

    await expect(
      execute([
        ...base,
        "--reason",
        "missing scope",
        "--sub-task",
        "S-1",
        "--sub-label",
        "S-1=Fix the parser",
      ]),
    ).rejects.toThrow("sub-task S-1 has no --sub-scope");

    await expect(
      execute([
        ...base,
        "--reason",
        "two labels",
        "--sub-task",
        "S-1",
        "--sub-label",
        "S-1=First label",
        "--sub-label",
        "S-1=Second label",
        "--sub-scope",
        "S-1=src/one/parser",
      ]),
    ).rejects.toThrow("sub-task S-1 has more than one --sub-label");

    // The parent lease survived every rejected attempt above untouched, so a well-formed open
    // still succeeds against the same fixture afterward.
    const opened = await openBranchVia(fixture);
    expect(opened.branch_id).toBeString();
  });
});

describe("branch:claim", () => {
  test("leases a sub-task, publishes its role packet and returns the bearer token", async () => {
    const fixture = await withFixture("branch-claim");
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
    ]);
    expect(claimed.token).toBeString();
    expect(claimed.packet_id).toBeString();
    expect(claimed.packet_path).toBeString();
    expect(claimed.role_contract_sha256).toBeString();
    const subTask = claimed.sub_task as { id: string; status: string };
    expect(subTask.id).toBe("S-1");
    expect(subTask.status).toBe("claimed");
  });

  test("rejects a branch role outside the sub-agent role set, and a role that is not a role at all", async () => {
    const fixture = await withFixture("branch-claim-bad-role");
    const opened = await openBranchVia(fixture);
    const base = [
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
    ];
    await expect(execute([...base, "--role", "coordinator"])).rejects.toThrow(
      "--role must be one of",
    );
    await expect(execute([...base, "--role", "not-a-real-role"])).rejects.toThrow(
      "--role must be one of",
    );
  });
});

describe("branch:submit and branch:collect", () => {
  test("submit records what the sub-agent reports, then collect resumes the top-level parent task", async () => {
    const fixture = await withFixture("branch-submit-collect");
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
    ]);
    const submitted = await execute([
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
      "Parser accepts the new grammar",
    ]);
    const submittedSubTask = submitted.sub_task as { id: string; status: string };
    expect(submittedSubTask.status).toBe("submitted");

    const collected = await execute([
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
      "Parser fixed; API change unblocked",
    ]);
    expect(collected.parent_status).toBe("running");
    const branch = collected.branch as { status: string };
    expect(branch.status).toBe("collected");
  });

  test("branch:collect resolves the parent's status through the branch ledger when the parent is itself a sub-task", async () => {
    const fixture = await withFixture("branch-collect-nested");
    const [outer] = await branchChain(fixture, 1);
    const inner = await openBranchVia(fixture, {
      parentTask: outer.subTaskId,
      agent: outer.agent,
      token: outer.token,
      reason: "the parser itself needs to be split further",
      subTasks: [{ id: "S-1-1", label: "Split the tokenizer", scopes: ["src/one/parser/tokens"] }],
    });
    const claimed = await execute([
      "branch:claim",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      String(inner.branch_id),
      "--sub-task",
      "S-1-1",
      "--agent",
      "sub-inner",
      "--role",
      "sub-implementer",
    ]);
    await execute([
      "branch:submit",
      "--run",
      fixture.run,
      "--branch",
      String(inner.branch_id),
      "--sub-task",
      "S-1-1",
      "--agent",
      "sub-inner",
      "--token",
      String(claimed.token),
      "--summary",
      "Tokenizer split out",
    ]);
    const collected = await execute([
      "branch:collect",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      String(inner.branch_id),
      "--agent",
      outer.agent,
      "--token",
      outer.token,
      "--summary",
      "Tokenizer work folded back in",
    ]);
    expect(collected.parent_status).toBe("claimed");
  });
});

describe("branch:abandon", () => {
  test("gives up on a branch, releases the parent lease and reports its resumed status", async () => {
    const fixture = await withFixture("branch-abandon");
    const opened = await openBranchVia(fixture);
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
      "sub-agent could not reproduce the failure",
    ]);
    expect(abandoned.parent_status).toBe("running");
    const branch = abandoned.branch as { status: string };
    expect(branch.status).toBe("abandoned");
    expect(taskOf(fixture.run, "task-1").status).toBe("running");
  });
});

describe("branch:status", () => {
  test("lists open branches by default, mirrors the ledger, and --branch/--task/--all narrow or widen it", async () => {
    const fixture = await withFixture("branch-status");
    const opened = await openBranchVia(fixture);

    const openOnly = await execute(["branch:status", "--run", fixture.run]);
    expect(openOnly.open_branches).toBe(1);
    expect(openOnly.total_branches).toBe(1);
    const openBranches = openOnly.branches as { id: string }[];
    expect(openBranches.map((b) => b.id)).toEqual([String(opened.branch_id)]);
    // Sanity check that the shared branch fixture's own ledger accessor agrees with the CLI's
    // view of the world, so a drift between the two fails loudly here.
    expect(branchesOf(fixture.run).map((b) => b.id)).toEqual([String(opened.branch_id)]);

    await execute([
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
      "starting over",
    ]);

    const closedOnly = await execute(["branch:status", "--run", fixture.run]);
    expect(closedOnly.open_branches).toBe(0);
    expect((closedOnly.branches as unknown[]).length).toBe(0);

    const all = await execute(["branch:status", "--run", fixture.run, "--all"]);
    expect((all.branches as { id: string }[]).length).toBe(1);

    const byId = await execute([
      "branch:status",
      "--run",
      fixture.run,
      "--branch",
      String(opened.branch_id),
      "--all",
    ]);
    expect((byId.branches as { id: string }[]).map((b) => b.id)).toEqual([
      String(opened.branch_id),
    ]);

    const byTask = await execute([
      "branch:status",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--all",
    ]);
    expect((byTask.branches as unknown[]).length).toBe(1);

    const byOtherTask = await execute([
      "branch:status",
      "--run",
      fixture.run,
      "--task",
      "task-does-not-exist",
      "--all",
    ]);
    expect((byOtherTask.branches as unknown[]).length).toBe(0);
  });
});
