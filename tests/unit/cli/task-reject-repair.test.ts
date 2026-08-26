import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { taskAssignRepairerCommand } from "../../../olt/scripts/src/cli/commands/task-assign-repairer.ts";
import { taskRejectCommand } from "../../../olt/scripts/src/cli/commands/task-reject.ts";
import { linkBlobIntoView, putBlobFile } from "../../../olt/scripts/src/engine/store/blobs.ts";
import { recordCaptures } from "../../../olt/scripts/src/engine/store/captures.ts";
import { claimSubmitValidateAndReject, setupCompiledRun } from "./file-persistence-fixture.ts";
import {
  establishSupervisorChain,
  registerUnderChain,
} from "../../support/agent-supervisor-chain.ts";

const roots: string[] = [];

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
    const chain = await establishSupervisorChain(run);
    await registerUnderChain(
      run,
      chain,
      "worker-1",
      "implementer",
      "antigravity",
      undefined,
      "task-core",
    );
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
    await registerUnderChain(
      run,
      chain,
      "val-1",
      "validator",
      "antigravity",
      undefined,
      "task-core",
    );
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
      "worker-1",
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

  test("carries screenshots already captured for the task into the rejection report", async () => {
    const { repo, run } = await setupCompiledRun("reject-with-screenshots", roots);
    const chain = await establishSupervisorChain(run);
    await registerUnderChain(
      run,
      chain,
      "worker-1",
      "implementer",
      "antigravity",
      undefined,
      "task-core",
    );
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
    await Bun.write(`${repo}/tests/unit/core/impl.ts`, "export const x = 3;\n");
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
    await registerUnderChain(
      run,
      chain,
      "val-1",
      "validator",
      "antigravity",
      undefined,
      "task-core",
    );
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
      "worker-1",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-core.ts",
    ]);

    const tmpScreenshot = `${repo}/before-reject.png`;
    await Bun.write(tmpScreenshot, "fake-png-bytes");
    const blob = putBlobFile(run, tmpScreenshot);
    const view = linkBlobIntoView(run, blob, "evidence", "before-reject.png");
    recordCaptures(run, [
      {
        kind: "screenshot",
        name: "before-reject.png",
        sha256: blob.sha256,
        bytes: blob.bytes,
        blob_path: blob.path,
        path: view.view_path,
        storage: view.storage,
        original_path: tmpScreenshot,
        task_id: "task-core",
        actor: "val-1",
      },
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
      "layout regression",
      "--severity",
      "critical",
      "--remediation",
      "fix the layout",
      "--evidence",
      gateCmd.command_id as string,
    ]);

    expect(rejected.screenshots).toEqual(["evidence/before-reject.png"]);
    const records = rejected.screenshot_records as Array<{ name: string }>;
    expect(records).toHaveLength(1);
    const firstRecord = records[0];
    if (!firstRecord) {
      throw new Error("expected at least one screenshot record");
    }
    expect(firstRecord.name).toBe("before-reject.png");
  });

  test("refuses an unknown task id", async () => {
    const { run } = await setupCompiledRun("reject-unknown-task", roots);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "val-1",
      "--role",
      "validator",
      "--host",
      "antigravity",
      "--parent-task",
      "task-core",
    ]);
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

    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "coordinator",
      "--role",
      "coordinator",
      "--host",
      "antigravity",
      "--parent-agent",
      "fixture-orch-root",
      "--actor",
      "fixture-orch-root",
      "--parent-task",
      "task-core",
    ]);
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
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "coordinator",
      "--role",
      "coordinator",
      "--host",
      "antigravity",
      "--parent-agent",
      "fixture-orch-root",
      "--actor",
      "fixture-orch-root",
      "--parent-task",
      "task-core",
    ]);
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

  test("rejects assigning the validating agent as replacement repairer (anti-boundary-leak rule)", async () => {
    const { repo, run } = await setupCompiledRun("repairer-validator-leak", roots);
    await claimSubmitValidateAndReject({
      run,
      repo,
      taskId: "task-core",
      agent: "worker-1",
      validator: "val-1",
      reason: "defect detected",
      remediation: "fix the bug",
    });
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "coordinator",
      "--role",
      "coordinator",
      "--host",
      "antigravity",
      "--parent-agent",
      "fixture-orch-root",
      "--actor",
      "fixture-orch-root",
      "--parent-task",
      "task-core",
    ]);
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
        "val-1",
        "--reason",
        "unavailable",
        "--evidence",
        "attempting to assign validator as repairer",
      ]),
    ).rejects.toThrow(/cannot be a validator of task 'task-core' \(anti-boundary-leak rule\)/);
  });

  test("task:reject records micro-cycle critique when --micro-cycle or --in-lease is specified", async () => {
    const { repo, run } = await setupCompiledRun("reject-micro-cycle", roots);
    const chain = await establishSupervisorChain(run);
    await registerUnderChain(
      run,
      chain,
      "worker-1",
      "implementer",
      "antigravity",
      undefined,
      "task-core",
    );
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

    await registerUnderChain(
      run,
      chain,
      "val-1",
      "validator",
      "antigravity",
      undefined,
      "task-core",
    );
    const result = await execute([
      "task:reject",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "val-1",
      "--reason",
      "Micro-cycle critique: missing type boundary check",
      "--remediation",
      "Add explicit type check",
      "--micro-cycle",
      "--max-rounds",
      "5",
    ]);

    expect(result.micro_cycle).toBe(true);
    expect(result.round).toBe(1);
    expect(result.remediation).toBe("Add explicit type check");
    expect((result.task as { status: string }).status).toBe("leased");
  });

  test("task:reject --micro-cycle on a lease-less (submitted) task mints and returns a working repair token instead of wedging the task", async () => {
    const { repo, run } = await setupCompiledRun("reject-micro-cycle-repair-wedge", roots);

    const chain = await establishSupervisorChain(run);
    await registerUnderChain(
      run,
      chain,
      "worker-1",
      "implementer",
      "antigravity",
      undefined,
      "task-core",
    );
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
    await mkdir(join(repo, "tests/unit/core"), { recursive: true });
    await writeFile(join(repo, "tests/unit/core/impl.ts"), "export const x = 1;\n");
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
    const submitted = await execute([
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

    const submittedTask = submitted.task as { status?: string; lease?: unknown };
    expect(submittedTask.status).toBe("submitted");
    expect(submittedTask.lease).toBeUndefined();

    await registerUnderChain(
      run,
      chain,
      "val-1",
      "validator",
      "antigravity",
      undefined,
      "task-core",
    );
    const rejected = await execute([
      "task:reject",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "val-1",
      "--reason",
      "Missing boundary check on the repaired path",
      "--remediation",
      "Add the boundary check",
      "--micro-cycle",
    ]);

    const repairToken = rejected.repair_token;
    expect(typeof repairToken).toBe("string");
    expect(String(rejected.markdown)).toContain("Repair Lease Token");
    expect(String(rejected.markdown)).toContain(repairToken as string);

    const taskAfterReject = rejected.task as { status: string; lease?: { agent_id: string } };
    expect(taskAfterReject.status).toBe("leased");
    expect(taskAfterReject.lease).toBeDefined();
    expect(taskAfterReject.lease?.agent_id).toBe("worker-1");

    const released = await execute([
      "task:release",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--token",
      repairToken as string,
    ]);
    const taskAfterRelease = released.task as { status: string; lease?: unknown };
    expect(taskAfterRelease.status).toBe("changes_requested");
    expect(taskAfterRelease.lease).toBeUndefined();
  });
});
