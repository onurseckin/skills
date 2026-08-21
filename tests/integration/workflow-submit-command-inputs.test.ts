import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "../unit/cli/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../unit/cli/file-persistence-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function claimed(name: string) {
  const { repo, run } = await setupCompiledRun(name, roots);
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
  const command = await execute([
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
  return { repo, run, token: claim.token as string, commandId: command.command_id as string };
}

describe("task:submit input handling", () => {
  test("without a determinable change set it refuses rather than inventing one", async () => {
    const { run, token } = await claimed("submit-inputs-missing");
    await expect(
      execute([
        "task:submit",
        "--run",
        run,
        "--task",
        "task-core",
        "--agent",
        "worker-core",
        "--token",
        token,
        "--summary",
        "Implemented the task under test",
      ]),
    ).rejects.toThrow("cannot determine files_changed for task-core");
  });

  test("--evidence is consumed and bound to the recorded command", async () => {
    const { repo, run, token, commandId } = await claimed("submit-inputs-evidence");
    // C4: task:submit refuses a submission whose write scope is byte-identical to its content at
    // claim, so the declared file has to actually exist and differ before it is claimed as changed.
    await writeFile(join(repo, "tests/unit/core/impl.ts"), "export const implemented = true;\n");
    const result = await execute([
      "task:submit",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-core",
      "--token",
      token,
      "--files-changed",
      "tests/unit/core/impl.ts",
      "--evidence",
      commandId,
      "--summary",
      "Implemented the task under test",
    ]);

    const task = result.task as { report: Record<string, unknown> };
    expect(task.report.checks).toEqual([{ command_id: commandId }]);
    expect(task.report.checks_evidence_class).toBe("agent_reported");
  });

  test("--evidence naming an unrecorded command is refused", async () => {
    const { run, token } = await claimed("submit-inputs-fake-evidence");
    await expect(
      execute([
        "task:submit",
        "--run",
        run,
        "--task",
        "task-core",
        "--agent",
        "worker-core",
        "--token",
        token,
        "--files-changed",
        "tests/unit/core/impl.ts",
        "--evidence",
        "cmd-task-core-gate",
        "--summary",
        "Implemented the task under test",
      ]),
    ).rejects.toThrow("submission evidence names no recorded command: cmd-task-core-gate");
  });

  test("--summary is mandatory: nothing stands in for the agent's own account", async () => {
    const { run, token } = await claimed("submit-inputs-no-summary");
    await expect(
      execute([
        "task:submit",
        "--run",
        run,
        "--task",
        "task-core",
        "--agent",
        "worker-core",
        "--token",
        token,
        "--files-changed",
        "tests/unit/core/impl.ts",
      ]),
    ).rejects.toThrow("--summary is required");
  });

  test("--summary cannot be combined with --report", async () => {
    const { repo, run, token } = await claimed("submit-inputs-summary-conflict");
    await expect(
      execute([
        "task:submit",
        "--run",
        run,
        "--task",
        "task-core",
        "--agent",
        "worker-core",
        "--token",
        token,
        "--report",
        join(repo, "submission.json"),
        "--summary",
        "Implemented the task under test",
      ]),
    ).rejects.toThrow("--report carries the whole submission");
  });

  test("--report supplies the whole submission and is actually used", async () => {
    const { repo, run, token, commandId } = await claimed("submit-inputs-report");
    // C4: task:submit refuses a submission whose write scope is byte-identical to its content at
    // claim, so the file the report below claims as changed has to actually exist and differ.
    await writeFile(
      join(repo, "tests/unit/core/from-report.ts"),
      "export const fromReport = true;\n",
    );
    const reportPath = join(repo, "submission.json");
    await writeFile(
      reportPath,
      JSON.stringify({
        summary: "report file submission",
        requirement_ids: ["req-core"],
        files_changed: ["tests/unit/core/from-report.ts"],
        checks: [{ command_id: commandId }],
        evidence: [{ path: "evidence/from-report.json" }],
      }),
    );

    const result = await execute([
      "task:submit",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-core",
      "--token",
      token,
      "--report",
      reportPath,
    ]);

    const task = result.task as { report: Record<string, unknown> };
    expect(task.report.summary).toBe("report file submission");
    expect(task.report.files_changed).toEqual(["tests/unit/core/from-report.ts"]);
  });

  test("--report cannot be mixed with the flag-built submission", async () => {
    const { repo, run, token } = await claimed("submit-inputs-conflict");
    await expect(
      execute([
        "task:submit",
        "--run",
        run,
        "--task",
        "task-core",
        "--agent",
        "worker-core",
        "--token",
        token,
        "--report",
        join(repo, "submission.json"),
        "--files-changed",
        "tests/unit/core/impl.ts",
      ]),
    ).rejects.toThrow("--report carries the whole submission");
  });
});
