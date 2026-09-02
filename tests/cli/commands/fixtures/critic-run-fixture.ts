import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { setupVirtualCliFS } from "./full-lifecycle-fixture.ts";

/** Drives a single-task run all the way to "ready for the completeness critic". */
export async function setupReadyRun(name: string, roots: string[]) {
  const repo = `/virtual/cli/critic-run-${name}-${Math.random().toString(36).slice(2)}`;
  roots.push(repo);
  await mkdir(join(repo, ".git"), { recursive: true });
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Single task run");
  await mkdir(join(repo, "tests/t1"), { recursive: true });
  await mkdir(join(repo, "tests"), { recursive: true });
  await writeFile(
    join(repo, "gate-t1.ts"),
    "const fs = require('node:fs');\n" +
      "if (!fs.existsSync('tests/t1/impl.ts')) { console.error('tests/t1/impl.ts is missing'); process.exit(1); }\n" +
      "console.log('gate-t1');\n",
  );
  await writeFile(
    join(repo, "tests/run.test.ts"),
    "import { test } from 'bun:test'; test('all', () => {});\n",
  );
  await writeFile(join(repo, ".gitignore"), ".olt/capsules/\n");

  const uniqueRunName = `${name}-${Math.random().toString(36).slice(2)}`;
  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    uniqueRunName,
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
    "bun gate-t1.ts",
    "--actor",
    "planner",
  ]);

  await execute(["plan:brainstorm", "--run", run, "--actor", "planner"]);

  await execute([
    "plan:compile",
    "--run",
    run,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test tests",
  ]);

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
  const token = claim.token as string;
  // C4: task:submit refuses a submission whose write scope is byte-identical to its content at
  // claim, so the declared file has to actually exist and differ before it is claimed as changed.
  await writeFile(join(repo, "tests/t1/impl.ts"), "export const implemented = true;\n");
  // A submission is only accepted against recorded evidence, so the implementer runs its own
  // command before it submits.
  await execute([
    "run:exec",
    "--run",
    run,
    "--task",
    "task-1",
    "--actor",
    "w1",
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
    "task-1",
    "--agent",
    "w1",
    "--token",
    token,
    "--files-changed",
    "tests/t1/impl.ts",
    "--summary",
    "Implemented the task under test",
  ]);
  const val = await execute([
    "task:validate-start",
    "--run",
    run,
    "--task",
    "task-1",
    "--validator",
    "v1",
  ]);

  const execGate = await execute([
    "run:exec",
    "--run",
    run,
    "--task",
    "task-1",
    "--gate",
    "gate-1",
    "--actor",
    "v1",
    "--cwd",
    repo,
    "--",
    "bun",
    "gate-t1.ts",
  ]);
  const gateCmdId = execGate.command_id as string;

  const probe = await execute([
    "task:probe",
    "--run",
    run,
    "--task",
    "task-1",
    "--validator",
    "v1",
    "--token",
    val.token as string,
    "--demand",
    "Prove the gate exercises the changed branch",
  ]);

  await execute(["gate:prove", "--run", run, "--task", "task-1", "--actor", "coordinator"]);

  await execute([
    "task:review",
    "--run",
    run,
    "--task",
    "task-1",
    "--validator",
    "v1",
    "--token",
    val.token as string,
    "--evidence",
    gateCmdId,
    "--resolve",
    `${(probe.finding_ids as string[])[0]}=${gateCmdId}`,
    "--status",
    "pass",
  ]);

  const runGate = await execute([
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
  expect(runGate.exit_code).toBe(0);

  return { repo, run };
}

export function requirementIds(run: string): string[] {
  const capsule = JSON.parse(readFileSync(join(run, "state.json"), "utf-8")) as {
    requirements: { requirements: { id: string }[] };
  };
  return capsule.requirements.requirements.map(({ id }) => id);
}
