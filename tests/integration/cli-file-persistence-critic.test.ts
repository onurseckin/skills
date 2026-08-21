import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { requirementIds } from "../unit/cli/critic-run-fixture.ts";
import { cleanupRoots } from "../unit/cli/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../unit/cli/file-persistence-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("Harness File Persistence - Critic Reports & Findings", () => {
  test("critic:reject and critic:review (request_changes/approve) record findings in state and write critic-review.json", async () => {
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
      "--role",
      "implementer",
    ]);
    // C4: task:submit refuses a submission whose write scope is byte-identical to its content at
    // claim, so the declared file has to actually exist and differ before it is claimed as changed.
    mkdirSync(join(repo, "tests/unit/core"), { recursive: true });
    writeFileSync(join(repo, "tests/unit/core/impl.ts"), "export const implemented = true;\n");
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
      claim.token as string,
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
      valStart.token as string,
      "--demand",
      "Prove the gate fails when the implementation regresses",
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
      "--resolve",
      `${(probe.finding_ids as string[])[0]}=${execGate.command_id as string}`,
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
      "--summary",
      "E2E verification tests missing",
      "--findings",
      JSON.stringify([
        {
          id: "finding-critic-01",
          requirement_id: requirementIds(run)[0],
          severity: "important",
          observation: "No end-to-end test exercises the run lifecycle",
          remediation: "Add a comprehensive E2E suite",
          revalidation: "bun test tests",
        },
      ]),
    ]);

    const expectedCriticReport = join(run, "reports", "critic-review.json");
    expect(existsSync(expectedCriticReport)).toBe(true);

    const criticFinding = await execute(["finding:get", "--run", run, "--id", "finding-critic-01"]);
    expect((criticFinding.finding as Record<string, unknown>).source).toBe("completeness-critic");
    expect(existsSync(join(run, "findings"))).toBe(false);

    // Query critic report via report:get
    const getCriticReport = await execute(["report:get", "--run", run, "--critic"]);
    expect(getCriticReport.path).toBe(expectedCriticReport);
    expect(String(getCriticReport.markdown)).toContain("### Report: `critic-review.json`");
  });
});
