import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  analyzeParallelization,
  executeDagViewCommand,
  type DagNodeSummary,
} from "../../../../../olt/scripts/src/cli/commands/dag-view.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
beforeEach(() => {
  setupVirtualCliFS();
});
afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

async function createBaseRun(name: string): Promise<{ repo: string; run: string }> {
  const repo = `/virtual/cli/harness-dag-graph-${name}`;
  roots.push(repo);
  await mkdir(repo, { recursive: true });
  await mkdir(join(repo, ".git"), { recursive: true });
  const promptPath = join(repo, "prompt.txt");
  await writeFile(
    promptPath,
    "Build multi-tier system with backend, frontend, database, and documentation components.",
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

describe("DAG View Execution & Parallelization Recommendations", () => {
  test("analyzeParallelization surfaces critical path and high fan-out bottlenecks", () => {
    const tasks: DagNodeSummary[] = [
      {
        id: "task-core",
        label: "Core Architecture Subsystem",
        status: "ready",
        priority: 100,
        writeScope: ["src/core/index.ts"],
        resourceScope: [],
        gate: "bun test core",
        dependencies: [],
        assignedAgent: null,
        attempt: null,
        wave: 1,
        criticalDepth: 3,
        descendantCount: 4,
      },
      {
        id: "task-sub-1",
        label: "Subsystem 1",
        status: "blocked",
        priority: 50,
        writeScope: ["src/sub1/index.ts"],
        resourceScope: [],
        gate: "bun test sub1",
        dependencies: ["task-core"],
        assignedAgent: null,
        attempt: null,
        wave: 2,
        criticalDepth: 2,
        descendantCount: 1,
      },
      {
        id: "task-sub-2",
        label: "Subsystem 2",
        status: "blocked",
        priority: 50,
        writeScope: ["src/sub2/index.ts"],
        resourceScope: [],
        gate: "bun test sub2",
        dependencies: ["task-core"],
        assignedAgent: null,
        attempt: null,
        wave: 2,
        criticalDepth: 2,
        descendantCount: 1,
      },
      {
        id: "task-sub-3",
        label: "Subsystem 3",
        status: "blocked",
        priority: 50,
        writeScope: ["src/sub3/index.ts"],
        resourceScope: [],
        gate: "bun test sub3",
        dependencies: ["task-core"],
        assignedAgent: null,
        attempt: null,
        wave: 2,
        criticalDepth: 2,
        descendantCount: 1,
      },
    ];

    const depMap = new Map<string, ReadonlySet<string>>([
      ["task-core", new Set()],
      ["task-sub-1", new Set(["task-core"])],
      ["task-sub-2", new Set(["task-core"])],
      ["task-sub-3", new Set(["task-core"])],
    ]);

    const recs = analyzeParallelization(tasks, depMap, 8);

    const crit = recs.find((r) => r.type === "critical_path");
    expect(crit).toBeDefined();
    expect(crit?.taskIds).toContain("task-core");

    const fanOut = recs.find((r) => r.type === "fan_out_bottleneck");
    expect(fanOut).toBeDefined();
    expect(fanOut?.taskIds).toContain("task-core");
    expect(fanOut?.description).toContain("blocks 4 downstream task(s)");
  });

  test("flags ARTIFICIAL_SERIALIZATION_WARNING for decoupled tasks", () => {
    const tasks: DagNodeSummary[] = [
      {
        id: "task-docs",
        label: "Documentation Generation",
        status: "ready",
        priority: 50,
        writeScope: ["docs/architecture.md"],
        resourceScope: [],
        gate: "bun test docs",
        dependencies: [],
        assignedAgent: null,
        attempt: null,
        wave: 1,
        criticalDepth: 1,
        descendantCount: 1,
      },
      {
        id: "task-auth",
        label: "Auth Controller",
        status: "proposed",
        priority: 50,
        writeScope: ["src/auth/controller.ts"],
        resourceScope: [],
        gate: "bun test auth",
        dependencies: ["task-docs"],
        assignedAgent: null,
        attempt: null,
        wave: 2,
        criticalDepth: 0,
        descendantCount: 0,
      },
    ];

    const depMap = new Map<string, ReadonlySet<string>>([
      ["task-docs", new Set()],
      ["task-auth", new Set(["task-docs"])],
    ]);

    const recs = analyzeParallelization(tasks, depMap, 4);

    const artificialWarn = recs.find((r) => r.type === "artificial_serialization");
    expect(artificialWarn).toBeDefined();
    expect(artificialWarn?.description).toContain("ARTIFICIAL_SERIALIZATION_WARNING");
    expect(artificialWarn?.description).toContain(
      "Task [task-auth] can be decoupled from Task [task-docs]",
    );
  });

  test("computes Work vs Span metrics correctly in executeDagViewCommand", async () => {
    const { run } = await createBaseRun("metrics-run");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-db",
      "--label",
      "Database Layer",
      "--scope",
      "src/db",
      "--gate",
      "bun test db",
      "--actor",
      "planner",
      "--effort",
      "3",
    ]);

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
      "bun test api",
      "--deps",
      "task-db",
      "--dep-reason",
      "task-db:API imports DB model",
      "--actor",
      "planner",
      "--effort",
      "5",
    ]);

    const result = executeDagViewCommand(["--run", run, "--detailed", "--all"]);
    expect(result.metrics).toBeDefined();
    expect(result.metrics.totalWaves).toBe(2);
    expect(result.metrics.maxParallelLanes).toBe(1);
    expect(result.metrics.criticalPathLength).toBe(2);
    expect(result.metrics.totalWork).toBe(8);
    expect(result.metrics.span).toBe(2);
    expect(result.metrics.parallelismFactor).toBe(4);
    expect(result.metrics.parallelEligibleChains).toBe(1);

    expect(result.markdown).toContain("Work/Span (P)**: 4");
    expect(result.markdown).toContain("Decision Rationale & Dependency Forensics");
    expect(result.markdown).toContain("Algorithmic Serialization & Parallelization Analysis");
  });
});
