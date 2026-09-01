import { afterEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";
import { requirementIds } from "../../fixtures/critic-run-fixture.ts";
import { registerInspectionCommand, setupReadyRun } from "../../fixtures/critic-ready-fixture.ts";
import {
  claimSubmitValidate,
  reviewPass,
  TASK_ID,
  VALIDATOR,
  runGate,
  recordProbe,
  answeredBy,
  seedGateProof,
} from "../../fixtures/probe-fixture.ts";
import { setupRun as setupSingleTaskRun } from "../../fixtures/probe-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("run:status", () => {
  test("reports Executing phase and occupancy once plan compiled", async () => {
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

  test("reports leased task agent and Leased status", async () => {
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

  test("reports validating task validator", async () => {
    const { repo, run } = await setupSingleTaskRun("run-status-validating", roots);
    await claimSubmitValidate(repo, run);
    const status = await execute(["run:status", "--run", run]);
    expect(String(status.markdown)).toContain(VALIDATOR);
  });

  test("reports done task Satisfied status once validated", async () => {
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
  test("summary:export writes summary suite to disk and reports artifact paths", async () => {
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

  test("summary:export honours --out with registry export path", async () => {
    const { repo, run } = await setupCompiledRun("summary-export-out", roots);
    const outDir = join(repo, "registry-out");
    await mkdir(outDir, { recursive: true });
    const exported = await execute(["summary:export", "--run", run, "--out", outDir]);
    expect(exported.out_dir).toBe(outDir);
    expect(String(exported.markdown)).toContain("GVUI Registry Export");
  });

  test("summary:view renders brief without writing anything to disk", async () => {
    const { run } = await setupCompiledRun("summary-view", roots);
    const viewed = await execute(["summary:view", "--run", run]);
    expect(typeof viewed.markdown).toBe("string");
    expect(viewed.metrics).toBeDefined();
    expect(viewed.timeline).toBeDefined();
  });
});
