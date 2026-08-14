import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execute } from "../../src/cli/execute.ts";
import { graphDocument } from "../graph/fixtures.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function plannedRun(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "harness-cli-completion-"));
  roots.push(repo);
  const prompt = "First\n\nThird";
  const promptPath = join(repo, "prompt.txt");
  const requirements = requirementsDocument(prompt);
  const requirementsPath = join(repo, "requirements.json");
  const graphPath = join(repo, "graph.json");
  await writeFile(promptPath, prompt);
  await writeFile(requirementsPath, JSON.stringify(requirements));
  await writeFile(graphPath, JSON.stringify(graphDocument(requirements)));
  const initialized = await execute([
    "init",
    "--repo",
    repo,
    "--run-id",
    "completion-run",
    "--prompt-file",
    promptPath,
    "--capture-mode",
    "file",
    "--source-verified",
  ]);
  const run = initialized.run_root as string;
  await execute([
    "plan-apply",
    "--run",
    run,
    "--requirements",
    requirementsPath,
    "--graph",
    graphPath,
    "--expected-revision",
    "0",
    "--actor",
    "planner",
  ]);
  return run;
}

describe("CLI completeness lifecycle", () => {
  test("refuses critic authorization and completion before terminal readiness", async () => {
    const run = await plannedRun();
    await expect(execute(["begin-critic", "--run", run, "--critic", "critic"])).rejects.toThrow(
      "not ready",
    );
    await expect(execute(["complete", "--run", run, "--actor", "coordinator"])).rejects.toThrow(
      "incomplete",
    );
  });
});
