import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  activeAgentBadge,
  analyzeDependencyForensics,
  analyzeMultiCoordinatorOpportunities,
  analyzeParallelization,
  analyzeSerialization,
  executeDagViewCommand,
  renderAsciiDag,
  renderNodeBox,
  renderVisualDag,
  statusBadge,
  statusGlyph,
  type DagNodeSummary,
  type DagViewResult,
} from "../../../orchestrating-long-tasks/scripts/src/cli/commands/dag-view.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function createBaseRun(name: string): Promise<{ repo: string; run: string }> {
  const repo = realpathSync(await mkdtemp(join(tmpdir(), `harness-dag-view-${name}-`)));
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

describe("dag:view CLI command execution", () => {
  test("renders empty buffer message when no tasks are declared", async () => {
    const { run } = await createBaseRun("empty-buffer");

    const result = (await execute(["dag:view", "--run", run])) as unknown as DagViewResult;

    expect(result.total_tasks).toBe(0);
    expect(result.is_compiled).toBe(false);
    expect(result.waves).toEqual([]);
    expect(result.ascii_dag).toContain("No tasks declared in planning buffer/graph");
    expect(result.markdown).toContain("Draft (Planning Buffer)");
    expect(result.markdown).toContain("Total Tasks**: 0");
  });

  test("renders draft DAG for uncompiled plan in planning buffer", async () => {
    const { run } = await createBaseRun("uncompiled-draft");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-auth",
      "--label",
      "Authentication Module",
      "--scope",
      "src/auth",
      "--gate",
      "bun test auth",
      "--actor",
      "planner",
    ]);

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-api",
      "--label",
      "API Routes",
      "--scope",
      "src/api",
      "--gate",
      "bun test api",
      "--deps",
      "task-auth",
      "--dep-reason",
      "task-auth:API routes depend on authentication middleware",
      "--actor",
      "planner",
    ]);

    const result = (await execute(["dag:view", "--run", run])) as unknown as DagViewResult;

    expect(result.total_tasks).toBe(2);
    expect(result.is_compiled).toBe(false);
    expect(result.graph_revision).toBeNull();
    expect(result.waves.length).toBe(2);
    expect(result.waves[0]?.taskIds).toEqual(["task-auth"]);
    expect(result.waves[1]?.taskIds).toEqual(["task-api"]);
    expect(result.ascii_dag).toContain("WAVE 1");
    expect(result.ascii_dag).toContain("(○ READY) task-auth");
    expect(result.ascii_dag).toContain("WAVE 2");
    expect(result.ascii_dag).toContain("(⏳ BLOCKED) task-api");
    expect(result.ascii_dag).toContain("▼");
  });

  test("renders multi-wave DAG and computes critical path on compiled graphs", async () => {
    const { run, repo } = await createBaseRun("compiled-multi-wave");

    await mkdir(join(repo, "src/a"), { recursive: true });
    await mkdir(join(repo, "src/b"), { recursive: true });
    await mkdir(join(repo, "src/c"), { recursive: true });
    await mkdir(join(repo, "src/d"), { recursive: true });

    await writeFile(join(repo, "gate-a.ts"), "console.log('gate-a');\n");
    await writeFile(join(repo, "gate-b.ts"), "console.log('gate-b');\n");
    await writeFile(join(repo, "gate-c.ts"), "console.log('gate-c');\n");
    await writeFile(join(repo, "gate-d.ts"), "console.log('gate-d');\n");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-1",
      "--label",
      "Foundational Models",
      "--scope",
      "src/a",
      "--gate",
      "bun gate-a.ts",
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
      "task-2",
      "--label",
      "Independent Utility",
      "--scope",
      "src/b",
      "--gate",
      "bun gate-b.ts",
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
      "task-3",
      "--label",
      "Controller Layer",
      "--scope",
      "src/c",
      "--gate",
      "bun gate-c.ts",
      "--deps",
      "task-1",
      "--dep-reason",
      "task-1:Controller imports models",
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
      "task-4",
      "--label",
      "End-to-End Integration",
      "--scope",
      "src/d",
      "--gate",
      "bun gate-d.ts",
      "--deps",
      "task-3",
      "--dep-reason",
      "task-3:E2E integration exercises controllers",
      "--requirement-lines",
      "1",
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
      "--accept-audit",
      "A4-false-barrier:test fixture creates topological waves on purpose",
    ]);

    const result = (await execute([
      "dag:view",
      "--run",
      run,
      "--detailed",
    ])) as unknown as DagViewResult;

    expect(result.total_tasks).toBe(4);
    expect(result.is_compiled).toBe(true);
    expect(result.graph_revision).toBe(1);
    expect(result.critical_path_length).toBe(3);
    expect(result.waves.length).toBe(3);

    // Wave 1 has tasks 1 and 2
    expect(result.waves[0]?.wave).toBe(1);
    expect(result.waves[0]?.taskIds.sort()).toEqual(["task-1", "task-2"]);
    expect(result.waves[0]?.laneCount).toBe(2);

    // Wave 2 has task 3
    expect(result.waves[1]?.wave).toBe(2);
    expect(result.waves[1]?.taskIds).toEqual(["task-3"]);

    // Wave 3 has task 4
    expect(result.waves[2]?.wave).toBe(3);
    expect(result.waves[2]?.taskIds).toEqual(["task-4"]);

    // Detailed formatting verification
    expect(result.ascii_dag).toContain("Scope:  src/a");
    expect(result.ascii_dag).toContain("Deps:   task-1");
    expect(result.ascii_dag).toContain("Deps:   task-3");
  });

  test("reports active agents and subagent lease allocations in matrix table", async () => {
    const { run, repo } = await createBaseRun("active-agent-matrix");

    await mkdir(join(repo, "src/core"), { recursive: true });
    await writeFile(join(repo, "gate.ts"), "console.log('gate');\n");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-core",
      "--label",
      "Core Logic",
      "--scope",
      "src/core",
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

    // Register active agent
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "implementer-worker-1",
      "--role",
      "implementer",
      "--host",
      "antigravity",
    ]);

    // Lease task
    await execute([
      "queue:pop",
      "--run",
      run,
      "--agent",
      "implementer-worker-1",
      "--lease-duration",
      "1200",
    ]);

    const result = (await execute(["dag:view", "--run", run])) as unknown as DagViewResult;

    expect(result.active_agents.length).toBe(1);
    expect(result.active_agents[0]?.id).toBe("implementer-worker-1");
    expect(result.active_agents[0]?.role).toBe("implementer");
    expect(result.active_agents[0]?.host).toBe("antigravity");
    expect(result.active_agents[0]?.taskId).toBe("task-core");
    expect(result.active_agents[0]?.attempt).toBe(1);

    expect(result.markdown).toContain("Active Subagents & Lease Matrix");
    expect(result.markdown).toContain("`implementer-worker-1`");
    expect(result.markdown).toContain("`task-core`");
  });

  test("supports aliases graph:ascii and status:dag", async () => {
    const { run } = await createBaseRun("alias-check");

    const resView = (await execute(["dag:view", "--run", run])) as unknown as DagViewResult;
    const resGraph = (await execute(["graph:ascii", "--run", run])) as unknown as DagViewResult;
    const resStatus = (await execute(["status:dag", "--run", run])) as unknown as DagViewResult;

    expect(resGraph.total_tasks).toBe(resView.total_tasks);
    expect(resStatus.total_tasks).toBe(resView.total_tasks);
    expect(resGraph.ascii_dag).toBe(resView.ascii_dag);
    expect(resStatus.ascii_dag).toBe(resView.ascii_dag);
  });

  test("honours --all flag and --recommendations flag", async () => {
    const { run } = await createBaseRun("flag-options");

    const result = (await execute([
      "dag:view",
      "--run",
      run,
      "--all",
      "--recommendations",
    ])) as unknown as DagViewResult;

    expect(result.markdown).toBeDefined();
    expect(result.markdown).toContain("Algorithmic Parallelization Recommendations");
  });

  test("fails with INVALID_ARGUMENT when --run is missing in empty directory", async () => {
    const emptyRepo = realpathSync(await mkdtemp(join(tmpdir(), "harness-empty-repo-")));
    roots.push(emptyRepo);
    await expect(execute(["dag:view", "--repo", emptyRepo])).rejects.toThrow(
      "no active capsule found",
    );
  });

  test("defaults to latest capsule in .capsules when --run is omitted", async () => {
    const { repo, run } = await createBaseRun("default-capsule");
    const result = (await execute(["dag:view", "--repo", repo])) as unknown as DagViewResult;
    expect(result.run_root).toBe(run);
    expect(result.total_tasks).toBe(0);
  });

  test("executeDagViewCommand executes directly with argv and flags", async () => {
    const { run } = await createBaseRun("direct-exec");
    const report1 = executeDagViewCommand(["--run", run]);
    expect(report1.total_tasks).toBe(0);
    expect(report1.is_compiled).toBe(false);

    const report2 = executeDagViewCommand({ run });
    expect(report2.total_tasks).toBe(0);
    expect(report2.is_compiled).toBe(false);
  });

  test("fails when run capsule does not exist", async () => {
    await expect(execute(["dag:view", "--run", "/tmp/does-not-exist-capsule-12345"])).rejects.toThrow();
  });
});

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
    expect(multiCoordRec?.description).toContain(
      "Plan spans 3 distinct domain write scopes",
    );
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
    expect(artificialWarn?.description).toContain("Task [task-auth] can be decoupled from Task [task-docs]");
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

    const result = executeDagViewCommand(["--run", run, "--detailed"]);
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

describe("renderAsciiDag formatting", () => {
  test("renders clean ASCII box borders with wave headers and status badges", () => {
    const waves = [
      {
        wave: 1,
        tasks: [
          {
            id: "task-init",
            label: "Initialize Storage Layer",
            status: "done",
            priority: 50,
            writeScope: ["src/store"],
            resourceScope: [],
            gate: "bun test store",
            dependencies: [],
            assignedAgent: "worker-0",
            attempt: 1,
            wave: 1,
            criticalDepth: 1,
            descendantCount: 1,
          },
        ],
      },
      {
        wave: 2,
        tasks: [
          {
            id: "task-runner",
            label: "Execute Integration Pipeline",
            status: "ready",
            priority: 50,
            writeScope: ["src/runner"],
            resourceScope: [],
            gate: "bun test runner",
            dependencies: ["task-init"],
            assignedAgent: null,
            attempt: null,
            wave: 2,
            criticalDepth: 0,
            descendantCount: 0,
          },
        ],
      },
    ];

    const rendered = renderAsciiDag(waves, true);

    expect(rendered).toContain("┌─ WAVE 1 (1 lane • done)");
    expect(rendered).toContain("(✓ SATISFIED) task-init");
    expect(rendered).toContain("Initialize Storage Layer");
    expect(rendered).toContain("Role: implementer | Phase: Wave 1 | Work: 1 | Span: 2");
    expect(rendered).toContain("Scope:  src/store");
    expect(rendered).toContain("Agent:  worker-0 (Attempt #1)");
    expect(rendered).toContain("▼");
    expect(rendered).toContain("┌─ WAVE 2 (1 lane • ready)");
    expect(rendered).toContain("(○ READY) task-runner");
    expect(rendered).toContain("Execute Integration Pipeline");
    expect(rendered).toContain("Needs: task-init");
    expect(rendered).toContain("Scope:  src/runner");
    expect(rendered).toContain("Deps:   task-init");
  });

  test("renders active agent coordinate badges and execution subgraphs for leased/validating tasks", () => {
    const waves = [
      {
        wave: 1,
        tasks: [
          {
            id: "task-behavioral-health",
            label: "Behavioral Health Engine",
            status: "leased",
            priority: 90,
            writeScope: ["src/doctor.ts"],
            resourceScope: [],
            gate: "bun test doctor",
            dependencies: [],
            assignedAgent: "impl-behavioral-health",
            assignedRole: "implementer",
            assignedTool: "write_file",
            attempt: 1,
            wave: 1,
            criticalDepth: 1,
            descendantCount: 1,
          },
          {
            id: "task-validator-node",
            label: "Validator Health Audit",
            status: "validating",
            priority: 85,
            writeScope: ["src/validator.ts"],
            resourceScope: [],
            gate: "bun test validator",
            dependencies: [],
            assignedAgent: "val-behavioral-health",
            assignedRole: "validator",
            assignedTool: "verify",
            attempt: 1,
            wave: 1,
            criticalDepth: 1,
            descendantCount: 0,
          },
        ],
      },
    ];

    const rendered = renderAsciiDag(waves, true);

    expect(rendered).toContain("⚡ [ACTIVE EXECUTION SUBGRAPH]");
    expect(rendered).toContain("(🟢 ACTIVE) task-behavioral-health");
    expect(rendered).toContain("[⚡ LEASED: impl-behavioral-health (implementer)]");
    expect(rendered).toContain("(🔵 VALIDATING) task-validator-node");
    expect(rendered).toContain("[⚡ VALIDATING: val-behavioral-health (validator)]");
    expect(rendered).toContain("Tool:   write_file");
    expect(rendered).toContain("Tool:   verify");
    expect(rendered).toContain("──┬── ──▶ [PARALLEL LANE]");
  });

  test("renders dependency reason justifications below task boxes", () => {
    const waves = [
      {
        wave: 1,
        tasks: [
          {
            id: "task-a",
            label: "Schema Definition",
            status: "done",
            priority: 90,
            writeScope: ["src/schema.ts"],
            resourceScope: [],
            gate: "bun test schema",
            dependencies: [],
            assignedAgent: "impl-schema",
            attempt: 1,
            wave: 1,
            criticalDepth: 1,
            descendantCount: 1,
          },
        ],
      },
      {
        wave: 2,
        tasks: [
          {
            id: "task-b",
            label: "Consumer Client",
            status: "ready",
            priority: 80,
            writeScope: ["src/client.ts"],
            resourceScope: [],
            gate: "bun test client",
            dependencies: ["task-a"],
            depReasons: {
              "task-a": "reads schema generated in task-a",
            },
            assignedAgent: null,
            attempt: null,
            wave: 2,
            criticalDepth: 0,
            descendantCount: 0,
          },
        ],
      },
    ];

    const rendered = renderAsciiDag(waves, true);

    expect(rendered).toContain("Deps:   task-a");
    expect(rendered).toContain("↳ Dep on task-a: reads schema generated in task-a");
  });

  test("renders complete topological DAG with boxed nodes, glyphs, connectors, and work/span metrics", () => {
    const task1: DagNodeSummary = {
      id: "task-whoami-identity-command",
      label: "task-whoami-identity-command",
      status: "leased",
      priority: 90,
      writeScope: ["orchestrating-long-tasks/scripts/src/cli/commands/whoami.ts"],
      resourceScope: [],
      gate: "bun test tests/unit/cli/whoami.test.ts",
      dependencies: [],
      assignedAgent: "impl-identity",
      assignedRole: "impl-identity",
      assignedTool: "write_file",
      attempt: 1,
      wave: 1,
      criticalDepth: 0,
      descendantCount: 1,
      effort: 1,
    };

    const task2: DagNodeSummary = {
      id: "task-skill-spec-3m-watchdog",
      label: "task-skill-spec-3m-watchdog",
      status: "blocked",
      priority: 80,
      writeScope: ["orchestrating-long-tasks/SKILL.md"],
      resourceScope: [],
      gate: "bun test tests/unit/contracts/scheduler-invariant.test.ts",
      dependencies: ["task-whoami-identity-command"],
      assignedAgent: null,
      assignedRole: "impl-skill-docs",
      attempt: null,
      wave: 2,
      criticalDepth: 0,
      descendantCount: 0,
      effort: 1,
    };

    const waves = [
      { wave: 1, tasks: [task1] },
      { wave: 2, tasks: [task2] },
    ];

    const rendered = renderVisualDag(waves, { detailed: false });

    expect(rendered).toContain("┌─ WAVE 1 (1 lane • leased) ⚡ [ACTIVE EXECUTION SUBGRAPH]");
    expect(rendered).toContain("(🟢 ACTIVE) task-whoami-identity-command [⚡ LEASED: impl-identity (impl-identity)]");
    expect(rendered).toContain("Role: impl-identity | Phase: Wave 1 | Work: 1 | Span: 1");
    expect(rendered).toContain("┬");
    expect(rendered).toContain("│");
    expect(rendered).toContain("▼");
    expect(rendered).toContain("┌─ WAVE 2 (1 lane • blocked)");
    expect(rendered).toContain("(⏳ BLOCKED) task-skill-spec-3m-watchdog");
    expect(rendered).toContain("Role: impl-skill-docs | Needs: task-whoami-identity-command");
    expect(rendered).toContain("Phase: Wave 2 | Work: 1 | Span: 1");
  });

  test("zero TypeScript any and zero suppressions across dag-view source, visualizer, and test files", async () => {
    const { readFileSync } = await import("node:fs");
    const dagViewSource = readFileSync(
      join(__dirname, "../../../orchestrating-long-tasks/scripts/src/cli/commands/dag-view.ts"),
      "utf8",
    );
    const dagVisualizerSource = readFileSync(
      join(__dirname, "../../../orchestrating-long-tasks/scripts/src/summary/dag-visualizer.ts"),
      "utf8",
    );
    const testSource = readFileSync(__filename, "utf8");

    const anyAnnotation = new RegExp(":" + " any" + "\\b");
    const anyCast = new RegExp("as" + " any" + "\\b");
    const anyGeneric = new RegExp("<" + "any" + ">");
    const tsIgnore = "@" + "ts-ignore";
    const tsExpectError = "@" + "ts-expect-error";
    const tsNoCheck = "@" + "ts-nocheck";
    const suppressionDirectiveA = "eslint" + "-disable";
    const suppressionDirectiveB = "oxlint" + "-disable";

    for (const content of [dagViewSource, dagVisualizerSource, testSource]) {
      expect(content).not.toMatch(anyAnnotation);
      expect(content).not.toMatch(anyCast);
      expect(content).not.toMatch(anyGeneric);
      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNoCheck)).toBe(false);
      expect(content.includes(suppressionDirectiveA)).toBe(false);
      expect(content.includes(suppressionDirectiveB)).toBe(false);
    }
  });
});
