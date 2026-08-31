import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import type { UnifiedReport } from "../../../../olt/scripts/src/reporting/unified-report.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
  roots.length = 0;
});

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

describe("Unified Reporting CLI Surface - Views & Status", () => {
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
});
