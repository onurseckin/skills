import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./file-persistence-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("Harness File Persistence - Critic Reports & Findings", () => {
  test("critic:reject and critic:review (request_changes/approve) persist findings and critic-review.json", async () => {
    const { repo, run } = await setupCompiledRun("critic-persist", roots);

    // Complete task-core
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-core",
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
      claim.token as string,
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
      "task:review",
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
      "--status",
      "pass",
    ]);

    // Run completion gate
    await execute([
      "run:exec",
      "--run",
      run,
      "--gate",
      "gate-run-completion",
      "--actor",
      "coordinator",
      "--cwd",
      repo,
      "--",
      "bun",
      "test",
      "tests",
    ]);

    // Critic inspect repo
    const inspectCmd = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "critic-agent-1",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-core.ts",
    ]);

    // Start critic
    const startCritic = await execute([
      "critic:start",
      "--run",
      run,
      "--critic",
      "critic-agent-1",
      "--repository-command-ids",
      inspectCmd.command_id as string,
    ]);
    const criticToken = startCritic.token as string;

    // Critic reject with finding
    await execute([
      "critic:reject",
      "--run",
      run,
      "--critic",
      "critic-agent-1",
      "--token",
      criticToken,
      "--reason",
      "E2E verification tests missing",
      "--finding",
      "Add comprehensive E2E suite",
    ]);

    const expectedCriticReport = join(run, "reports", "critic-review.json");
    expect(existsSync(expectedCriticReport)).toBe(true);

    const criticFinding = join(run, "findings", "finding-critic-01.json");
    expect(existsSync(criticFinding)).toBe(true);

    // Query critic report via report:get
    const getCriticReport = await execute(["report:get", "--run", run, "--critic"]);
    expect(getCriticReport.path).toBe(expectedCriticReport);
    expect(String(getCriticReport.markdown)).toContain("### Report: `critic-review.json`");
  });
});
