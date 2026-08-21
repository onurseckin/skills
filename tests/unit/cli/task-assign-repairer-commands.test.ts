import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { markCoreImplemented, setupCompiledRun } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("task:assign-repairer", () => {
  test("hands a changes_requested task's repair lease to a named replacement", async () => {
    const { repo, run } = await setupCompiledRun("assign-repairer-run", roots);

    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-core",
      "--role",
      "implementer",
    ]);
    const workerToken = claim.token as string;

    await markCoreImplemented(repo);
    await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      "task-core",
      "--actor",
      "worker-core",
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
      "worker-core",
      "--token",
      workerToken,
      "--summary",
      "Core tests implemented",
      "--files-changed",
      "tests/unit/core/impl.ts",
    ]);

    const valStart = await execute([
      "task:validate-start",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "val-agent-1",
    ]);
    const valToken = valStart.token as string;

    const execGate = await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      "task-core",
      "--gate",
      "gate-core",
      "--actor",
      "val-agent-1",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-core.ts",
    ]);
    const gateCmdId = execGate.command_id as string;

    const reject = await execute([
      "task:reject",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "val-agent-1",
      "--token",
      valToken,
      "--evidence",
      gateCmdId,
      "--reason",
      "Missing edge case coverage",
      "--severity",
      "important",
      "--remediation",
      "Add the missing edge case test",
    ]);
    expect((reject.task as { status: string }).status).toBe("changes_requested");
    expect((reject.task as { repair_assignee: string }).repair_assignee).toBe("worker-core");

    const assigned = await execute([
      "task:assign-repairer",
      "--run",
      run,
      "--task",
      "task-core",
      "--actor",
      "coordinator",
      "--repairer",
      "worker-replacement",
      "--reason",
      "unavailable",
      "--evidence",
      "worker-core released without claiming the repair lease",
    ]);
    expect(String(assigned.markdown)).toContain("### Repairer Reassigned: task-core");
    const assignedTask = assigned.task as {
      repair_assignee: string;
      replacement_reason: string;
      original_implementer: string;
    };
    expect(assignedTask.repair_assignee).toBe("worker-replacement");
    expect(assignedTask.replacement_reason).toBe("unavailable");
    expect(assignedTask.original_implementer).toBe("worker-core");

    // The replacement, and only the replacement, can now claim the repair lease.
    await expect(
      execute([
        "task:claim",
        "--run",
        run,
        "--task",
        "task-core",
        "--agent",
        "worker-core",
        "--role",
        "repairer",
      ]),
    ).rejects.toThrow();

    const repairClaim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-replacement",
      "--role",
      "repairer",
    ]);
    expect(repairClaim.token).toBeString();
  });

  test("refuses a replacement equal to the original implementer", async () => {
    const { repo, run } = await setupCompiledRun("assign-repairer-same", roots);
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-core",
      "--role",
      "implementer",
    ]);
    const workerToken = claim.token as string;
    await markCoreImplemented(repo);
    await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      "task-core",
      "--actor",
      "worker-core",
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
      "worker-core",
      "--token",
      workerToken,
      "--summary",
      "Core tests implemented",
      "--files-changed",
      "tests/unit/core/impl.ts",
    ]);
    const valStart = await execute([
      "task:validate-start",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "val-agent-1",
    ]);
    const execGate = await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      "task-core",
      "--gate",
      "gate-core",
      "--actor",
      "val-agent-1",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-core.ts",
    ]);
    await execute([
      "task:reject",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "val-agent-1",
      "--token",
      valStart.token as string,
      "--evidence",
      execGate.command_id as string,
      "--reason",
      "Missing edge case coverage",
      "--severity",
      "important",
      "--remediation",
      "Add the missing edge case test",
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
        "worker-core",
        "--reason",
        "unavailable",
        "--evidence",
        "worker-core is unresponsive",
      ]),
    ).rejects.toThrow("replacement must differ from original implementer");
  });
});
