import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function setupCompiledRun(name: string) {
  const repo = realpathSync(await mkdtemp(join(tmpdir(), `harness-task-ops-${name}-`)));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Core unit tests\n\nSecondary tests");
  await mkdir(join(repo, "tests/unit/core"), { recursive: true });
  await mkdir(join(repo, "tests/unit/sec"), { recursive: true });
  await writeFile(join(repo, "gate-core.ts"), "console.log('gate-core');\n");
  await writeFile(join(repo, "gate-sec.ts"), "console.log('gate-sec');\n");

  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    name,
    "--prompt-file",
    promptPath,
  ]);
  const run = init.run_root as string;

  await execute([
    "plan:add",
    "--run",
    run,
    "--id",
    "task-core",
    "--label",
    "Core Unit Tests",
    "--scope",
    "tests/unit/core",
    "--gate",
    "bun gate-core.ts",
    "--actor",
    "planner",
  ]);

  await execute([
    "plan:add",
    "--run",
    run,
    "--id",
    "task-sec",
    "--label",
    "Secondary Tests",
    "--scope",
    "tests/unit/sec",
    "--gate",
    "bun gate-sec.ts",
    "--deps",
    "task-core",
    "--actor",
    "planner",
  ]);

  await execute(["plan:compile", "--run", run, "--actor", "planner"]);
  return { repo, run };
}

describe("CLI task-ops commands", () => {
  test("task:claim, task:heartbeat, task:submit, task:validate-start, task:review pass flow", async () => {
    const { repo, run } = await setupCompiledRun("task-pass-run");

    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-core",
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
    const { repo, run } = await setupCompiledRun("task-fail-run");

    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-core",
    ]);
    const workerToken = claim.token as string;

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
      "Test file too long",
      "--finding",
      "Split test file into smaller modules",
    ]);
    expect(reject.finding_id).toBeString();
    expect(String(reject.markdown)).toContain("### Task Rejected: task-core");
  });
});
