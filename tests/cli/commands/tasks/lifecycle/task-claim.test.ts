import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { taskClaimCommand } from "../../../../../olt/scripts/src/cli/commands/task-claim.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { TASK_ID, setupRun } from "../../fixtures/probe-fixture.ts";

const roots: string[] = [];
beforeEach(() => {
  setupVirtualCliFS();
});
afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

describe("task:claim - Confinement, Validation & Role Rules", () => {
  test("refuses an unrecognised --role", async () => {
    await expect(
      taskClaimCommand({
        run: "/virtual/cli/task-claim-unclaimed",
        task: TASK_ID,
        agent: "worker-1",
        role: "reviewer",
      }),
    ).rejects.toThrow(/--role must be one of/);
  });

  test("refuses task claim by validator or completeness-critic (anti-boundary-leak rule)", async () => {
    await expect(
      taskClaimCommand({
        run: "/virtual/cli/task-claim-unclaimed",
        task: TASK_ID,
        agent: "val-agent-1",
        role: "validator",
      }),
    ).rejects.toThrow(
      /cannot claim code implementation tasks: critics and validators are strictly prohibited from claiming code write leases/,
    );

    await expect(
      taskClaimCommand({
        run: "/virtual/cli/task-claim-unclaimed",
        task: TASK_ID,
        agent: "critic-agent-1",
        role: "completeness-critic",
      }),
    ).rejects.toThrow(
      /cannot claim code implementation tasks: critics and validators are strictly prohibited from claiming code write leases/,
    );

    await expect(
      taskClaimCommand({
        run: "/virtual/cli/task-claim-unclaimed",
        task: TASK_ID,
        agent: "subval-1",
        role: "sub-validator",
      }),
    ).rejects.toThrow(/cannot claim code implementation tasks/);

    await expect(
      taskClaimCommand({
        run: "/virtual/cli/task-claim-unclaimed",
        task: TASK_ID,
        agent: "planval-1",
        role: "plan-validator",
      }),
    ).rejects.toThrow(/cannot claim code implementation tasks/);
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

  test("refuses claiming an already-leased task by a different worker", async () => {
    const { run } = await setupRun("claim-collision", roots);
    await execute([
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
    await expect(
      execute([
        "task:claim",
        "--run",
        run,
        "--task",
        TASK_ID,
        "--agent",
        "worker-2",
        "--role",
        "implementer",
      ]),
    ).rejects.toThrow();
  });

  test("task:claim rejects orchestrator and logs defect to capsule directory", async () => {
    const { run } = await setupRun("claim-orch-confinement", roots);
    try {
      await execute([
        "task:claim",
        "--run",
        run,
        "--task",
        TASK_ID,
        "--agent",
        "orch-lead",
        "--role",
        "orchestrator",
      ]);
      expect(true).toBeFalse();
    } catch (err: unknown) {
      const error = err as { code?: string; message: string };
      expect(error.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(error.message).toContain(
        "Orchestrators are mechanically confined from claiming code execution tasks. Dispatch Tier 3 Implementers via invoke_subagent.",
      );
    }

    const defectsFile = `${run}/defects.jsonl`;
    const defectsExist = existsSync(defectsFile);
    expect(defectsExist).toBeTrue();
    const contents = readFileSync(defectsFile, "utf8");
    expect(contents).toContain("role_confinement_violation");
    expect(contents).toContain("orch-lead");
  });

  test("task:claim rejects coordinator and logs defect to capsule directory", async () => {
    const { run } = await setupRun("claim-coord-confinement", roots);
    try {
      await execute([
        "task:claim",
        "--run",
        run,
        "--task",
        TASK_ID,
        "--agent",
        "coord-dispatcher",
        "--role",
        "coordinator",
      ]);
      expect(true).toBeFalse();
    } catch (err: unknown) {
      const error = err as { code?: string; message: string };
      expect(error.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(error.message).toContain(
        "Coordinators are mechanically confined from claiming code execution tasks. Dispatch Tier 3 Implementers via invoke_subagent.",
      );
    }

    const defectsFile = `${run}/defects.jsonl`;
    const defectsExist = existsSync(defectsFile);
    expect(defectsExist).toBeTrue();
    const contents = readFileSync(defectsFile, "utf8");
    expect(contents).toContain("role_confinement_violation");
    expect(contents).toContain("coord-dispatcher");
  });
});
