import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { taskAssignRepairerCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/task-assign-repairer.ts";
import { taskRejectCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/task-reject.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { claimSubmitValidateAndReject, setupCompiledRun } from "./file-persistence-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("task:reject", () => {
  test("rejects a submitted task with a structured finding and returns it for repair", async () => {
    const roots2 = roots;
    const { repo, run } = await setupCompiledRun("reject-basic", roots2);
    const rejected = await claimSubmitValidateAndReject({
      run,
      repo,
      taskId: "task-core",
      agent: "worker-1",
      validator: "val-1",
      reason: "missing null check",
      remediation: "add the null check",
    });
    expect((rejected.task as { status: string }).status).toBe("changes_requested");
    expect(rejected.finding_id).toBeDefined();
  });

  test("--remediation (or its --finding alias) is required", async () => {
    // taskRejectCommand checks this before it ever opens the run root, so no capsule is needed.
    await expect(
      taskRejectCommand({
        run: "unused",
        task: "task-core",
        validator: "val-1",
        token: "unused-token",
        reason: "broken",
        severity: "critical",
      }),
    ).rejects.toThrow(/--remediation is required/);
  });

  test("--finding is accepted as an alias for --remediation", async () => {
    const { repo, run } = await setupCompiledRun("reject-remediation-alias", roots);
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    await Bun.write(`${repo}/tests/unit/core/impl.ts`, "export const x = 2;\n");
    await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      "task-core",
      "--actor",
      "worker-1",
      "--cwd",
      repo,
      "--",
      "echo",
      "implementer-work",
    ]);
    await execute([
      "task:submit",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--token",
      claim.token as string,
      "--files-changed",
      "tests/unit/core/impl.ts",
      "--summary",
      "did the work",
    ]);
    const val = await execute([
      "task:validate-start",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "val-1",
    ]);

    const gateCmd = await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      "task-core",
      "--gate",
      "gate-core",
      "--actor",
      "val-1",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-core.ts",
    ]);
    const rejected = await execute([
      "task:reject",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "val-1",
      "--token",
      val.token as string,
      "--reason",
      "broken",
      "--severity",
      "critical",
      "--finding",
      "use the alias instead",
      "--finding-id",
      "finding-custom-1",
      "--evidence",
      gateCmd.command_id as string,
    ]);
    expect(rejected.finding_id).toBe("finding-custom-1");
  });

  test("refuses an unrecognised --severity", async () => {
    // parseSeverity runs before loadRun in taskRejectCommand, so no capsule is needed to reach it.
    await expect(
      taskRejectCommand({
        run: "unused",
        task: "task-core",
        validator: "val-1",
        token: "unused-token",
        reason: "broken",
        severity: "urgent",
        remediation: "fix",
      }),
    ).rejects.toThrow(/--severity must be one of/);
  });

  test("refuses an unknown task id", async () => {
    const { run } = await setupCompiledRun("reject-unknown-task", roots);
    await expect(
      execute([
        "task:reject",
        "--run",
        run,
        "--task",
        "task-ghost",
        "--validator",
        "val-1",
        "--token",
        "whatever",
        "--reason",
        "x",
        "--severity",
        "minor",
        "--remediation",
        "y",
      ]),
    ).rejects.toThrow(/unknown task task-ghost/);
  });
});

describe("task:assign-repairer", () => {
  test("reassigns with --reason unavailable right after a first reject", async () => {
    const { repo, run } = await setupCompiledRun("repairer-unavailable", roots);
    const rejected = await claimSubmitValidateAndReject({
      run,
      repo,
      taskId: "task-core",
      agent: "worker-1",
      validator: "val-1",
      reason: "defect",
      remediation: "fix it",
    });
    expect((rejected.task as { status: string }).status).toBe("changes_requested");

    const reassigned = await execute([
      "task:assign-repairer",
      "--run",
      run,
      "--task",
      "task-core",
      "--actor",
      "coordinator",
      "--repairer",
      "worker-2",
      "--reason",
      "unavailable",
      "--evidence",
      "worker-1 went offline",
    ]);
    expect((reassigned.task as { repair_assignee: string }).repair_assignee).toBe("worker-2");
    expect(String(reassigned.markdown)).toContain("worker-2");
  });

  test("refuses an unrecognised --reason", () => {
    // replacementReason() runs before taskAssignRepairerCommand ever opens the run root, so a
    // rejected task's actual repair state is irrelevant here — no capsule needed.
    expect(() =>
      taskAssignRepairerCommand({
        run: "unused",
        task: "task-core",
        actor: "coordinator",
        repairer: "worker-2",
        reason: "bored",
        evidence: "no reason at all",
      }),
    ).toThrow(/--reason must be one of/);
  });

  test("--reason repeated_failure requires at least two recorded repair rounds", async () => {
    const { repo, run } = await setupCompiledRun("repairer-repeated-failure", roots);
    await claimSubmitValidateAndReject({
      run,
      repo,
      taskId: "task-core",
      agent: "worker-1",
      validator: "val-1",
      reason: "defect one",
      remediation: "fix it",
    });
    await expect(
      execute([
        "task:assign-repairer",
        "--run",
        run,
        "--task",
        "task-core",
        "--actor",
        "coordinator",
        "--repairer",
        "worker-2",
        "--reason",
        "repeated_failure",
        "--evidence",
        "failed once so far",
      ]),
    ).rejects.toThrow(/has not failed repeatedly/);
  });
});
