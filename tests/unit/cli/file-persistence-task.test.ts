import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./file-persistence-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("Harness File Persistence - Task Reports & Review", () => {
  test("task:reject and task:review (fail) record findings in state and reports on disk, inspected via finding:get and report:get", async () => {
    const { repo, run } = await setupCompiledRun("task-fail-persist", roots);

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
      "Missing test coverage for boundary conditions",
      "--finding",
      "Add edge case tests",
    ]);

    const findingId = reject.finding_id as string;
    expect(findingId).toBe("finding-task-core-reject");

    // A finding has one home, and it is the chain-bound projection rather than a loose file.
    expect(existsSync(join(run, "findings"))).toBe(false);

    const findingData = (await execute(["finding:get", "--run", run, "--id", findingId]))
      .finding as Record<string, unknown>;
    expect(findingData.id).toBe(findingId);
    expect(findingData.observation).toBe("Missing test coverage for boundary conditions");
    expect(findingData.remediation).toBe("Add edge case tests");
    expect(findingData.task_id).toBe("task-core");

    const expectedReportPath = join(run, "reports", "task-core-review.json");
    expect(existsSync(expectedReportPath)).toBe(true);

    // Test finding:get with specific ID
    const getFinding = await execute(["finding:get", "--run", run, "--id", findingId]);
    expect(getFinding.id).toBe(findingId);
    expect(String(getFinding.markdown)).toContain(`### Finding Detail: \`${findingId}\``);

    // Test finding:get list
    const listFindings = await execute(["finding:get", "--run", run]);
    expect(listFindings.count).toBeGreaterThanOrEqual(1);

    // Test report:get for task
    const getReport = await execute(["report:get", "--run", run, "--task", "task-core"]);
    expect(getReport.path).toBe(expectedReportPath);
    expect(String(getReport.markdown)).toContain("### Report: `task-core-review.json`");

    // Test report:get listing
    const listReports = await execute(["report:get", "--run", run]);
    expect(listReports.count).toBeGreaterThanOrEqual(1);
  });

  test("task:review (pass) persists task review report and allows distinct retrieval of submission and review reports", async () => {
    const { repo, run } = await setupCompiledRun("task-pass-persist", roots);

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
      "--summary",
      "Submission for task-core",
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
      "Prove the suite fails when the assertion is inverted",
    ]);

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
      execGate.command_id as string,
      "--resolve",
      `${(probe.finding_ids as string[])[0]}=${execGate.command_id as string}`,
      "--status",
      "pass",
      "--summary",
      "All unit tests pass",
    ]);
    expect(review.verdict).toBe("pass");

    const expectedReportPath = join(run, "reports", "task-core-review.json");
    expect(existsSync(expectedReportPath)).toBe(true);

    const expectedSubmissionPath = join(run, "reports", "task-core-submission.json");
    expect(existsSync(expectedSubmissionPath)).toBe(true);

    const reportContent = JSON.parse(readFileSync(expectedReportPath, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(reportContent.task_id).toBe("task-core");
    expect(reportContent.status).toBe("pass");
    expect(reportContent.verdict).toBe("pass");

    // Retrieve review report via report:get --task task-core --review
    const getReview1 = await execute([
      "report:get",
      "--run",
      run,
      "--task",
      "task-core",
      "--review",
    ]);
    expect(getReview1.path).toBe(expectedReportPath);

    const getReview2 = await execute([
      "report:get",
      "--run",
      run,
      "--task",
      "task-core",
      "--type",
      "review",
    ]);
    expect(getReview2.path).toBe(expectedReportPath);

    // Retrieve submission report via report:get --task task-core --submission
    const getSub1 = await execute([
      "report:get",
      "--run",
      run,
      "--task",
      "task-core",
      "--submission",
    ]);
    expect(getSub1.path).toBe(expectedSubmissionPath);
    expect(String(getSub1.markdown)).toContain("### Report: `task-core-submission.json`");

    const getSub2 = await execute([
      "report:get",
      "--run",
      run,
      "--task",
      "task-core",
      "--type",
      "submission",
    ]);
    expect(getSub2.path).toBe(expectedSubmissionPath);

    const getSub3 = await execute([
      "report:get",
      "--run",
      run,
      "--task",
      "task-core",
      "--stage",
      "submission",
    ]);
    expect(getSub3.path).toBe(expectedSubmissionPath);
  });
});
