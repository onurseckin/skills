import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("CLI run-ops commands", () => {
  test("run:status outputs dashboard markdown brief", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-run-stat-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Run status test prompt");

    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run",
      "status-run",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-status-1",
      "--label",
      "Task Status 1",
      "--scope",
      "tests/s1",
      "--gate",
      "bun test tests/s1",
      "--actor",
      "planner",
    ]);

    const statBefore = await execute(["run:status", "--run", run]);
    expect(String(statBefore.markdown)).toContain("### Run Status: status-run (Phase: Planning)");

    await execute(["plan:compile", "--run", run, "--actor", "planner"]);

    const statAfter = await execute(["run:status", "--run", run, "--detailed"]);
    expect(String(statAfter.markdown)).toContain("### Run Status: status-run (Phase: Executing)");
    expect(String(statAfter.markdown)).toContain("task-status-1");
  });

  test("run:exec runs monitored commands and records evidence", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-run-exec-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Run exec test prompt");

    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run",
      "exec-run",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;

    const execResult = await execute([
      "run:exec",
      "--run",
      run,
      "--cwd",
      repo,
      "--",
      "echo",
      "monitored execution proof",
    ]);
    expect(execResult.command).toBeObject();
    expect(String(execResult.markdown)).toContain("### Command Executed: `echo monitored execution proof`");
    expect(String(execResult.markdown)).toContain("Exit Code");
    expect(execResult.exit_code).toBe(0);
  });
});
