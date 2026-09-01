import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { taskRejectCommand } from "../../../../../../olt/scripts/src/cli/commands/task-reject.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../../fixtures/full-lifecycle-fixture.ts";
import {
  claimSubmitValidateAndReject,
  setupCompiledRun,
} from "../../../fixtures/file-persistence-fixture.ts";

const roots: string[] = [];
beforeEach(() => {
  setupVirtualCliFS();
});
afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

describe("task:reject - Core Validation and Remediation Invariants", () => {
  test("rejects a submitted task with a structured finding and returns it for repair", async () => {
    const { repo, run } = await setupCompiledRun("reject-basic", roots);
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

  test("refuses an unrecognised --severity", async () => {
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
});
