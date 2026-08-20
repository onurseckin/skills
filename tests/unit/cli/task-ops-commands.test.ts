import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("CLI task-ops commands", () => {
  test("task:claim, task:heartbeat, task:submit, task:validate-start, task:review pass flow", async () => {
    const { repo, run } = await setupCompiledRun("task-pass-run", roots);

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
    expect(claim.token).toBeString();
    expect(String(claim.markdown)).toContain("### Task Leased: task-core");
    const workerToken = claim.token as string;

    const hb = await execute([
      "task:heartbeat",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-core",
      "--token",
      workerToken,
      "--extend",
      "1800",
    ]);
    expect(String(hb.markdown)).toContain("### Heartbeat Acknowledged: task-core");

    // A submission is only accepted against recorded evidence, so the implementer runs its own
    // command before it submits.
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
    const submit = await execute([
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
    expect(submit.orphaned).toBe(false);
    expect(String(submit.markdown)).toContain("### Submission Accepted: task-core");

    const valStart = await execute([
      "task:validate-start",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "val-agent-1",
    ]);
    expect(valStart.token).toBeString();
    expect(String(valStart.markdown)).toContain("### Validation Leased: task-core");
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

    // The mandatory adversarial probe is a precondition of any sign-off.
    const probe = await execute([
      "task:probe",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "val-agent-1",
      "--token",
      valToken,
      "--demand",
      "Prove the core tests fail when the assertion is inverted",
    ]);
    expect(probe.probe_round).toBe(1);
    expect(probe.repair_round).toBe(0);

    const review = await execute([
      "task:review",
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
      "--resolve",
      `${(probe.finding_ids as string[])[0]}=${gateCmdId}`,
      "--status",
      "pass",
      "--summary",
      "All unit tests pass with zero failures",
    ]);
    expect(review.verdict).toBe("pass");
    expect(String(review.markdown)).toContain("### Task Validated & Satisfied: task-core");
    expect(review.unblocked).toEqual(["task-sec"]);
  });

  test("task:review fail and task:reject record findings", async () => {
    const { repo, run } = await setupCompiledRun("task-fail-run", roots);

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

    // A submission is only accepted against recorded evidence, so the implementer runs its own
    // command before it submits.
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
      "--files-changed",
      "tests/unit/core/impl.ts",
      "--summary",
      "Implemented the task under test",
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
      "--severity",
      "critical",
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
      "Test file too long",
      "--finding",
      "Split test file into smaller modules",
    ]);
    expect(reject.finding_id).toBeString();
    expect(String(reject.markdown)).toContain("### Task Rejected: task-core");
  });
  test("task:heartbeat reports the deadline the lease actually carries", async () => {
    const { run } = await setupCompiledRun("task-heartbeat-truth", roots);
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
      "--lease-duration",
      "600",
    ]);

    const beat = await execute([
      "task:heartbeat",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-core",
      "--token",
      claim.token as string,
      "--extend",
      "3600",
    ]);

    const lease = (beat.task as { lease: { expires_at: string } }).lease;
    // The lease is renewed for its own recorded duration, so the brief must quote that renewal and
    // the real expiry rather than the hour that was requested.
    expect(String(beat.markdown)).toContain(`+10 minutes (New Deadline: ${lease.expires_at})`);
    expect(String(beat.markdown)).not.toContain("+60 minutes");
  });
});
