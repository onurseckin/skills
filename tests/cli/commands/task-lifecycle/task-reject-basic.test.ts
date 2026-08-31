import { describe, expect, test } from "bun:test";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { taskRejectCommand } from "../../../../olt/scripts/src/cli/commands/task-reject.ts";
import { claimSubmitValidateAndReject, setupCompiledRun } from "../fixtures/file-persistence-fixture.ts";
import {
  establishSupervisorChain,
  registerUnderChain,
} from "../../../shared/agent-supervisor-chain.ts";

const roots: string[] = [];

describe("task:reject - Basic Validation & Alias Parsing", () => {
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
    await Bun.write(`${repo}/tests/core/impl.ts`, "export const x = 2;\n");
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
      "tests/core/impl.ts",
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
