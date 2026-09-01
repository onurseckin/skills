import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import type { JsonObject } from "../../../../../olt/scripts/src/core/contracts/index.ts";
import {
  branchCapsule,
  cleanupRoots as cleanupBranchRoots,
  openBranchVia,
} from "../../../../branch/index.ts";
import { cleanupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";

const roots: string[] = [];
afterEach(async () => {
  cleanupVirtualCliFS();
  await cleanupBranchRoots(roots);
});

function expireTaskLease(run: string, taskId: string): void {
  transact(run, "test-setup", "lease-expired-for-test", {}, (draft) => {
    const tasks = draft.tasks as JsonObject;
    const task = tasks[taskId] as JsonObject;
    const lease = task.lease as JsonObject;
    lease.expires_at = "2020-01-01T00:00:00.000Z";
  });
}

function expireBranchSubTaskLease(run: string, branchId: string, subTaskId: string): void {
  transact(run, "test-setup", "sub-lease-expired-for-test", {}, (draft) => {
    const branches = draft.branches as JsonObject[];
    const branch = branches.find((b) => b.id === branchId);
    if (!branch) throw new Error(`branch ${branchId} missing in test state`);
    const subTasks = branch.sub_tasks as JsonObject[];
    const sub = subTasks.find((s) => s.id === subTaskId);
    if (!sub) throw new Error(`subtask ${subTaskId} missing in branch ${branchId}`);
    const lease = sub.lease as JsonObject;
    lease.expires_at = "2020-01-01T00:00:00.000Z";
  });
}

describe("doctor command", () => {
  test("runs doctor check on a compiled run and returns structured report", async () => {
    const { run } = await setupCompiledRun("doctor-basic", roots);
    const result = await execute(["doctor", "--run", run]);

    expect(result.run_root).toBe(run);
    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("### Capsule Doctor:");
  });

  test("runs doctor:verify to assert invariants", async () => {
    const { run } = await setupCompiledRun("doctor-verify", roots);
    const result = await execute(["doctor:verify", "--run", run]);

    expect(result.run_root).toBe(run);
    expect(result.markdown).toBeDefined();
  });

  test("runs doctor:repair to repair projection", async () => {
    const { run } = await setupCompiledRun("doctor-repair", roots);
    const result = await execute(["doctor:repair", "--run", run, "--actor", "coordinator"]);

    expect(result.run_root).toBe(run);
    expect(String(result.markdown)).toContain("### Projection Repaired");
  });
});

describe("health command", () => {
  test("runs health command on default scripts directory with check filter", async () => {
    const result = await execute(["health", "--check", "vendor-identifiers"]);
    expect(result.healthy).toBeDefined();
    expect(result.markdown).toBeDefined();
  });

  test("rejects invalid --check option with known error", async () => {
    await expect(execute(["health", "--check", "invalid-check"])).rejects.toThrow(
      "unknown --check",
    );
  });
});

describe("recover command", () => {
  test("releases a task lease past its expiry and reclaims stale branch sub-lease", async () => {
    const { run } = await setupCompiledRun("recover-stale", roots);
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--lease-seconds",
      "600",
    ]);
    expireTaskLease(run, "task-core");

    const result = await execute(["recover", "--run", run, "--actor", "coordinator"]);
    expect(String(result.markdown)).toContain("### Stale Lease Recovery");
    expect(result.recovered).toEqual(["task-core"]);
    expect(result.recovered_sub_tasks).toEqual([]);
    const tasks = result.tasks as JsonObject;
    expect((tasks["task-core"] as JsonObject).status).toBe("retry_ready");
  });

  test("accepts explicit --grace-seconds", async () => {
    const { run } = await setupCompiledRun("recover-grace", roots);
    const result = await execute([
      "recover",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--grace-seconds",
      "0",
    ]);
    expect(result.recovered).toEqual([]);
  });

  test("reclaims a branch sub-task whose sub-agent's lease has expired", async () => {
    const { repo, run } = await setupCompiledRun("recover-sub-lease", roots);
    const claimed = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--lease-seconds",
      "600",
    ]);
    const token = String(claimed.token);
    const opened = await execute([
      "branch:open",
      "--run",
      run,
      "--repo",
      repo,
      "--parent-task",
      "task-core",
      "--token",
      token,
      "--agent",
      "worker-1",
      "--reason",
      "Fix parser subtask",
      "--sub-task",
      "S-1",
      "--sub-label",
      "S-1=Fix the parser",
      "--sub-scope",
      "S-1=tests/core/sub",
    ]);
    const branchId = String(opened.branch_id);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "sub-recover",
      "--role",
      "sub-implementer",
      "--host",
      "antigravity",
      "--parent-agent",
      "worker-1",
      "--actor",
      "worker-1",
      "--parent-task",
      "S-1",
    ]);
    await execute([
      "branch:claim",
      "--run",
      run,
      "--repo",
      repo,
      "--branch",
      branchId,
      "--sub-task",
      "S-1",
      "--agent",
      "sub-recover",
      "--role",
      "sub-implementer",
    ]);
    expireBranchSubTaskLease(run, branchId, "S-1");

    const result = await execute(["recover", "--run", run, "--actor", "coordinator"]);
    expect(result.recovered_sub_tasks).toEqual(["S-1"]);
  });
});
