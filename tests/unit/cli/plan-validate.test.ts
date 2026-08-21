import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function compiledSingleTaskRun(name: string): Promise<{ repo: string; run: string }> {
  const repo = realpathSync(await mkdtemp(join(tmpdir(), `harness-plan-val-${name}-`)));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Single task run");
  await mkdir(join(repo, "tests/t1"), { recursive: true });
  await writeFile(
    join(repo, "tests/run.test.ts"),
    "import { test } from 'bun:test'; test('all', () => {});\n",
  );

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
    "task-1",
    "--label",
    "Task 1",
    "--scope",
    "tests/t1",
    "--gate",
    "bun test tests/t1",
    "--actor",
    "planner",
  ]);

  await execute([
    "plan:compile",
    "--run",
    run,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test tests",
  ]);

  return { repo, run };
}

describe("plan:validate-start / plan:review", () => {
  test("an approved review clears the plan for implementer dispatch", async () => {
    const { run } = await compiledSingleTaskRun("approve");
    const start = await execute(["plan:validate-start", "--run", run, "--validator", "plan-val-1"]);
    expect(start.token).toBeTruthy();
    expect(start.graph_revision).toBe(1);

    const review = await execute([
      "plan:review",
      "--run",
      run,
      "--validator",
      "plan-val-1",
      "--token",
      start.token as string,
      "--status",
      "approved",
      "--decomposition-answer",
      "One task matches the one-entity prompt.",
      "--dependency-answer",
      "No dependency edges exist.",
      "--gate-answer",
      "The gate runs only this task's own scoped test file.",
      "--straggler-answer",
      "There is only one task in the only wave.",
      "--summary",
      "Decomposition is sound.",
    ]);
    expect(review.verdict).toBe("approved");

    // The plan-validator's approval does not itself grant the task's own gate/requirement
    // preconditions — this asserts specifically that the C2 plan-validation guard in claimTask
    // does not refuse the claim, not that every other precondition is satisfied.
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-1",
      "--agent",
      "w1",
      "--role",
      "implementer",
    ]);
    expect((claim.task as { status: string }).status).toBe("leased");
  });

  test("a changes_requested review blocks every implementer claim against the live revision", async () => {
    const { run } = await compiledSingleTaskRun("reject");
    const start = await execute(["plan:validate-start", "--run", run, "--validator", "plan-val-1"]);

    const review = await execute([
      "plan:review",
      "--run",
      run,
      "--validator",
      "plan-val-1",
      "--token",
      start.token as string,
      "--status",
      "changes_requested",
      "--decomposition-answer",
      "n/a",
      "--dependency-answer",
      "n/a",
      "--gate-answer",
      "n/a",
      "--straggler-answer",
      "n/a",
      "--summary",
      "Gate cannot discriminate.",
      "--findings",
      JSON.stringify([
        {
          id: "PV-1",
          invariant: "A6-whole-suite-gate",
          severity: "critical",
          observation: "The gate is a whole-repository command shared across tasks.",
          remediation: "Scope the gate to this task's own test file.",
        },
      ]),
    ]);
    expect(review.verdict).toBe("changes_requested");

    await expect(
      execute([
        "task:claim",
        "--run",
        run,
        "--task",
        "task-1",
        "--agent",
        "w1",
        "--role",
        "implementer",
      ]),
    ).rejects.toThrow(/plan validation rejected/);
  });
});
