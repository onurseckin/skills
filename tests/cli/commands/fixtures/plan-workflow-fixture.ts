import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { setupVirtualCliFS } from "./full-lifecycle-fixture.ts";

/** A freshly plan:init'd run with a throwaway repo and a synthetic multi-line prompt. */
export async function freshRun(
  name: string,
  roots: string[],
  promptLines: string[] = ["Line one", "Line two", "Line three"],
): Promise<{ repo: string; run: string }> {
  setupVirtualCliFS();
  const repo = `/virtual/cli/plan-workflow-${name}-${Math.random().toString(36).slice(2)}`;
  roots.push(repo);
  await mkdir(join(repo, ".git"), { recursive: true });
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, promptLines.join("\n"));
  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    name,
    "--prompt-file",
    promptPath,
  ]);
  return { repo, run: init.run_root as string };
}
