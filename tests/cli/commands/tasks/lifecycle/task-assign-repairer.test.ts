import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { taskAssignRepairerCommand } from "../../../../../olt/scripts/src/cli/commands/task-assign-repairer.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import {
  claimSubmitValidateAndReject,
  setupCompiledRun,
} from "../../fixtures/file-persistence-fixture.ts";

const roots: string[] = [];
beforeEach(() => {
  setupVirtualCliFS();
});
afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
  roots.length = 0;
});

describe("task:assign-repairer - Core Reassignment & Rules", () => {
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
  }, 30_000);

  test("refuses an unrecognised --reason", () => {
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
  }, 30_000);

  test("rejects assigning validating agent as replacement repairer", async () => {
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
  }, 30_000);
});
