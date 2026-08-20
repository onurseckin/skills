import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { readAgentLedger } from "../../../orchestrating-long-tasks/scripts/src/workflow/agents/ledger.ts";

export async function cleanupRoots(roots: string[]): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

/** A compiled capsule with `task-1` and `task-2`, which is the minimum a grant can bind to. */
export async function compiledCapsule(
  roots: string[],
  name: string,
  config: Record<string, number> = {},
): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `harness-${name}-`));
  roots.push(repo);
  if (Object.keys(config).length > 0) {
    // Written before the first command runs: the resolved config is cached per root pair.
    await writeFile(join(repo, "harness.config.json"), JSON.stringify(config));
  }
  const prompt = join(repo, "prompt.txt");
  await writeFile(prompt, "Build the thing.\nCover the thing with tests.\n");
  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run-id",
    name,
    "--prompt-file",
    prompt,
  ]);
  const run = String(init.run_root);
  for (const [id, scope] of [
    ["task-1", "src/one"],
    ["task-2", "src/two"],
  ]) {
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      id!,
      "--label",
      `Thing ${id}`,
      "--scope",
      scope!,
      "--gate",
      "bun test tests/unit/thing.test.ts",
      "--actor",
      "coordinator",
    ]);
  }
  await execute([
    "plan:compile",
    "--run",
    run,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test tests",
  ]);
  return run;
}

export function ledgerOf(run: string) {
  return readAgentLedger(loadRun(run).state);
}

export function eventKinds(run: string): string[] {
  return loadRun(run).events.map((event) => event.kind);
}

export async function registerCoordinator(run: string, id = "coordinator-1"): Promise<void> {
  await execute([
    "agent:register",
    "--run",
    run,
    "--agent",
    id,
    "--role",
    "coordinator",
    "--host",
    "claude-code",
  ]);
}
