import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertDominatingSkillQuality,
  checkScopeListOverlap,
  doScopesOverlap,
  normalizeScope,
  synthesizeDAGTopology,
  validateTopologyAcyclicity,
  type TopologySynthesisSpec,
} from "../../../olt/scripts/src/orchestrator/topology-synthesis.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Topology Synthesis Graph, Acyclicity & Invariants", () => {
  describe("Scope Utilities", () => {
    it("normalizes path separators and removes leading './' and trailing '/'", () => {
      expect(normalizeScope("./src/foo/bar.ts")).toBe("src/foo/bar.ts");
      expect(normalizeScope("src\\foo\\bar.ts")).toBe("src/foo/bar.ts");
      expect(normalizeScope("./src/dir/")).toBe("src/dir");
      expect(normalizeScope("/root/path/")).toBe("/root/path");
    });

    it("identifies exact scope overlaps and directory containment", () => {
      expect(doScopesOverlap("src/orchestrator/foo.ts", "src/orchestrator/foo.ts")).toBe(true);
      expect(doScopesOverlap("src/orchestrator", "src/orchestrator/foo.ts")).toBe(true);
      expect(doScopesOverlap("src/orchestrator/foo.ts", "src/orchestrator")).toBe(true);
      expect(doScopesOverlap("src/orchestrator", "src/mind")).toBe(false);
      expect(doScopesOverlap("src/app.ts", "src/app.test.ts")).toBe(false);
    });

    it("checks overlap across lists of scopes", () => {
      const listA = ["src/a.ts", "src/shared/util.ts"];
      const listB = ["src/b.ts", "src/shared/util.ts"];
      const listC = ["src/c.ts", "src/other.ts"];

      expect(checkScopeListOverlap(listA, listB).overlap).toBe(true);
      expect(checkScopeListOverlap(listA, listC).overlap).toBe(false);
    });
  });

  describe("Acyclicity Validation", () => {
    it("validates a linear dependency chain and produces topological ordering", () => {
      const tasks = [
        { id: "task-3", dependencies: ["task-2"] },
        { id: "task-1", dependencies: [] },
        { id: "task-2", dependencies: ["task-1"] },
      ];

      const result = validateTopologyAcyclicity(tasks, { strict: true });
      expect(result.isAcyclic).toBe(true);
      expect(result.topologicalOrder).toEqual(["task-1", "task-2", "task-3"]);
      expect(result.issues.length).toBe(0);
    });

    it("handles complex diamond branching DAGs deterministically", () => {
      const tasks = [
        { id: "task-sink", dependencies: ["task-b", "task-c"] },
        { id: "task-b", dependencies: ["task-root"] },
        { id: "task-c", dependencies: ["task-root"] },
        { id: "task-root", dependencies: [] },
      ];

      const result = validateTopologyAcyclicity(tasks);
      expect(result.isAcyclic).toBe(true);
      expect(result.topologicalOrder[0]).toBe("task-root");
      expect(result.topologicalOrder[3]).toBe("task-sink");
      expect(result.topologicalOrder.slice(1, 3)).toEqual(["task-b", "task-c"]);
    });

    it("detects direct self-dependencies", () => {
      const tasks = [{ id: "task-self", dependencies: ["task-self"] }];
      expect(() => validateTopologyAcyclicity(tasks, { strict: true })).toThrow(HarnessError);

      const nonStrict = validateTopologyAcyclicity(tasks, { strict: false });
      expect(nonStrict.isAcyclic).toBe(false);
      expect(nonStrict.cycle).toEqual(["task-self", "task-self"]);
    });

    it("detects multi-node cyclic dependencies", () => {
      const tasks = [
        { id: "task-1", dependencies: ["task-3"] },
        { id: "task-2", dependencies: ["task-1"] },
        { id: "task-3", dependencies: ["task-2"] },
      ];

      expect(() => validateTopologyAcyclicity(tasks, { strict: true })).toThrow(HarnessError);

      const nonStrict = validateTopologyAcyclicity(tasks, { strict: false });
      expect(nonStrict.isAcyclic).toBe(false);
      expect(nonStrict.cycle?.length).toBeGreaterThanOrEqual(2);
      expect(nonStrict.issues.length).toBeGreaterThan(0);
    });

    it("rejects unknown dependencies and duplicate task IDs in strict mode", () => {
      const duplicateTasks = [
        { id: "task-1", dependencies: [] },
        { id: "task-1", dependencies: [] },
      ];
      expect(() => validateTopologyAcyclicity(duplicateTasks, { strict: true })).toThrow(HarnessError);

      const unknownDepTasks = [{ id: "task-1", dependencies: ["non-existent"] }];
      expect(() => validateTopologyAcyclicity(unknownDepTasks, { strict: true })).toThrow(HarnessError);
    });
  });

  describe("DAG Topology Synthesis", () => {
    it("synthesizes complete DAG topology with critical path and decisions", () => {
      const spec: TopologySynthesisSpec = {
        objective: "Build resilient multi-agent architecture",
        prompt: "Synthesize full execution topology with anti-batching and critic feedback",
        tasks: [
          { id: "t-arch", label: "Architecture", writeScope: ["src/arch.ts"], effort: 2 },
          { id: "t-engine", label: "Engine", writeScope: ["src/engine.ts"], dependencies: ["t-arch"], effort: 4 },
          { id: "t-tests", label: "Tests", writeScope: ["tests/engine.test.ts"], dependencies: ["t-engine"], effort: 3 },
          { id: "t-docs", label: "Documentation", writeScope: ["docs/README.md"], dependencies: ["t-arch"], effort: 1 },
        ],
        maxParallel: 4,
      };

      const topology = synthesizeDAGTopology(spec);

      expect(topology.schema).toBe("orchestrator.synthesized_topology");
      expect(topology.version).toBe(1);
      expect(topology.revision).toBe(1);
      expect(topology.isAcyclic).toBe(true);
      expect(topology.totalEffort).toBe(10);
      expect(topology.criticalDepth).toBe(3);
      expect(topology.criticalPath).toEqual(["t-arch", "t-engine", "t-tests"]);

      expect(topology.waves.length).toBe(3);
      expect(topology.waves[0]?.taskIds).toEqual(["t-arch"]);
      expect(topology.waves[1]?.taskIds).toEqual(["t-docs", "t-engine"]);
      expect(topology.waves[2]?.taskIds).toEqual(["t-tests"]);

      expect(topology.decisions.length).toBe(4);
      const engineDecision = topology.decisions.find((d) => d.taskId === "t-engine");
      expect(engineDecision?.reason).toBe("dependency");
      expect(engineDecision?.serializedAfter).toEqual(["t-arch"]);
    });

    it("applies extra dependency rules correctly", () => {
      const spec: TopologySynthesisSpec = {
        tasks: [
          { id: "t-a", writeScope: ["src/a.ts"] },
          { id: "t-b", writeScope: ["src/b.ts"] },
        ],
        dependencyRules: [{ from: "t-a", to: "t-b", reason: "Order t-b after t-a" }],
      };

      const topology = synthesizeDAGTopology(spec);
      expect(topology.waves.length).toBe(2);
      expect(topology.waves[0]?.taskIds).toEqual(["t-a"]);
      expect(topology.waves[1]?.taskIds).toEqual(["t-b"]);
    });

    it("throws HarnessError on invalid specs", () => {
      expect(() => synthesizeDAGTopology({ tasks: [] })).toThrow(HarnessError);

      const invalidRuleSpec: TopologySynthesisSpec = {
        tasks: [{ id: "t-1", writeScope: ["src/1.ts"] }],
        dependencyRules: [{ from: "non-existent", to: "t-1" }],
      };
      expect(() => synthesizeDAGTopology(invalidRuleSpec)).toThrow(HarnessError);
    });
  });

  describe("Dominating Skill Quality Assertion", () => {
    it("passes strictly typed code with zero any and zero suppressions", () => {
      const code = [
        "export interface WorkerConfig {",
        "  readonly name: string;",
        "  readonly maxParallel: number;",
        "}",
        "export function configureWorker(config: WorkerConfig): boolean {",
        "  if (!config.name) {",
        '    throw new HarnessError("INVALID_ARGUMENT", "name required");',
        "  }",
        "  return true;",
        "}",
      ].join("\n");

      const report = assertDominatingSkillQuality({
        codeSnippets: [{ path: "src/worker.ts", content: code }],
        strict: true,
      });

      expect(report.passed).toBe(true);
      expect(report.score).toBe(1.0);
      expect(report.metrics.anyTypeCount).toBe(0);
      expect(report.metrics.suppressionCount).toBe(0);
      expect(report.issues.length).toBe(0);
    });

    it("detects forbidden 'any' types and lowers quality score", () => {
      const anyTypeName = ["a", "n", "y"].join("");
      const badSnippet = [
        `export function parseData(input: ${anyTypeName}): ${anyTypeName} {`,
        `  const res = input as ${anyTypeName};`,
        "  return res;",
        "}",
      ].join("\n");

      const report = assertDominatingSkillQuality({
        codeSnippets: [{ path: "src/bad.ts", content: badSnippet }],
        strict: false,
      });

      expect(report.passed).toBe(false);
      expect(report.metrics.anyTypeCount).toBeGreaterThanOrEqual(3);
      expect(report.issues.some((i) => i.includes("Forbidden 'any' type"))).toBe(true);
    });

    it("detects forbidden compiler/linter suppressions", () => {
      const tsIgnoreTag = ["@", "ts", "-", "ignore"].join("");
      const linterTag = ["eslint", "-", "disable"].join("");
      const suppressedSnippet = [
        `// ${tsIgnoreTag}`,
        "const x = 1;",
        `// ${linterTag}`,
        "const y = 2;",
      ].join("\n");

      const report = assertDominatingSkillQuality({
        codeSnippets: [{ path: "src/suppressed.ts", content: suppressedSnippet }],
        strict: false,
      });

      expect(report.passed).toBe(false);
      expect(report.metrics.suppressionCount).toBeGreaterThanOrEqual(2);
      expect(report.issues.some((i) => i.includes("Forbidden suppression comment"))).toBe(true);
    });

    it("throws HarnessError in strict mode when violations are detected", () => {
      const anyKw = ["a", "n", "y"].join("");
      const badSnippet = `const data: ${anyKw} = {};`;

      expect(() =>
        assertDominatingSkillQuality({
          codeSnippets: [{ path: "src/violation.ts", content: badSnippet }],
          strict: true,
        }),
      ).toThrow(HarnessError);
    });
  });
});
