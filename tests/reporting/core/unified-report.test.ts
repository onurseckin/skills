import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  buildUnifiedReport,
  formatLeaseDecisions,
  generateUnifiedReport,
  type LeaseRecord,
  type ReplayContext,
  type DynamicTaskState,
} from "../../../olt/scripts/src/reporting/index.ts";
import { cleanupVirtualReportingFS, setupVirtualReportingFS, tempDir } from "../fixture.ts";

export const unifiedReportSuiteName = "Unified Master Reporting Dashboard";

async function createTestRun(name: string): Promise<{ repo: string; run: string }> {
  const repo = tempDir(`unified-report-test-${name}`);
  await mkdir(join(repo, ".git"), { recursive: true });
  await mkdir(join(repo, ".olt"), { recursive: true });
  const promptPath = join(repo, "prompt.txt");
  await writeFile(
    promptPath,
    "Unified dashboard requirement line 1.\nUnified dashboard requirement line 2.\n",
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
  return { repo, run: init.run_root as string };
}

describe(unifiedReportSuiteName, () => {
  beforeEach(() => {
    setupVirtualReportingFS();
  });

  afterEach(() => {
    cleanupVirtualReportingFS();
  });

  test("buildUnifiedReport and generateUnifiedReport assemble dashboard view", async () => {
    const { repo, run } = await createTestRun("test-dashboard-view");
    await mkdir(join(repo, "src/core"), { recursive: true });
    await writeFile(join(repo, "gate.ts"), "console.log('gate');\n");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-core",
      "--label",
      "Core Engine",
      "--scope",
      "src/core",
      "--gate",
      "bun gate.ts",
      "--requirement-lines",
      "1",
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
      "bun test tests",
    ]);

    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "implementer_03",
      "--role",
      "implementer",
      "--host",
      "cli",
    ]);

    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "implementer_03",
      "--role",
      "implementer",
    ]);

    const reportViaBuilder = buildUnifiedReport({ runRoot: run, detailed: true });
    const reportViaGenerator = generateUnifiedReport(run, { detailed: true });

    expect(reportViaBuilder.run_id).toBe("test-dashboard-view");
    expect(reportViaBuilder.phase).toBe("Executing");
    expect(reportViaBuilder.topology.total_tasks).toBe(1);
    expect(reportViaBuilder.lifecycle.implementers.count).toBe(1);
    expect(reportViaBuilder.agent_matrix.length).toBeGreaterThan(0);
    expect(reportViaBuilder.coordinator_ownership?.coordinatorId).toBeDefined();
    expect(reportViaBuilder.implementer_validator_tracking?.length).toBe(1);

    expect(reportViaGenerator.run_id).toBe(reportViaBuilder.run_id);
    expect(reportViaGenerator.markdown).toContain("Unified Run Report & Telemetry");
    expect(reportViaGenerator.markdown).toContain("`implementer_03`");
  });

  test("formatLeaseDecisions formats implementer-validator relationship and feedback rounds", () => {
    const leases: LeaseRecord[] = [
      {
        taskId: "task-backend",
        agentId: "implementer_03",
        role: "implementer",
        status: "leased",
        attempt: 2,
        pushes: 3,
        probes: 2,
        repairs: 1,
        validatorId: "validator_02",
        verdict: "in_review",
        expiresAt: "2026-08-29T18:00:00.000Z",
      },
      {
        taskId: "task-frontend",
        agentId: "implementer_04",
        role: "implementer",
        status: "ready",
        attempt: 1,
        pushes: 0,
        probes: 0,
        expiresAt: "2026-08-29T18:00:00.000Z",
      },
    ];

    const formatted = formatLeaseDecisions(leases);
    expect(formatted).toContain("`task-backend`");
    expect(formatted).toContain("`implementer_03`");
    expect(formatted).toContain("Verdict: in_review");
    expect(formatted).toContain("`task-frontend`");
    expect(formatted).toContain("Pushes: 0/5, Probes: 0/5");

    const emptyFormatted = formatLeaseDecisions([]);
    expect(emptyFormatted).toBe("*No active leases found.*");
  });

  test("ReplayContext and DynamicTaskState support dynamic expansion and null-safety", () => {
    const taskState: DynamicTaskState = {
      id: "task-dynamic-1",
      label: "Dynamic Task",
      status: "leased",
      role: "implementer",
      dependencies: ["task-root"],
      writeScope: ["src/feature/"],
      assignedAgent: "implementer_03",
      origin: "dynamic_expansion",
      createdAtSeq: 10,
      updatedAtSeq: 15,
      round: 2,
      attempt: 1,
      executionState: "running",
      activeTool: "write_to_file",
      activeCommand: null,
      activeStepIndex: 3,
      rejectionReason: null,
      validatorId: "validator_02",
    };

    const ctx: ReplayContext = {
      taskMap: new Map([[taskState.id, taskState]]),
      agentMap: new Map(),
      branches: new Set(["branch-1"]),
      sproutedRepairPairs: [],
      revision: 1,
      maxRoundReached: 2,
    };

    expect(ctx.taskMap.get("task-dynamic-1")?.assignedAgent).toBe("implementer_03");
    expect(ctx.taskMap.get("task-dynamic-1")?.origin).toBe("dynamic_expansion");
    expect(ctx.taskMap.get("task-dynamic-1")?.validatorId).toBe("validator_02");
    expect(ctx.branches.has("branch-1")).toBe(true);
    expect(ctx.revision).toBe(1);
  });

  test("transacted multi-agent micro-cycle telemetry is reflected in tracking matrix", async () => {
    const { repo, run } = await createTestRun("micro-cycle-tracking");
    await mkdir(join(repo, "src/auth"), { recursive: true });
    await writeFile(join(repo, "gate.ts"), "console.log('gate');\n");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-auth",
      "--label",
      "Auth Module",
      "--scope",
      "src/auth",
      "--gate",
      "bun gate.ts",
      "--requirement-lines",
      "1",
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
      "bun test tests",
    ]);

    transact(run, "coordinator", "task-updated", {}, (state) => {
      const task = state.tasks["task-auth"];
      if (task) {
        task.status = "leased";
        task.lease = {
          agent: "implementer_03",
          role: "implementer",
          attempt: 2,
          token_digest: "tok-test",
          issued_at: "2026-08-29T16:00:00.000Z",
          expires_at: "2026-08-29T16:30:00.000Z",
          duration_seconds: 1800,
          write_scope: ["src/auth"],
          resource_scope: [],
        };
        task.validations = [
          {
            validator_id: "validator_02",
            domain: "code",
            token_digest: "val-tok",
            attempt: 1,
            started_at: "2026-08-29T16:10:00.000Z",
            deadline_at: "2026-08-29T16:40:00.000Z",
          },
        ];
      }
    });

    const report = buildUnifiedReport({ runRoot: run, detailed: true });
    const tracking = report.implementer_validator_tracking ?? [];

    expect(tracking.length).toBe(1);
    expect(tracking[0]?.taskId).toBe("task-auth");
    expect(tracking[0]?.implementerId).toBe("implementer_03");
    expect(tracking[0]?.validatorId).toBe("validator_02");
    expect(tracking[0]?.microCycles).toContain("Attempts: 2/3");
    expect(report.markdown).toContain("`implementer_03` ──► `validator_02`");
  });
});
