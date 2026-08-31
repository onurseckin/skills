import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import {
  establishSupervisorChain,
  registerUnderChain,
} from "../../support/agent-supervisor-chain.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";
import { requirementIds } from "./critic-run-fixture.ts";
import { registerInspectionCommand, setupReadyRun } from "./critic-ready-fixture.ts";
import {
  claimSubmitValidate,
  reviewPass,
  TASK_ID,
  VALIDATOR,
  runGate,
  recordProbe,
  answeredBy,
  seedGateProof,
} from "./probe-fixture.ts";
import { setupRun as setupSingleTaskRun } from "./probe-fixture.ts";
import { transact } from "../../olt/scripts/src/engine/store/index.ts";

/** Two independent (undependent) ready tasks — for the queue's own multi-candidate sort/partition branches. */
async function setupTwoIndependentTasks(
  name: string,
  roots2: string[],
): Promise<{ repo: string; run: string }> {
  const repo = await mkdtemp(join(tmpdir(), `harness-queue-independent-${name}-`));
  roots2.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Do task one\n\nDo task two");
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
    "task-alpha",
    "--label",
    "Alpha",
    "--scope",
    "src/alpha",
    "--gate",
    "bun test src/alpha",
    "--priority",
    "40",
    "--actor",
    "planner",
  ]);
  await execute([
    "plan:add",
    "--run",
    run,
    "--id",
    "task-beta",
    "--label",
    "Beta",
    "--scope",
    "src/beta",
    "--gate",
    "bun test src/beta",
    "--priority",
    "90",
    "--actor",
    "planner",
  ]);
  await execute(["plan:brainstorm", "--run", run, "--actor", "planner"]);
  await execute([
    "plan:compile",
    "--run",
    run,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test src",
  ]);
  const chain = await establishSupervisorChain(run);
  for (const agent of ["worker-1", "worker-2"]) {
    await registerUnderChain(run, chain, agent, "implementer");
  }
  return { repo, run };
}

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("queue:next / queue:list / queue:wave / queue:pop", () => {
  test("queue:next reports the highest-priority ready task, or an empty markdown when nothing is ready", async () => {
    const { run } = await setupCompiledRun("queue-next", roots);
    const next = await execute(["queue:next", "--run", run]);
    expect((next.task as { id: string }).id).toBe("task-core");
    expect(String(next.markdown)).toContain("task-core");
  });

  test("with two ready tasks, queue:next ranks by priority (the comparator actually runs)", async () => {
    const { run } = await setupTwoIndependentTasks("queue-next-two-ready", roots);
    const next = await execute(["queue:next", "--run", run]);
    expect((next.task as { id: string }).id).toBe("task-beta");
  });

  test("queue:next reports an empty queue once every task is leased", async () => {
    const { repo, run } = await setupCompiledRun("queue-next-empty", roots);
    void repo;
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    const next = await execute(["queue:next", "--run", run]);
    expect(next.task).toBeNull();
    expect(String(next.markdown).length).toBeGreaterThan(0);
  });

  test("queue:list partitions ready, leased, validating and blocked tasks", async () => {
    const { run } = await setupCompiledRun("queue-list", roots);
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    const listed = await execute(["queue:list", "--run", run]);
    const partitions = listed.partitions as {
      ready: string[];
      leased: { id: string; agent: string }[];
      blocked: { id: string; waitingOn: string[] }[];
    };
    expect(partitions.leased).toEqual([{ id: "task-core", agent: "worker-1" }]);
    expect(partitions.blocked).toEqual([{ id: "task-sec", waitingOn: ["task-core"] }]);
  });

  test("queue:list reports a validating task and a done task in their own partitions", async () => {
    const { run } = await setupTwoIndependentTasks("queue-list-validating-done", roots);
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-alpha",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    transact(run, "test-seed", "seed-validating-status-for-test", {}, (state) => {
      const task = (state.tasks as Record<string, { status: string }>)["task-alpha"]!;
      task.status = "validating";
    });
    transact(run, "test-seed", "seed-done-status-for-test", {}, (state) => {
      const task = (state.tasks as Record<string, { status: string }>)["task-beta"]!;
      task.status = "done";
    });
    const listed = await execute(["queue:list", "--run", run]);
    const partitions = listed.partitions as { validating: string[]; satisfied: string[] };
    expect(partitions.validating).toEqual(["task-alpha"]);
    expect(partitions.satisfied).toEqual(["task-beta"]);
  });

  test("queue:wave reports every claimable task ranked by the recorded topology, capped by --max-parallel", async () => {
    const { run } = await setupCompiledRun("queue-wave", roots);
    const wave = await execute(["queue:wave", "--run", run, "--max-parallel", "1"]);
    expect((wave.wave as unknown[]).length).toBe(1);
    expect(wave.max_parallel).toBe(1);
  });

  test("queue:wave reports an empty markdown once nothing is claimable", async () => {
    const { run } = await setupCompiledRun("queue-wave-empty", roots);
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    const wave = await execute(["queue:wave", "--run", run]);
    expect(wave.wave).toEqual([]);
    expect(String(wave.markdown).length).toBeGreaterThan(0);
  });

  test("with two ready tasks, queue:pop ranks by priority (the comparator actually runs)", async () => {
    const { run } = await setupTwoIndependentTasks("queue-pop-two-ready", roots);
    const popped = await execute(["queue:pop", "--run", run, "--agent", "worker-1"]);
    expect((popped.task as { id: string }).id).toBe("task-beta");
  });

  test("queue:pop atomically claims the highest-priority ready task", async () => {
    const { run } = await setupCompiledRun("queue-pop", roots);
    const popped = await execute(["queue:pop", "--run", run, "--agent", "worker-1"]);
    expect(typeof popped.token).toBe("string");
    expect((popped.task as { id: string }).id).toBe("task-core");
    expect(popped.packet_id).toBeDefined();
  });

  test("queue:pop refuses when no task is ready", async () => {
    const { run } = await setupCompiledRun("queue-pop-empty", roots);
    await execute(["queue:pop", "--run", run, "--agent", "worker-1"]);
    await expect(execute(["queue:pop", "--run", run, "--agent", "worker-2"])).rejects.toThrow(
      /no ready tasks available in queue to pop/,
    );
  });

  test("queue:pop honours an explicit --lease-duration", async () => {
    const { run } = await setupCompiledRun("queue-pop-lease", roots);
    const popped = await execute([
      "queue:pop",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--lease-duration",
      "600",
    ]);
    expect(typeof popped.token).toBe("string");
  });
});

describe("run:status", () => {
  test("reports the Executing phase and occupancy once a plan is compiled", async () => {
    const { run } = await setupCompiledRun("run-status-executing", roots);
    const status = await execute(["run:status", "--run", run]);
    expect(String(status.markdown)).toContain("Executing");
    const catalogue = status.catalogue as { available: boolean };
    expect(catalogue.available).toBe(true);
    const occupancy = status.occupancy as { active: number; max_parallel: number };
    expect(occupancy.max_parallel).toBeGreaterThan(0);
  });

  test("--detailed is echoed through to the result", async () => {
    const { run } = await setupCompiledRun("run-status-detailed", roots);
    const status = await execute(["run:status", "--run", run, "--detailed"]);
    expect(status.detailed).toBe(true);
  });

  test("reports a leased task's agent and the Leased status emoji", async () => {
    const { run } = await setupCompiledRun("run-status-leased", roots);
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    const status = await execute(["run:status", "--run", run]);
    expect(String(status.markdown)).toContain("worker-1");
  });

  test("reports a validating task's validator and the Validating status", async () => {
    const { repo, run } = await setupSingleTaskRun("run-status-validating", roots);
    await claimSubmitValidate(repo, run);
    const status = await execute(["run:status", "--run", run]);
    expect(String(status.markdown)).toContain(VALIDATOR);
  });

  test("reports a done task's Satisfied status once validated", async () => {
    const { repo, run } = await setupSingleTaskRun("run-status-satisfied", roots);
    const validation = await claimSubmitValidate(repo, run);
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const probed = await recordProbe(run, validation.token as string, "Prove it");
    seedGateProof(run, TASK_ID);
    await execute(
      reviewPass(run, validation.token as string, gateCmd, answeredBy(probed.finding_ids, gateCmd)),
    );
    const status = await execute(["run:status", "--run", run]);
    expect(String(status.markdown)).toContain("Satisfied");
  });
});

// run:complete's happy path is not exercised here: verifyCompletionArtifacts (run-ops.ts) re-reads
// every cited command's real attempt files from disk (signed attempt-started.json, activity log,
// stdout/stderr with matching byte counts and digests) via verifyCommandRecord. critic-ready-
// fixture.ts's fabricated CommandRecords satisfy the critic's own structural check but were never
// backed by real attempt files, so completion artifact verification genuinely requires commands
// produced by the real runner (run:exec) — this is a legitimate integration-only surface; see the
// summary's findings.
describe("run:complete", () => {
  test("refuses an invalid auth token", async () => {
    const { repo, run } = await setupReadyRun("run-complete-bad-token", roots);
    const cmdId = "C-INSPECT-BADTOKEN";
    registerInspectionCommand(run, repo, cmdId, "critic-2");
    const start = await execute([
      "critic:start",
      "--run",
      run,
      "--critic",
      "critic-2",
      "--repository-command-ids",
      cmdId,
    ]);
    const evidence = [{ kind: "command", reference: cmdId, observation: "gate covers it" }];
    const proofs = JSON.stringify(
      requirementIds(run).map((id) => ({ requirement_id: id, status: "satisfied", evidence })),
    );
    await execute([
      "critic:review",
      "--run",
      run,
      "--critic",
      "critic-2",
      "--token",
      start.token as string,
      "--decision",
      "approve",
      "--proofs",
      proofs,
      "--summary",
      "All requirements verified",
    ]);
    await expect(
      execute([
        "run:complete",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--auth-token",
        "not-the-real-token",
      ]),
    ).rejects.toThrow(/completion authorization token is invalid/);
  });
});

describe("summary:export / summary:view", () => {
  test("summary:export writes the summary suite to disk and reports its artifact paths", async () => {
    const { run } = await setupCompiledRun("summary-export", roots);
    const exported = await execute(["summary:export", "--run", run]);
    expect(exported.summary_dir).toBe(join(run, "summary"));
    expect(String(exported.markdown)).toContain("Summary Suite Exported");
    const suite = exported.suite as {
      graph: { nodes: unknown[] };
      metrics: { total_tasks: number };
    };
    expect(suite.metrics.total_tasks).toBe(2);
  });

  test("summary:export honours --out with a registry export path", async () => {
    const { repo, run } = await setupCompiledRun("summary-export-out", roots);
    const outDir = join(repo, "registry-out");
    await mkdir(outDir, { recursive: true });
    const exported = await execute(["summary:export", "--run", run, "--out", outDir]);
    expect(exported.out_dir).toBe(outDir);
    expect(String(exported.markdown)).toContain("GVUI Registry Export");
  });

  test("summary:view renders the brief without writing anything to disk", async () => {
    const { run } = await setupCompiledRun("summary-view", roots);
    const viewed = await execute(["summary:view", "--run", run]);
    expect(typeof viewed.markdown).toBe("string");
    expect(viewed.metrics).toBeDefined();
    expect(viewed.timeline).toBeDefined();
  });
});
