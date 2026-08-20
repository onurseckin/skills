import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";

/** Two tasks, one depending on the other, compiled and ready to be claimed. */
export async function setupCompiledRun(name: string, roots: string[]) {
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
