import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "../unit/cli/full-lifecycle-fixture.ts";

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
    // B24.4: idle capacity is invisible unless it is a number — occupancy must be live, not
    // inherited from a topology no compile has recorded yet.
    // B27.2: the gate ceiling is reported alongside the general one, not only the number that
    // actually gated dispatch — an operator about to dispatch gate-heavy work needs both in view.
    expect(String(statBefore.markdown)).toContain(
      "**Occupancy**: 0/4 occupancy slots in use (gate ceiling",
    );
    expect(statBefore.occupancy).toMatchObject({ active: 0, max_parallel: 4 });
    expect(typeof (statBefore.occupancy as { gate_max_parallel: unknown }).gate_max_parallel).toBe(
      "number",
    );

    await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);

    const statAfter = await execute(["run:status", "--run", run, "--detailed"]);
    expect(String(statAfter.markdown)).toContain("### Run Status: status-run (Phase: Executing)");
    expect(String(statAfter.markdown)).toContain("task-status-1");
    // The one ready task holds no lease yet, so occupancy stays at zero even though the run is
    // now executing — occupancy counts leased/running/validating, never merely-claimable work.
    expect(String(statAfter.markdown)).toContain(
      "**Occupancy**: 0/4 occupancy slots in use (gate ceiling",
    );

    await execute(["queue:pop", "--run", run, "--agent", "worker-status"]);
    const statLeased = await execute(["run:status", "--run", run]);
    expect(String(statLeased.markdown)).toContain(
      "**Occupancy**: 1/4 occupancy slots in use (gate ceiling",
    );
    expect(statLeased.occupancy).toMatchObject({ active: 1, max_parallel: 4 });
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
      "--actor",
      "coordinator",
      "--cwd",
      repo,
      "--",
      "echo",
      "monitored execution proof",
    ]);
    expect(execResult.command).toBeObject();
    expect(String(execResult.markdown)).toContain(
      "### Command Executed: `echo monitored execution proof`",
    );
    expect(String(execResult.markdown)).toContain("Exit Code");
    expect(execResult.exit_code).toBe(0);
  });
});
