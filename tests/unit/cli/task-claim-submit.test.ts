import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  taskClaimCommand,
  taskSubmitCommand,
} from "../../../orchestrating-long-tasks/scripts/src/cli/commands/task-claim.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { TASK_ID, claimSubmitValidate, setupRun } from "./probe-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("task:claim / task:heartbeat / task:submit", () => {
  test("refuses an unrecognised --role", async () => {
    // taskClaimCommand checks --role before it ever opens the run root, so no capsule is needed.
    await expect(
      taskClaimCommand({
        run: "unused",
        task: TASK_ID,
        agent: "worker-1",
        role: "reviewer",
      }),
    ).rejects.toThrow(/--role must be one of/);
  });

  test("claims a ready task and echoes the lease token", async () => {
    const { run } = await setupRun("claim-basic", roots);
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    expect(typeof claim.token).toBe("string");
    expect((claim.task as { status: string }).status).toBe("leased");
    expect(String(claim.markdown)).toContain(TASK_ID);
  });

  test("task:heartbeat extends a live lease and refuses a foreign/expired token elsewhere", async () => {
    const { run } = await setupRun("heartbeat", roots);
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    const beat = await execute([
      "task:heartbeat",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--token",
      claim.token as string,
    ]);
    expect((beat.task as { status: string }).status).toBe("running");
  });

  test("task:submit refuses combining --report with --files-changed/--evidence/--summary", async () => {
    // The report/summary conflict check runs right after loadRun's own-task lookup, before any
    // check on lease/claim state, so the task never needs to actually be claimed first.
    const { repo, run } = await setupRun("submit-report-conflict", roots);
    const reportPath = `${repo}/report.json`;
    await Bun.write(reportPath, JSON.stringify({ summary: "x", files_changed: [], checks: [] }));
    await expect(
      taskSubmitCommand({
        run,
        task: TASK_ID,
        agent: "worker-1",
        token: "unused-token",
        report: reportPath,
        summary: "also inline",
      }),
    ).rejects.toThrow(/cannot be combined with --files-changed/);
  });

  test("task:submit requires --summary when no --report is given", async () => {
    const { run } = await setupRun("submit-no-summary", roots);
    await expect(
      taskSubmitCommand({
        run,
        task: TASK_ID,
        agent: "worker-1",
        token: "unused-token",
      }),
    ).rejects.toThrow(/--summary is required/);
  });

  test("--no-op requires --reason, and --reason is meaningless without --no-op", async () => {
    // Both refusals run before taskSubmitCommand ever opens the run root, so neither needs a
    // capsule, let alone a claimed task.
    await expect(
      taskSubmitCommand({
        run: "unused",
        task: TASK_ID,
        agent: "worker-1",
        token: "unused-token",
        summary: "no change needed",
        "no-op": true,
      }),
    ).rejects.toThrow(/--no-op requires --reason/);

    await expect(
      taskSubmitCommand({
        run: "unused",
        task: TASK_ID,
        agent: "worker-1",
        token: "unused-token",
        summary: "irrelevant",
        reason: "orphan reason",
      }),
    ).rejects.toThrow(/--reason only applies together with --no-op/);
  });

  test("task:submit refuses an unknown task id", async () => {
    const { run } = await setupRun("submit-unknown-task", roots);
    await expect(
      execute([
        "task:submit",
        "--run",
        run,
        "--task",
        "task-ghost",
        "--agent",
        "worker-1",
        "--token",
        "whatever",
        "--summary",
        "x",
      ]),
    ).rejects.toThrow(/unknown task task-ghost/);
  });

  test("a full claim → submit → validate-start round trip via --files-changed and --evidence", async () => {
    const { repo, run } = await setupRun("full-round-trip", roots);
    const validation = await claimSubmitValidate(repo, run);
    expect(typeof validation.token).toBe("string");
    expect((validation.task as { status: string }).status).toBe("validating");
  });
});
