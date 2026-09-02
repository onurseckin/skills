import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { initRun } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  analyzeDependencyForensics,
  analyzeMultiCoordinatorOpportunities,
  analyzeParallelization,
  analyzeSerialization,
  executeDagViewCommand,
  findLatestCapsuleIn,
  resolveCapsuleRun,
  type DagNodeSummary,
} from "../../../../olt/scripts/src/cli/commands/dag-view.ts";

const TEST_DIR = join(process.cwd(), ".tmp-test-dag-view-edge");

function makeNode(overrides: Partial<DagNodeSummary> = {}): DagNodeSummary {
  return {
    id: "task-1",
    label: "Task 1",
    status: "proposed",
    priority: 50,
    writeScope: ["src/module-a/file.ts"],
    resourceScope: [],
    gate: "",
    dependencies: [],
    assignedAgent: null,
    attempt: null,
    wave: 1,
    criticalDepth: 0,
    descendantCount: 0,
    effort: 1,
    ...overrides,
  };
}

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("DAG View Edge Suite", () => {
  describe("findLatestCapsuleIn & resolveCapsuleRun", () => {
    it("finds newest capsule directory and handles explicit run paths", () => {
      const capsulesDir = join(TEST_DIR, ".olt", "capsules");
      mkdirSync(capsulesDir, { recursive: true });
      expect(findLatestCapsuleIn(TEST_DIR)).toBeNull();

      const cap1 = join(capsulesDir, "run-1");
      const cap2 = join(capsulesDir, "run-2");
      mkdirSync(cap1);
      mkdirSync(cap2);
      utimesSync(cap1, new Date(1000), new Date(1000));
      utimesSync(cap2, new Date(5000), new Date(5000));

      expect(findLatestCapsuleIn(TEST_DIR)).toBe(cap2);
      expect(resolveCapsuleRun(TEST_DIR, cap1)).toBe(cap1);
      expect(() => resolveCapsuleRun(TEST_DIR, undefined, undefined)).not.toThrow();
    });

    it("throws when explicit run is not found and capsules dir is empty", () => {
      expect(() => resolveCapsuleRun(join(TEST_DIR, "nonexistent-dir"))).toThrow(HarnessError);
    });
  });

  describe("algorithmic analysis functions", () => {
    it("categorizes dependency edges accurately", () => {
      const parentSchema = makeNode({ id: "t-parent", writeScope: ["src/models/schema.ts"] });
      const parentGate = makeNode({ id: "t-gate", gate: "bun test", writeScope: ["src/pkg/"] });
      const parentConflict = makeNode({ id: "t-conflict", writeScope: ["src/shared/state.ts"] });
      const childDataflow = makeNode({ id: "t-child1", dependencies: ["t-parent"] });
      const childGate = makeNode({ id: "t-child2", dependencies: ["t-gate"] });
      const childConflict = makeNode({
        id: "t-child3",
        writeScope: ["src/shared/state.ts"],
        dependencies: ["t-conflict"],
      });
      const childExplicit = makeNode({
        id: "t-child4",
        dependencies: ["t-parent"],
        depReasons: { "t-parent": "Explicit justification" },
      });

      const nodes = [
        parentSchema,
        parentGate,
        parentConflict,
        childDataflow,
        childGate,
        childConflict,
        childExplicit,
      ];
      const depMap = new Map<string, ReadonlySet<string>>([
        ["t-child1", new Set(["t-parent"])],
        ["t-child2", new Set(["t-gate"])],
        ["t-child3", new Set(["t-conflict"])],
        ["t-child4", new Set(["t-parent"])],
      ]);

      const forensics = analyzeDependencyForensics(nodes, depMap);
      expect(forensics.find((f) => f.toTaskId === "t-child4")?.edgeType).toBe(
        "explicit_justification",
      );
      expect(forensics.find((f) => f.toTaskId === "t-child3")?.edgeType).toBe("scope_conflict");
      expect(forensics.find((f) => f.toTaskId === "t-child1")?.edgeType).toBe("dataflow");
      expect(forensics.find((f) => f.toTaskId === "t-child2")?.edgeType).toBe("prerequisite_gate");
    });

    it("identifies serialization conflicts, disjoint candidates, and multi-coordinators", () => {
      const root = makeNode({ id: "t-root", writeScope: ["packages/auth/token.ts"] });
      const conflict = makeNode({
        id: "t-conflict",
        writeScope: ["packages/auth/token.ts"],
        dependencies: ["t-root"],
      });
      const disjoint = makeNode({
        id: "t-disjoint",
        writeScope: ["packages/db/schema.ts"],
        dependencies: ["t-root"],
      });

      const analysis = analyzeSerialization(
        [root, conflict, disjoint],
        new Map([
          ["t-root", new Set()],
          ["t-conflict", new Set(["t-root"])],
          ["t-disjoint", new Set(["t-root"])],
        ]),
      );
      expect(analysis.find((a) => a.taskId === "t-root")?.isSerial).toBe(false);
      expect(analysis.find((a) => a.taskId === "t-conflict")?.isSerial).toBe(true);
      expect(analysis.find((a) => a.taskId === "t-conflict")?.parallelEligible).toBe(false);
      expect(analysis.find((a) => a.taskId === "t-disjoint")?.parallelEligible).toBe(true);

      const opps = analyzeMultiCoordinatorOpportunities([root, disjoint]);
      expect(opps).toHaveLength(2);
      expect(opps.some((o) => o.recommendedCoordinatorRole === "coordinator-packages-auth")).toBe(
        true,
      );
    });

    it("generates critical path, bottleneck, headroom, and serial bottleneck recommendations", () => {
      const p1 = makeNode({
        id: "tp1",
        writeScope: ["src/a.ts"],
        criticalDepth: 3,
        descendantCount: 4,
      });
      const p2 = makeNode({
        id: "tp2",
        writeScope: ["src/b.ts"],
        dependencies: ["tp1"],
        status: "ready",
      });
      const p3 = makeNode({
        id: "tp3",
        writeScope: ["src/a.ts"],
        dependencies: ["tp1"],
        status: "proposed",
      });

      const depMap = new Map([
        ["tp1", new Set<string>()],
        ["tp2", new Set(["tp1"])],
        ["tp3", new Set(["tp1"])],
      ]);
      const recs = analyzeParallelization([p1, p2, p3], depMap, 4);
      expect(recs.some((r) => r.type === "critical_path")).toBe(true);
      expect(recs.some((r) => r.type === "fan_out_bottleneck")).toBe(true);
      expect(recs.some((r) => r.type === "concurrency_headroom")).toBe(true);
      expect(recs.some((r) => r.type === "serial_bottleneck")).toBe(true);
    });
  });

  describe("executeDagViewCommand", () => {
    it("executes on capsule with planned tasks, rendering waves, forensics, and serial analyses", async () => {
      const runRoot = initRun(
        TEST_DIR,
        "dag-test-run",
        new TextEncoder().encode("prompt body"),
        "file",
        true,
      );

      await execute([
        "plan:add",
        "--run",
        runRoot,
        "--id",
        "task-db",
        "--label",
        "Database",
        "--scope",
        "src/db/schema.ts",
        "--gate",
        "bun test db",
        "--actor",
        "planner",
        "--effort",
        "2",
      ]);

      await execute([
        "plan:add",
        "--run",
        runRoot,
        "--id",
        "task-api",
        "--label",
        "API",
        "--scope",
        "src/api/routes.ts",
        "--gate",
        "bun test api",
        "--deps",
        "task-db",
        "--dep-reason",
        "task-db:consumes schema",
        "--actor",
        "planner",
        "--effort",
        "3",
      ]);

      const reportTokens = executeDagViewCommand([
        "dag:view",
        "--run",
        runRoot,
        "--detailed",
        "--all",
      ]);
      expect(reportTokens.run_root).toBe(runRoot);
      expect(reportTokens.total_tasks).toBe(2);
      expect(reportTokens.waves).toHaveLength(2);
      expect(reportTokens.markdown).toContain("Decision Rationale & Dependency Forensics");

      const reportFlags = executeDagViewCommand({
        run: runRoot,
        json: true,
        recommendations: true,
      });
      expect(reportFlags.json).toBe(true);
      expect(reportFlags.total_tasks).toBe(2);
    });
  });
});
