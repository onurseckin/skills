import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  collectBranch,
  abandonBranch,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/branch/collect.ts";
import { openBranch } from "../../../orchestrating-long-tasks/scripts/src/workflow/branch/open.ts";
import { submitSubTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/branch/sub-tasks.ts";
import { branchCapsule, cleanupRoots, openBranchVia } from "./fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

// B21: every branch lifecycle transition (open, sub-task submit, collect, abandon) is refused
// outright when its account of what happened is missing — a soft request produces soft
// compliance, so the CLI never accepts these without the flag, and the domain functions
// underneath refuse independently so no other caller can skip the requirement either.

describe("B21: branch:open refuses without a reason", () => {
  test("CLI: --reason is required", async () => {
    const fixture = await branchCapsule(roots, "b21-open-cli-missing");
    await expect(
      execute([
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
        "--sub-task",
        "S-1",
        "--sub-label",
        "S-1=Fix the parser",
        "--sub-scope",
        "S-1=src/one/parser",
      ]),
    ).rejects.toThrow("--reason is required");
  });

  test("CLI: a blank --reason is refused, not accepted as empty text", async () => {
    const fixture = await branchCapsule(roots, "b21-open-cli-blank");
    await expect(openBranchVia(fixture, { reason: "   " })).rejects.toThrow(
      "--reason must have a non-blank value",
    );
  });

  test("domain: openBranch refuses a blank reason before touching the repository", () => {
    expect(() =>
      openBranch({
        runRoot: "/nonexistent/run",
        repoRoot: "/nonexistent/repo",
        parentTaskId: "task-1",
        agentId: "worker-1",
        token: "irrelevant",
        reason: "  ",
        subTasks: [{ id: "S-1", label: "Fix it", writeScope: ["src/one"] }],
        actor: "worker-1",
        maxDepth: 5,
        maxAgents: 10,
      }),
    ).toThrow("reason must be non-blank text");
  });
});

describe("B21: branch:submit (sub-task) refuses without a summary", () => {
  test("CLI: --summary is required", async () => {
    const fixture = await branchCapsule(roots, "b21-subsubmit-cli-missing");
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
    await expect(
      execute([
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
      ]),
    ).rejects.toThrow("--summary is required");
  });

  test("domain: submitSubTask refuses a blank summary before touching the store", () => {
    expect(() =>
      submitSubTask({
        runRoot: "/nonexistent/run",
        branchId: "B-nonexistent",
        subTaskId: "S-1",
        agentId: "sub-1",
        token: "irrelevant",
        actor: "sub-1",
        summary: "",
      }),
    ).toThrow("summary must be non-blank text");
  });
});

describe("B21: branch:collect refuses without a summary", () => {
  test("CLI: --summary is required", async () => {
    const fixture = await branchCapsule(roots, "b21-collect-cli-missing");
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
    // The sub-task must be terminal before collect will even reach the missing-summary check,
    // so it is submitted with a real summary first — this test is about the parent's own summary.
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
      ]),
    ).rejects.toThrow("--summary is required");
  });

  test("domain: collectBranch refuses a blank summary before observing the repository", () => {
    expect(() =>
      collectBranch({
        runRoot: "/nonexistent/run",
        repoRoot: "/nonexistent/repo",
        branchId: "B-nonexistent",
        agentId: "worker-1",
        token: "irrelevant",
        actor: "worker-1",
        summary: "   ",
      }),
    ).toThrow("summary must be non-blank text");
  });
});

describe("B21: branch:abandon refuses without a reason", () => {
  test("CLI: --reason is required", async () => {
    const fixture = await branchCapsule(roots, "b21-abandon-cli-missing");
    const opened = await openBranchVia(fixture);
    await expect(
      execute([
        "branch:abandon",
        "--run",
        fixture.run,
        "--branch",
        String(opened.branch_id),
        "--agent",
        "worker-1",
        "--token",
        fixture.token,
      ]),
    ).rejects.toThrow("--reason is required");
  });

  test("domain: abandonBranch refuses a blank reason before touching the store", () => {
    expect(() =>
      abandonBranch({
        runRoot: "/nonexistent/run",
        branchId: "B-nonexistent",
        agentId: "worker-1",
        token: "irrelevant",
        actor: "worker-1",
        reason: "",
      }),
    ).toThrow("reason must be non-blank text");
  });
});
