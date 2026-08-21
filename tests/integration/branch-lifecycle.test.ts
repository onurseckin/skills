import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  branchCapsule,
  branchesOf,
  cleanupRoots,
  eventKinds,
  openBranchVia,
  taskOf,
  type BranchFixture,
} from "../unit/branch/fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

async function claimSub(fixture: BranchFixture, branchId: string, subTask = "S-1") {
  return execute([
    "branch:claim",
    "--run",
    fixture.run,
    "--repo",
    fixture.repo,
    "--branch",
    branchId,
    "--sub-task",
    subTask,
    "--agent",
    `sub-${subTask}`,
    "--role",
    "sub-implementer",
    "--lease-seconds",
    "600",
  ]);
}

describe("branch open, claim, submit, collect", () => {
  test("runs the whole cycle and hands the parent back its work", async () => {
    const fixture = await branchCapsule(roots, "branch-cycle");
    const opened = await openBranchVia(fixture);
    const branchId = String(opened.branch_id);
    expect(branchId.startsWith("B-")).toBeTrue();
    expect(taskOf(fixture.run, "task-1").status).toBe("branched");

    const claimed = await claimSub(fixture, branchId);
    expect(branchesOf(fixture.run)[0]!.sub_tasks[0]!.status).toBe("claimed");

    // The sub-agent does real work in its scope, which is what collect has to measure.
    await mkdir(join(fixture.repo, "src", "one", "parser"), { recursive: true });
    await writeFile(
      join(fixture.repo, "src", "one", "parser", "grammar.ts"),
      "export const x = 1;\n",
    );

    await execute([
      "branch:submit",
      "--run",
      fixture.run,
      "--branch",
      branchId,
      "--sub-task",
      "S-1",
      "--agent",
      "sub-S-1",
      "--token",
      String(claimed.token),
      "--summary",
      "Grammar accepts the new form",
    ]);
    expect(branchesOf(fixture.run)[0]!.sub_tasks[0]!.status).toBe("submitted");

    const collected = await execute([
      "branch:collect",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      branchId,
      "--agent",
      "worker-1",
      "--token",
      fixture.token,
      "--summary",
      "Parser fixed, API change unblocked",
    ]);

    const branch = branchesOf(fixture.run)[0]!;
    expect(branch.status).toBe("collected");
    expect(branch.reason).toBe("the parser blocks the API change");
    expect(branch.files_changed?.evidence_class).toBe("harness_observed");
    expect(branch.files_changed?.value).toContain("src/one/parser/grammar.ts");
    expect(collected.parent_status).toBe("running");

    const parent = taskOf(fixture.run, "task-1");
    expect(parent.status).toBe("running");
    expect(parent.lease).toBeDefined();
    expect(eventKinds(fixture.run)).toContain("branch-opened");
    expect(eventKinds(fixture.run)).toContain("branch-claimed");
    expect(eventKinds(fixture.run)).toContain("branch-submitted");
    expect(eventKinds(fixture.run)).toContain("branch-collected");
  });

  test("freezes the parent lease clock while the branch is open", async () => {
    const fixture = await branchCapsule(roots, "branch-freeze");
    const before = taskOf(fixture.run, "task-1");
    const expiry = (before.lease as Record<string, unknown>).expires_at;
    const opened = await openBranchVia(fixture);

    const frozen = taskOf(fixture.run, "task-1").lease as Record<string, unknown>;
    expect(frozen.suspended_at).toBeString();
    expect(frozen.expires_at).toBe(expiry);

    const claimed = await claimSub(fixture, String(opened.branch_id));
    await execute([
      "branch:submit",
      "--run",
      fixture.run,
      "--branch",
      String(opened.branch_id),
      "--sub-task",
      "S-1",
      "--agent",
      "sub-S-1",
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

    const restored = taskOf(fixture.run, "task-1").lease as Record<string, unknown>;
    expect(restored.suspended_at).toBeUndefined();
    expect(Date.parse(String(restored.expires_at))).toBeGreaterThan(Date.parse(String(expiry)));
  });

  test("refuses to collect while a sub-task is still live", async () => {
    const fixture = await branchCapsule(roots, "branch-pending");
    const opened = await openBranchVia(fixture);
    await claimSub(fixture, String(opened.branch_id));
    await expect(
      execute([
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
        "too early",
      ]),
    ).rejects.toThrow("non-terminal sub-tasks: S-1 (claimed)");
  });

  test("refuses a branch without the parent's live token", async () => {
    const fixture = await branchCapsule(roots, "branch-token");
    await expect(openBranchVia(fixture, { token: "not-the-token" })).rejects.toThrow(
      "lease identity or token is invalid",
    );
  });

  test("reports open branches and the reason each one exists", async () => {
    const fixture = await branchCapsule(roots, "branch-status");
    const opened = await openBranchVia(fixture);
    const status = await execute(["branch:status", "--run", fixture.run]);
    expect(status.open_branches).toBe(1);
    expect(String(status.markdown)).toContain("the parser blocks the API change");
    expect(String(status.markdown)).toContain(String(opened.branch_id));
  });
});
