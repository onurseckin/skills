import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { graphDocument } from "../graph/fixtures.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";
import { cleanupRoots, writeJson } from "./full-lifecycle-fixture.ts";
import { cleanInstallerFixtures, installerFixture } from "../installer/helpers.ts";

const roots: string[] = [];
afterEach(async () => {
  await cleanupRoots(roots);
  await cleanInstallerFixtures();
});

async function reportingFixture() {
  const repo = await mkdtemp(join(tmpdir(), "harness-cli-rep-"));
  roots.push(repo);
  const prompt = "Implement reporting testing";
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, prompt);
  const requirements = requirementsDocument(prompt);
  const graph = graphDocument(requirements);
  const requirementsPath = await writeJson(repo, "requirements.json", requirements);
  const graphPath = await writeJson(repo, "graph.json", graph);
  const init = await execute([
    "init",
    "--repo",
    repo,
    "--run-id",
    "rep-run",
    "--prompt-file",
    promptPath,
    "--capture-mode",
    "file",
    "--source-verified",
  ]);
  const run = init.run_root as string;
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
  return { repo, run };
}

describe("CLI reporting commands", () => {
  test("statusCommand and handoffCommand execute properly", async () => {
    const { run } = await reportingFixture();
    const status = await execute(["status", "--run", run]);
    expect(status.run_root).toBe(run);
    expect(status.counts).toBeObject();

    const handoff = await execute(["handoff", "--run", run]);
    expect(handoff.run_root).toBe(run);
    expect(handoff.path).toBeString();
  });

  test("doctorCommand validates flags and runs diagnostics", async () => {
    const { repo, run } = await reportingFixture();
    const installFix = await installerFixture();

    // Source without home
    await expect(
      execute(["doctor", "--run", run, "--source", installFix.source]),
    ).rejects.toThrow("doctor installation diagnostics require source and home together");

    // Home without source
    await expect(
      execute(["doctor", "--run", run, "--home", installFix.home]),
    ).rejects.toThrow("doctor installation diagnostics require source and home together");

    // Clients without source/home
    await expect(
      execute(["doctor", "--run", run, "--clients", "vscode"]),
    ).rejects.toThrow("--clients requires --source and --home");

    // Clients with whitespace / blank
    await expect(
      execute([
        "doctor",
        "--run",
        run,
        "--source",
        installFix.source,
        "--home",
        installFix.home,
        "--clients",
        "vscode, ",
      ]),
    ).rejects.toThrow("--clients must contain duplicate-free comma-separated names");

    // Clients with duplicates
    await expect(
      execute([
        "doctor",
        "--run",
        run,
        "--source",
        installFix.source,
        "--home",
        installFix.home,
        "--clients",
        "vscode,vscode",
      ]),
    ).rejects.toThrow("--clients must contain duplicate-free comma-separated names");

    // Valid doctor command without installation options
    const doctorBasic = await execute(["doctor", "--run", run]);
    expect(doctorBasic.run_root).toBe(run);
    expect(doctorBasic.installation).toBeNull();

    // Valid doctor command with installation options
    const doctorWithInstall = await execute([
      "doctor",
      "--run",
      run,
      "--source",
      installFix.source,
      "--home",
      installFix.home,
      "--clients",
      "claude",
    ]);
    expect(doctorWithInstall.run_root).toBe(run);
    expect(doctorWithInstall.installation).toBeObject();
  });
});
