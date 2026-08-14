import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execute } from "../../src/cli/execute.ts";
import { graphDocument } from "../graph/fixtures.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";
import { runStateAssertion, writeJson } from "./full-lifecycle-fixture.ts";

export interface PlannedFixture {
  repo: string;
  run: string;
  reportPath: string;
}

export async function plannedFixture(roots: string[]): Promise<PlannedFixture> {
  const repo = await mkdtemp(join(tmpdir(), "harness-cli-scenario-"));
  roots.push(repo);
  const prompt = "Implement one independently verified change";
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, prompt);
  await writeFile(join(repo, "gate-check.ts"), "console.log('gate-ok');\n");
  const requirements = requirementsDocument(prompt);
  const graph = graphDocument(requirements);
  for (const gate of graph.gates as Record<string, unknown>[]) {
    gate.command = runStateAssertion();
  }
  const requirementsPath = await writeJson(repo, "requirements.json", requirements);
  const graphPath = await writeJson(repo, "graph.json", graph);
  const reportPath = await writeJson(repo, "submission.json", {
    summary: "implemented",
    requirement_ids: ["R-001"],
    files_changed: ["src/area-1"],
    checks: [{ command: "focused check", status: "passed" }],
    evidence: [{ kind: "diff", path: "src/area-1" }],
  });
  const initialized = await execute([
    "init",
    "--repo",
    repo,
    "--run-id",
    "scenario-run",
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
  return { repo, run, reportPath };
}

export async function claimAndSubmit(
  fixture: PlannedFixture,
  agent: string,
  role: "implementer" | "repairer",
): Promise<void> {
  const claim = await execute([
    "claim",
    "--run",
    fixture.run,
    "--task",
    "task-1",
    "--agent",
    agent,
    "--role",
    role,
  ]);
  await execute([
    "packet",
    "--run",
    fixture.run,
    "--task",
    "task-1",
    "--role",
    role,
    "--agent",
    agent,
    "--token",
    claim.token as string,
    "--id",
    `task-1-${role}-${agent}`,
  ]);
  await execute([
    "submit",
    "--run",
    fixture.run,
    "--task",
    "task-1",
    "--agent",
    agent,
    "--token",
    claim.token as string,
    "--report",
    fixture.reportPath,
  ]);
}
