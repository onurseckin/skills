import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { generateSummarySuite } from "../../orchestrating-long-tasks/scripts/src/summary/generate-summary.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots) {
    try {
      await rm(root, { recursive: true, force: true });
    } catch {}
  }
  roots.length = 0;
});

async function setupExecutedRun(name: string) {
  const repo = await mkdtemp(join(tmpdir(), `harness-summary-${name}-`));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Build summary feature");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "gate.ts"), "console.log('gate ok');\n");

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
    "First Task",
    "--scope",
    "src/index.ts",
    "--gate",
    "bun gate.ts",
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

  const claim = await execute([
    "task:claim",
    "--run",
    run,
    "--task",
    "task-1",
    "--agent",
    "worker-1",
    "--role",
    "implementer",
  ]);
  const token = claim.token as string;

  // C4: task:submit refuses a submission whose write scope is byte-identical to its content at
  // claim, so the declared file has to actually exist and differ before it is claimed as changed.
  await writeFile(join(repo, "src/index.ts"), "export const built = true;\n");
  // A submission is only accepted against recorded evidence, so the implementer runs its own
  // command before it submits.
  await execute([
    "run:exec",
    "--run",
    run,
    "--task",
    "task-1",
    "--actor",
    "worker-1",
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
    "worker-1",
    "--token",
    token,
    "--summary",
    "Task 1 complete",
    "--files-changed",
    "src/index.ts",
  ]);
  const val = await execute([
    "task:validate-start",
    "--run",
    run,
    "--task",
    "task-1",
    "--validator",
    "validator-1",
  ]);
  const valToken = val.token as string;

  const gateExec = await execute([
    "run:exec",
    "--run",
    run,
    "--task",
    "task-1",
    "--gate",
    "gate-1",
    "--actor",
    "validator-1",
    "--cwd",
    repo,
    "--",
    "bun",
    "gate.ts",
  ]);
  const cmdId = gateExec.command_id as string;

  const probe = await execute([
    "task:probe",
    "--run",
    run,
    "--task",
    "task-1",
    "--validator",
    "validator-1",
    "--token",
    valToken,
    "--demand",
    "Prove the gate fails when the fix is reverted",
  ]);

  await execute([
    "task:review",
    "--run",
    run,
    "--task",
    "task-1",
    "--validator",
    "validator-1",
    "--token",
    valToken,
    "--evidence",
    cmdId,
    "--resolve",
    `${(probe.finding_ids as string[])[0]}=${cmdId}`,
    "--status",
    "pass",
    "--summary",
    "Passed",
  ]);

  return { repo, run };
}

describe("summary suite generation and CLI", () => {
  test("generates and exports summary suite files", async () => {
    const { repo, run } = await setupExecutedRun("sum-run");
    const outDir = join(repo, "gvui-data");

    const suite = generateSummarySuite({
      capsulePath: run,
      outDir,
      writeToDisk: true,
    });

    expect(suite.timeline.length).toBeGreaterThan(0);
    expect(suite.metrics.total_tasks).toBe(1);
    expect(suite.metrics.satisfied_tasks).toBe(1);
    expect(suite.graph.nodes.length).toBeGreaterThan(0);
    expect(suite.markdown).toContain("Execution Run Report");

    // Verify files on disk
    expect(existsSync(join(run, "summary", "timeline.json"))).toBe(true);
    expect(existsSync(join(run, "summary", "metrics.json"))).toBe(true);
    expect(existsSync(join(run, "summary", "graph.json"))).toBe(true);
    expect(existsSync(join(run, "summary", "summary.md"))).toBe(true);

    // Verify outDir export
    expect(existsSync(join(outDir, "sum-run.json"))).toBe(true);
  });

  test("CLI summary:export and summary:view commands", async () => {
    const { repo, run } = await setupExecutedRun("cli-sum-run");
    const outDir = join(repo, "gvui-export");

    const exportRes = await execute(["summary:export", "--run", run, "--out", outDir]);
    expect(String(exportRes.markdown)).toContain("Summary Suite Exported");
    expect(existsSync(join(outDir, "cli-sum-run.json"))).toBe(true);

    const viewRes = await execute(["summary:view", "--run", run]);
    expect(String(viewRes.markdown)).toContain("Execution Run Report");
  });
});
