import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";

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
    "--dep-reason",
    "task-core:secondary tests read the fixtures task-core writes",
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
    "--accept-audit",
    "A4-false-barrier:fixture orders lease/submission flows through task-sec on purpose, not a real read/write relationship",
  ]);
  return { repo, run };
}

// C4: task:submit refuses a submission whose write scope is byte-identical to its content at claim,
// so every fixture that goes on to declare task-core as changed has to actually change it first.
export async function markCoreImplemented(repo: string): Promise<void> {
  await mkdir(join(repo, "tests/unit/core"), { recursive: true });
  await writeFile(join(repo, "tests/unit/core/impl.ts"), "export const implemented = true;\n");
}
