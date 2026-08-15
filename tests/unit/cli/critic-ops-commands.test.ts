import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function setupReadyRun(name: string) {
  const repo = realpathSync(await mkdtemp(join(tmpdir(), `harness-critic-${name}-`)));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Single task run");
  await mkdir(join(repo, "tests/t1"), { recursive: true });
  await mkdir(join(repo, "tests"), { recursive: true });
  await writeFile(join(repo, "gate-t1.ts"), "console.log('gate-t1');\n");
  await writeFile(
    join(repo, "tests/run.test.ts"),
    "import { test } from 'bun:test'; test('all', () => {});\n",
  );

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
    "Task 1",
    "--scope",
    "tests/t1",
    "--gate",
    "bun gate-t1.ts",
    "--actor",
    "planner",
  ]);

  await execute(["plan:compile", "--run", run, "--actor", "planner"]);

  const claim = await execute(["task:claim", "--run", run, "--task", "task-1", "--agent", "w1"]);
  const token = claim.token as string;
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

describe("CLI critic-ops commands", () => {
  test("critic:start and critic:review approve flow", async () => {
    const { repo, run } = await setupReadyRun("critic-approve-run");

    const execInspect = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "critic-alpha",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-t1.ts",
    ]);
    const cmdId = execInspect.command_id as string;

    const start = await execute([
      "critic:start",
      "--run",
      run,
      "--critic",
      "critic-alpha",
      "--repository-command-ids",
      cmdId,
    ]);
    expect(start.token).toBeString();
    expect(String(start.markdown)).toContain("### Completeness Critic Session Initialized");
    const criticToken = start.token as string;

    const review = await execute([
      "critic:review",
      "--run",
      run,
      "--critic",
      "critic-alpha",
      "--token",
      criticToken,
      "--decision",
      "approve",
      "--summary",
      "All requirements 100% verified with gate evidence",
    ]);
    expect(review.decision).toBe("approve");
    expect(String(review.markdown)).toContain("### Completeness Critic Sign-Off: APPROVED");
  });

  test("critic:review request_changes records findings", async () => {
    const { repo, run } = await setupReadyRun("critic-changes-run");

    const execInspect = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "critic-beta",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-t1.ts",
    ]);
    const cmdId = execInspect.command_id as string;

    const start = await execute([
      "critic:start",
      "--run",
      run,
      "--critic",
      "critic-beta",
      "--repository-command-ids",
      cmdId,
    ]);
    const criticToken = start.token as string;

    const review = await execute([
      "critic:review",
      "--run",
      run,
      "--critic",
      "critic-beta",
      "--token",
      criticToken,
      "--decision",
      "request_changes",
      "--summary",
      "Missing integration check",
      "--finding",
      "Add test for cross-module edge case",
    ]);
    expect(review.decision).toBe("request_changes");
    expect(String(review.markdown)).toContain(
      "### Completeness Critic Sign-Off: CHANGES REQUESTED",
    );
  });

  test("critic:reject records structured findings and integrates with plan:replan", async () => {
    const { repo, run } = await setupReadyRun("critic-reject-flow");

    const execInspect = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "critic-gamma",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-t1.ts",
    ]);
    const cmdId = execInspect.command_id as string;

    const start = await execute([
      "critic:start",
      "--run",
      run,
      "--critic",
      "critic-gamma",
      "--repository-command-ids",
      cmdId,
    ]);
    const criticToken = start.token as string;

    const findingsPayload = JSON.stringify([
      {
        id: "F-DRAWER-01",
        severity: "critical",
        file_paths: ["src/components/EdgeDetailDrawer/EdgeDrawer.tsx"],
        observation: "Missing toggle callback causing TS2322",
        remediation: "Add onToggle prop",
      },
      {
        id: "F-LAYOUT-01",
        severity: "important",
        file_paths: ["src/engine/layout/hierarchical.ts"],
        observation: "Negative coordinate clamping omitted",
        remediation: "Clamp coordinates to zero",
      },
    ]);

    const reject = await execute([
      "critic:reject",
      "--run",
      run,
      "--critic",
      "critic-gamma",
      "--token",
      criticToken,
      "--findings",
      findingsPayload,
      "--summary",
      "Rejected with 2 defects found",
    ]);

    expect(reject.decision).toBe("request_changes");
    expect(reject.findings_count).toBe(2);
    expect(String(reject.markdown)).toContain("CHANGES REQUESTED (Findings Recorded)");

    // Coordinator now triggers plan:replan directly reading recorded findings
    const replan = await execute([
      "plan:replan",
      "--run",
      run,
      "--actor",
      "coordinator",
    ]);

    expect(replan.revision).toBe(2);
    expect(replan.repair_round).toBe(1);
    expect((replan.new_tasks as string[]).length).toBe(2);
    expect(String(replan.markdown)).toContain("### Plan Recompiled: Wave R1 (Graph Revision 2)");
  });
});

