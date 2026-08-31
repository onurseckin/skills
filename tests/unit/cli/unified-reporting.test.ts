import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import {
  reportDagCommand,
  reportDecisionsCommand,
  reportGraphCommand,
  reportGraphJsonCommand,
  reportHealthCommand,
  reportLeasesCommand,
  reportUnifiedCommand,
} from "../../../olt/scripts/src/cli/commands/unified-reporting.ts";
import {
  extractLeaseAgentId,
  extractLeaseRole,
  extractLeaseAttempt,
} from "../../../olt/scripts/src/reporting/lease-agent-extractor.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function createBaseRun(name: string): Promise<{ repo: string; run: string }> {
  const repo = realpathSync(await mkdtemp(join(tmpdir(), `harness-unified-reporting-${name}-`)));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(
    promptPath,
    "Build modular system with API backend, UI frontend, and automated testing.\nSecond requirement line for data storage.\n",
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

describe("Unified Reporting CLI Surface", () => {
  test("report command renders complete topology, lifecycle tiers, and occupancy", async () => {
    const { repo, run } = await createBaseRun("report-cmd-basic");

    await mkdir(join(repo, "src/api"), { recursive: true });
    await writeFile(join(repo, "gate.ts"), "console.log('gate');\n");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-api",
      "--label",
      "API Layer",
      "--scope",
      "src/api",
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
      "impl-worker-1",
      "--role",
      "implementer",
      "--host",
      "antigravity",
    ]);

    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-api",
      "--agent",
      "impl-worker-1",
      "--role",
      "implementer",
    ]);

    const report = (await execute([
      "report",
      "--run",
      run,
      "--detailed",
    ])) as unknown as UnifiedReport;

    expect(report.run_id).toBe("report-cmd-basic");
    expect(report.topology.total_tasks).toBe(1);
    expect(report.lifecycle.implementers.count).toBe(1);
    expect(report.lifecycle.implementers.active[0]?.agentId).toBe("impl-worker-1");
    expect(report.lifecycle.implementers.active[0]?.taskId).toBe("task-api");
    expect(report.markdown).toContain("Unified Run Report & Telemetry");
    expect(report.markdown).toContain("`impl-worker-1`");
    expect(report.markdown).toContain("`task-api`");
    expect(report.markdown).not.toContain("undefined");
  });

  test("run:status delineates active implementers, validators, and standby tasks", async () => {
    const { repo, run } = await createBaseRun("run-status-delineation");

    await mkdir(join(repo, "src/auth"), { recursive: true });
    await mkdir(join(repo, "src/db"), { recursive: true });
    await writeFile(join(repo, "gate-auth.ts"), "console.log('auth');\n");
    await writeFile(join(repo, "gate-db.ts"), "console.log('db');\n");

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
      "bun gate-auth.ts",
      "--requirement-lines",
      "1",
      "--actor",
      "planner",
    ]);

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-db",
      "--label",
      "DB Layer",
      "--scope",
      "src/db",
      "--gate",
      "bun gate-db.ts",
      "--requirement-lines",
      "2",
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
      "impl-auth-1",
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
      "task-auth",
      "--agent",
      "impl-auth-1",
      "--role",
      "implementer",
    ]);

    const statusResult = (await execute(["run:status", "--run", run])) as Record<string, unknown>;
    const occupancy = statusResult.occupancy as Record<string, unknown>;

    expect(occupancy.implementers).toBe(1);
    expect(occupancy.standby).toBe(1);
    expect(occupancy.summary as string).toContain("1 Implementer(s) coding");
    expect(occupancy.summary as string).toContain("1 Standby ready");
    expect(statusResult.markdown as string).toContain("`task-auth`");
    expect(statusResult.markdown as string).toContain("Leased (impl-auth-1 [implementer])");
    expect(statusResult.markdown as string).not.toContain("undefined");
  });

  test("report:leases and report:decisions format durable records cleanly", async () => {
    const { repo, run } = await createBaseRun("leases-decisions");

    await mkdir(join(repo, "src/core"), { recursive: true });
    await writeFile(join(repo, "gate.ts"), "console.log('gate');\n");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-core",
      "--label",
      "Core",
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
      "impl-core-1",
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
      "impl-core-1",
      "--role",
      "implementer",
    ]);

    const leasesResult = (await execute(["report:leases", "--run", run])) as Record<
      string,
      unknown
    >;
    expect(leasesResult.matrix).toBeDefined();
    expect(leasesResult.markdown as string).toContain("`impl-core-1`");
    expect(leasesResult.markdown as string).not.toContain("undefined");

    const decisionsResult = (await execute(["report:decisions", "--run", run])) as Record<
      string,
      unknown
    >;
    expect(decisionsResult.decisions).toBeDefined();
  });

  test("robust lease agent extraction handles legacy agent field and prevents undefined in CLI outputs", async () => {
    const { repo, run } = await createBaseRun("legacy-lease-extraction");

    await mkdir(join(repo, "src/legacy"), { recursive: true });
    await writeFile(join(repo, "gate.ts"), "console.log('legacy');\n");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-legacy",
      "--label",
      "Legacy Task",
      "--scope",
      "src/legacy",
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

    // Transact state with only `agent` property on lease (no `agent_id`)
    transact(run, "coordinator", "task-updated", {}, (state) => {
      const task = state.tasks["task-legacy"];
      if (task) {
        task.status = "leased";
        task.lease = {
          agent: "legacy-worker-99",
          role: "implementer",
          attempt: 1,
          token_digest: "tok-leg",
          issued_at: "2026-08-22T08:00:00.000Z",
          expires_at: "2026-08-22T08:20:00.000Z",
          heartbeat_at: "2026-08-22T08:05:00.000Z",
          duration_seconds: 1200,
        };
      }
    });

    const statusResult = (await execute(["run:status", "--run", run])) as Record<string, unknown>;
    expect(statusResult.markdown as string).toContain("Leased (legacy-worker-99 [implementer])");
    expect(statusResult.markdown as string).not.toContain("Leased (undefined");

    const dagResult = (await execute(["dag", "--run", run])) as Record<string, unknown>;
    expect(dagResult.markdown as string).toContain("legacy-worker-99");
    expect(dagResult.markdown as string).not.toContain("undefined");

    const reportResult = (await execute([
      "report",
      "--run",
      run,
      "--detailed",
    ])) as unknown as UnifiedReport;
    expect(reportResult.lifecycle.implementers.active[0]?.agentId).toBe("legacy-worker-99");
    expect(reportResult.markdown).toContain("legacy-worker-99");
    expect(reportResult.markdown).not.toContain("`undefined`");
  });

  test("lease-agent-extractor exports extractLeaseAgentId, extractLeaseRole, and extractLeaseAttempt", () => {
    expect(extractLeaseAgentId({ agent_id: "agent-10" })).toBe("agent-10");
    expect(extractLeaseAgentId({ agent: "agent-20" })).toBe("agent-20");
    expect(extractLeaseRole({ role: "coordinator" })).toBe("coordinator");
    expect(extractLeaseRole({})).toBe("implementer");
    expect(extractLeaseAttempt({ attempt: 2 })).toBe(2);
    expect(extractLeaseAttempt({})).toBe(1);
  });

  test("monolithic default report view combines Sugiyama DAG, doctor checks, metrics, and allocations", async () => {
    const { repo, run } = await createBaseRun("monolithic-report-view");

    await mkdir(join(repo, "src/api"), { recursive: true });
    await writeFile(join(repo, "gate-api.ts"), "console.log('api gate');\n");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-api",
      "--label",
      "API Layer",
      "--scope",
      "src/api",
      "--gate",
      "bun gate-api.ts",
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
      "worker-monolith",
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
      "task-api",
      "--agent",
      "worker-monolith",
      "--role",
      "implementer",
    ]);

    // 1. Unified report verification
    const report = (await execute(["report", "--run", run])) as unknown as UnifiedReport;
    expect(report.dag).toBeDefined();
    expect(report.dag?.renderedDag).toBeDefined();
    expect(report.doctor).toBeDefined();
    expect(report.metrics).toBeDefined();
    expect(report.lifecycle.implementers.count).toBe(1);
    expect(report.markdown).toContain("Unified Run Report & Telemetry");
    expect(report.markdown).toContain("Live Sugiyama Hierarchical DAG");
    expect(report.markdown).toContain("Live Doctor Diagnostics & System Integrity");
    expect(report.markdown).toContain("Task Rollup & Concurrency Metrics");
    expect(report.markdown).toContain("`worker-monolith`");

    // 2. Summary view verification
    const summaryResult = (await execute(["summary:view", "--run", run])) as Record<
      string,
      unknown
    >;
    expect(summaryResult.dag).toBeDefined();
    expect(summaryResult.doctor).toBeDefined();
    expect(summaryResult.metrics).toBeDefined();
    expect(summaryResult.occupancy).toBeDefined();

    // 3. Run status verification
    const statusResult = (await execute(["run:status", "--run", run])) as Record<string, unknown>;
    expect(statusResult.dag).toBeDefined();
    expect(statusResult.doctor).toBeDefined();
    expect(statusResult.metrics).toBeDefined();
    expect(statusResult.occupancy).toBeDefined();
  });

  test("direct invocation of unified reporting commands", async () => {
    const { repo, run } = await createBaseRun("direct-commands");

    // reportUnifiedCommand with json: true
    const jsonReport = reportUnifiedCommand({
      run,
      repo,
      json: true,
      detailed: true,
    });
    expect(jsonReport.json).toBe(true);

    // reportDagCommand and reportGraphCommand
    const dagResult = await reportDagCommand({ run, repo });
    expect(dagResult.markdown).toBeDefined();

    const graphResult = await reportGraphCommand({ run, repo });
    expect(graphResult.markdown).toBeDefined();

    // reportGraphJsonCommand
    const graphJsonResult = reportGraphJsonCommand({ run, repo });
    expect(graphJsonResult).toBeDefined();

    // reportLeasesCommand and reportDecisionsCommand
    const leases = reportLeasesCommand({ run, repo });
    expect(leases).toBeDefined();

    const decisions = reportDecisionsCommand({ run, repo });
    expect(decisions).toBeDefined();

    // reportHealthCommand without installation
    const health1 = await reportHealthCommand({ run, repo });
    expect(health1.markdown).toBeDefined();

    // reportHealthCommand with installation and clients
    const health2 = await reportHealthCommand({
      run,
      repo,
      source: join(process.cwd(), "olt"),
      home: repo,
      clients: "claude-code, cursor",
    });
    expect(health2.markdown).toBeDefined();
  });
});

