import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import {
  analyzeDependencyForensics,
  analyzeMultiCoordinatorOpportunities,
  analyzeParallelization,
  analyzeSerialization,
  executeDagViewCommand,
  type DagNodeSummary,
} from "../../../../olt/scripts/src/cli/commands/dag-view.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
  roots.length = 0;
});

async function createBaseRun(name: string): Promise<{ repo: string; run: string }> {
  const repo = realpathSync(await mkdtemp(join(tmpdir(), `harness-dag-graph-${name}-`)));
  roots.push(repo);
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

describe("Algorithmic Parallelization & Serialization Analysis", () => {
  const emptyDepMap = new Map<string, ReadonlySet<string>>();

  test("analyzeSerialization categorizes independent root tasks as parallel-eligible", () => {
    const tasks: DagNodeSummary[] = [
      {
        id: "task-root",
        label: "Root Task",
        status: "ready",
        priority: 50,
        writeScope: ["src/root/index.ts"],
        resourceScope: [],
        gate: "bun test root",
        dependencies: [],
        assignedAgent: null,
        attempt: null,
        wave: 1,
        criticalDepth: 0,
        descendantCount: 0,
      },
    ];

    const depMap = new Map<string, ReadonlySet<string>>([["task-root", new Set()]]);
    const items = analyzeSerialization(tasks, depMap);

    expect(items.length).toBe(1);
    expect(items[0]?.taskId).toBe("task-root");
    expect(items[0]?.isSerial).toBe(false);
    expect(items[0]?.parallelEligible).toBe(true);
  });

  test("analyzeSerialization identifies parallelization opportunity for disjoint scope dependencies", () => {
    const tasks: DagNodeSummary[] = [
      {
        id: "task-a",
        label: "Module A",
        status: "ready",
        priority: 50,
        writeScope: ["src/module-a/index.ts"],
        resourceScope: [],
        gate: "bun test a",
        dependencies: [],
        assignedAgent: null,
        attempt: null,
        wave: 1,
        criticalDepth: 1,
        descendantCount: 1,
      },
      {
        id: "task-b",
        label: "Module B",
        status: "proposed",
        priority: 50,
        writeScope: ["src/module-b/index.ts"],
        resourceScope: [],
        gate: "bun test b",
        dependencies: ["task-a"],
        assignedAgent: null,
        attempt: null,
        wave: 2,
        criticalDepth: 0,
        descendantCount: 0,
      },
    ];

    const depMap = new Map<string, ReadonlySet<string>>([
      ["task-a", new Set()],
      ["task-b", new Set(["task-a"])],
    ]);

    const items = analyzeSerialization(tasks, depMap);
    const itemB = items.find((i) => i.taskId === "task-b");

    expect(itemB).toBeDefined();
    expect(itemB?.isSerial).toBe(true);
    expect(itemB?.parallelEligible).toBe(true);
    expect(itemB?.candidateLanes).toEqual(["task-a", "task-b"]);
    expect(itemB?.disjointScopes).toEqual(["src/module-b/index.ts", "src/module-a/index.ts"]);
    expect(itemB?.reason).toContain("disjoint write scopes");
  });

  test("analyzeSerialization identifies mandatory serialization on write scope overlap", () => {
    const tasks: DagNodeSummary[] = [
      {
        id: "task-schema",
        label: "Prisma Schema",
        status: "ready",
        priority: 50,
        writeScope: ["prisma/schema.prisma"],
        resourceScope: [],
        gate: "bun test prisma",
        dependencies: [],
        assignedAgent: null,
        attempt: null,
        wave: 1,
        criticalDepth: 1,
        descendantCount: 1,
      },
      {
        id: "task-migration",
        label: "Prisma Migration",
        status: "proposed",
        priority: 50,
        writeScope: ["prisma/schema.prisma"],
        resourceScope: [],
        gate: "bun test migration",
        dependencies: ["task-schema"],
        assignedAgent: null,
        attempt: null,
        wave: 2,
        criticalDepth: 0,
        descendantCount: 0,
      },
    ];

    const depMap = new Map<string, ReadonlySet<string>>([
      ["task-schema", new Set()],
      ["task-migration", new Set(["task-schema"])],
    ]);

    const items = analyzeSerialization(tasks, depMap);
    const itemMigration = items.find((i) => i.taskId === "task-migration");

    expect(itemMigration).toBeDefined();
    expect(itemMigration?.isSerial).toBe(true);
    expect(itemMigration?.parallelEligible).toBe(false);
    expect(itemMigration?.reason).toContain("Required serialization due to write scope overlap");
  });

  test("analyzeDependencyForensics classifies explicit, scope conflict, dataflow, and gate edges", () => {
    const tasks: DagNodeSummary[] = [
      {
        id: "task-contract",
        label: "API Contracts",
        status: "ready",
        priority: 50,
        writeScope: ["src/contracts/model.ts"],
        resourceScope: [],
        gate: "bun test contracts",
        dependencies: [],
        assignedAgent: null,
        attempt: null,
        wave: 1,
        criticalDepth: 1,
        descendantCount: 2,
      },
      {
        id: "task-client",
        label: "API Client",
        status: "proposed",
        priority: 50,
        writeScope: ["src/client/api.ts"],
        resourceScope: [],
        gate: "bun test client",
        dependencies: ["task-contract"],
        depReasons: { "task-contract": "Explicit requirement: client needs type generation" },
        assignedAgent: null,
        attempt: null,
        wave: 2,
        criticalDepth: 0,
        descendantCount: 0,
      },
      {
        id: "task-server",
        label: "API Server",
        status: "proposed",
        priority: 50,
        writeScope: ["src/server/routes.ts"],
        resourceScope: [],
        gate: "bun test server",
        dependencies: ["task-contract"],
        assignedAgent: null,
        attempt: null,
        wave: 2,
        criticalDepth: 0,
        descendantCount: 0,
      },
    ];

    const depMap = new Map<string, ReadonlySet<string>>([
      ["task-contract", new Set()],
      ["task-client", new Set(["task-contract"])],
      ["task-server", new Set(["task-contract"])],
    ]);

    const forensics = analyzeDependencyForensics(tasks, depMap);

    const clientForensic = forensics.find((f) => f.toTaskId === "task-client");
    expect(clientForensic?.edgeType).toBe("explicit_justification");
    expect(clientForensic?.reason).toBe("Explicit requirement: client needs type generation");

    const serverForensic = forensics.find((f) => f.toTaskId === "task-server");
    expect(serverForensic?.edgeType).toBe("dataflow");
    expect(serverForensic?.reason).toContain("consumes schema/contract output");
  });

  test("analyzeMultiCoordinatorOpportunities clusters distinct domain scopes and suggests coordinator roles", () => {
    const tasks: DagNodeSummary[] = [
      {
        id: "task-api",
        label: "REST API",
        status: "ready",
        priority: 50,
        writeScope: ["src/api/routes.ts"],
        resourceScope: [],
        gate: "bun test api",
        dependencies: [],
        assignedAgent: null,
        attempt: null,
        wave: 1,
        criticalDepth: 0,
        descendantCount: 0,
      },
      {
        id: "task-ui",
        label: "Web UI Components",
        status: "ready",
        priority: 50,
        writeScope: ["src/ui/components.tsx"],
        resourceScope: [],
        gate: "bun test ui",
        dependencies: [],
        assignedAgent: null,
        attempt: null,
        wave: 1,
        criticalDepth: 0,
        descendantCount: 0,
      },
      {
        id: "task-docs",
        label: "API Documentation",
        status: "ready",
        priority: 50,
        writeScope: ["docs/openapi.yaml"],
        resourceScope: [],
        gate: "bun test docs",
        dependencies: [],
        assignedAgent: null,
        attempt: null,
        wave: 1,
        criticalDepth: 0,
        descendantCount: 0,
      },
    ];

    const opps = analyzeMultiCoordinatorOpportunities(tasks);

    expect(opps.length).toBe(3);
    const apiOpp = opps.find((o) => o.domain === "src/api");
    expect(apiOpp).toBeDefined();
    expect(apiOpp?.recommendedCoordinatorRole).toBe("coordinator-src-api");
    expect(apiOpp?.rationale).toContain("Deploying dedicated Tier 2 coordinator");

    const recs = analyzeParallelization(tasks, emptyDepMap, 4);
    const multiCoordRec = recs.find((r) => r.type === "multi_coordinator");
    expect(multiCoordRec).toBeDefined();
    expect(multiCoordRec?.description).toContain("Plan spans 3 distinct domain write scopes");
    expect(multiCoordRec?.description).toContain("Tier 2 Domain Coordinators");
  });

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

  test("Automated Parallelization & False-Dependency Auditor flags ARTIFICIAL_SERIALIZATION_WARNING for decoupled tasks", () => {
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

  test("computes Work vs Span metrics and DagWaveMetrics correctly", async () => {
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
