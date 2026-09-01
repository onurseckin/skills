import { describe, expect, test } from "bun:test";
import {
  analyzeDependencyForensics,
  analyzeMultiCoordinatorOpportunities,
  analyzeParallelization,
  analyzeSerialization,
  type DagNodeSummary,
} from "../../../../../olt/scripts/src/cli/commands/dag-view.ts";

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
  });
});
