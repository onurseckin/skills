import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { graphDocument } from "../graph/fixtures.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";
import { cleanupRoots, writeJson } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function capsuleFixture() {
  const repo = await mkdtemp(join(tmpdir(), "harness-cli-capsule-"));
  roots.push(repo);
  const prompt = "Implement capsule test prompt";
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, prompt);
  const requirements = requirementsDocument(prompt);
  const graph = graphDocument(requirements);
  const requirementsPath = await writeJson(repo, "requirements.json", requirements);
  const graphPath = await writeJson(repo, "graph.json", graph);
  return { repo, prompt, promptPath, requirementsPath, graphPath };
}

describe("CLI capsule commands", () => {
  test("initCommand handles stdin unavailability and custom runtime source", async () => {
    const fixture = await capsuleFixture();
    await expect(
      execute([
        "init",
        "--repo",
        fixture.repo,
        "--run-id",
        "stdin-fail-run",
        "--prompt-stdin",
        "--capture-mode",
        "file",
        "--source-verified",
      ]),
    ).rejects.toThrow("prompt stdin is unavailable");

    const initialized = await execute([
      "init",
      "--repo",
      fixture.repo,
      "--run-id",
      "runtime-source-run",
      "--prompt-file",
      fixture.promptPath,
      "--capture-mode",
      "file",
      "--source-verified",
      "--runtime-source",
      fixture.repo,
    ]);
    expect(initialized.run_root).toBeString();
  });

  test("validateCommand enforces requirement and graph pairing and evaluates plan issues", async () => {
    const fixture = await capsuleFixture();
    const initialized = await execute([
      "init",
      "--repo",
      fixture.repo,
      "--run-id",
      "val-cmd-run",
      "--prompt-file",
      fixture.promptPath,
      "--capture-mode",
      "file",
      "--source-verified",
    ]);
    const run = initialized.run_root as string;

    // Validate without plans checks integrity only
    const integrityOnly = await execute(["validate", "--run", run]);
    expect(integrityOnly.valid).toBe(true);
    expect(integrityOnly.integrity_issues).toEqual([]);
    expect(integrityOnly.plan_issues).toEqual([]);

    // Requirements provided without graph throws
    await expect(
      execute(["validate", "--run", run, "--requirements", fixture.requirementsPath]),
    ).rejects.toThrow("requirements and graph must be provided together");

    // Graph provided without requirements throws
    await expect(
      execute(["validate", "--run", run, "--graph", fixture.graphPath]),
    ).rejects.toThrow("requirements and graph must be provided together");

    // Both provided returns valid plan issues
    const fullValidate = await execute([
      "validate",
      "--run",
      run,
      "--requirements",
      fixture.requirementsPath,
      "--graph",
      fixture.graphPath,
    ]);
    expect(fullValidate.valid).toBe(true);
    expect(fullValidate.plan_issues).toEqual([]);
  });

  test("projectionRecoveryCommand recovers projection state", async () => {
    const fixture = await capsuleFixture();
    const initialized = await execute([
      "init",
      "--repo",
      fixture.repo,
      "--run-id",
      "recover-proj-run",
      "--prompt-file",
      fixture.promptPath,
      "--capture-mode",
      "file",
      "--source-verified",
    ]);
    const run = initialized.run_root as string;
    const recovered = await execute(["projection-recover", "--run", run, "--actor", "coordinator"]);
    expect(recovered.run_root).toBe(run);
    expect(recovered.state).toBeObject();
  });
});
