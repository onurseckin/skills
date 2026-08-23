import { describe, expect, it } from "bun:test";
import type { DagViewReport } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/dag-view.ts";
import {
  generateDagJsonReport,
  isDagJsonReport,
  validateGduiReportIntegrity,
} from "../../../orchestrating-long-tasks/scripts/src/reporting/graph-json.ts";

const mockDagView: DagViewReport = {
  markdown: "",
  run_root: "/fake/run",
  is_compiled: true,
  graph_revision: 1,
  total_tasks: 2,
  status_summary: {},
  critical_path_length: 2,
  active_agents: [
    {
      id: "agent-1",
      role: "implementer",
      host: "local",
      status: "active",
      taskId: "task-1",
      attempt: 1,
      tool: "run_command",
    },
  ],
  waves: [],
  recommendations: [],
  ascii_dag: "",
  metrics: {
    totalWaves: 2,
    maxParallelLanes: 1,
    criticalPathLength: 2,
    averageWaveConcurrency: 1,
    serialBottlenecks: 0,
    parallelEligibleChains: 0,
    totalWork: 3,
    span: 2,
    parallelismFactor: 1.5,
    optimalConcurrency: 1,
  },
  dependency_forensics: [
    {
      fromTaskId: "task-1",
      toTaskId: "task-2",
      reason: "scope conflict on file.ts",
      edgeType: "scope_conflict",
    },
    {
      fromTaskId: "task-0",
      toTaskId: "task-1",
      reason: "must happen first",
      edgeType: "explicit_justification",
    },
  ],
  serialization_analysis: [],
  multi_coordinator_opportunities: [],
  nodes: [
    {
      id: "task-1",
      label: "First Task",
      status: "success",
      priority: 50,
      writeScope: [],
      resourceScope: [],
      gate: "",
      dependencies: [],
      assignedAgent: null,
      attempt: null,
      wave: 1,
      criticalDepth: 0,
      descendantCount: 1,
      effort: 2,
    },
    {
      id: "task-2",
      label: "Second Task",
      status: "pending",
      priority: 50,
      writeScope: [],
      resourceScope: [],
      gate: "",
      dependencies: ["task-1"],
      assignedAgent: null,
      attempt: null,
      wave: 2,
      criticalDepth: 1,
      descendantCount: 0,
      effort: 1,
    },
    {
      id: "task-1a",
      label: "Parallel Task",
      status: "pending",
      priority: 50,
      writeScope: [],
      resourceScope: [],
      gate: "",
      dependencies: [],
      assignedAgent: null,
      attempt: null,
      wave: 1,
      criticalDepth: 0,
      descendantCount: 0,
      effort: 1,
    },
  ],
};

describe("graph-json", () => {
  it("generates a valid DAG JSON report with coordinates and metrics", () => {
    const report = generateDagJsonReport("/fake/run", mockDagView);

    expect(report.runId).toBe("run");

    // Nodes & Coordinates
    expect(report.nodes.length).toBe(3);

    const task1 = report.nodes.find((n) => n.id === "task-1")!;
    expect(task1.effort).toBe(2);
    expect(task1.coordinates.rank).toBe(1);

    const task1a = report.nodes.find((n) => n.id === "task-1a")!;
    expect(task1a.coordinates.rank).toBe(1);

    // Lane assignment should be 0 and 1 for rank 1
    const lanes = [task1.coordinates.lane, task1a.coordinates.lane].sort();
    expect(lanes).toEqual([0, 1]);

    const task2 = report.nodes.find((n) => n.id === "task-2")!;
    expect(task2.coordinates.rank).toBe(2);
    expect(task2.coordinates.lane).toBe(0);

    // Leases
    expect(report.leases.length).toBe(1);
    expect(report.leases[0]!.agentId).toBe("agent-1");
    expect(report.leases[0]!.role).toBe("implementer");

    // Metrics
    expect(report.metrics.work).toBe(3);
    expect(report.metrics.span).toBe(2);
    expect(report.metrics.parallelWidth).toBe(1);
    expect(report.metrics.speedupFactor).toBe(1.5);

    // Dependencies
    expect(report.edges.length).toBe(2);
    const hardAuth = report.edges.find((e) => e.type === "authority")!;
    expect(hardAuth.from).toBe("task-1");
    expect(hardAuth.to).toBe("task-2");

    const soft = report.edges.find((e) => e.type === "soft")!;
    expect(soft.from).toBe("task-0");
    expect(soft.to).toBe("task-1");
  });

  it("validates report structure via isDagJsonReport", () => {
    const report = generateDagJsonReport("/fake/run", mockDagView);
    expect(isDagJsonReport(report)).toBe(true);
    expect(isDagJsonReport(null)).toBe(false);
    expect(isDagJsonReport(undefined)).toBe(false);
    expect(isDagJsonReport("string")).toBe(false);
    expect(isDagJsonReport(123)).toBe(false);
    expect(isDagJsonReport([])).toBe(false);
    expect(isDagJsonReport({})).toBe(false);
    expect(isDagJsonReport({ runId: "r1", nodes: [], edges: [], leases: [] })).toBe(false);
    expect(
      isDagJsonReport({
        runId: "r1",
        nodes: [],
        edges: [],
        leases: [],
        metrics: null,
      }),
    ).toBe(false);
  });

  it("preserves view-layer isolation and never mutates frozen input DAG view", () => {
    const frozenDagView: DagViewReport = Object.freeze({
      markdown: "",
      run_root: "/frozen/run",
      is_compiled: true,
      graph_revision: 1,
      total_tasks: 2,
      status_summary: Object.freeze({}),
      critical_path_length: 1,
      active_agents: Object.freeze([
        Object.freeze({
          id: "agent-frozen",
          role: "validator",
          host: "cli",
          status: "active",
          taskId: "task-f1",
          attempt: 1,
          tool: "verify",
        }),
      ]) as readonly DagViewReport["active_agents"][number][],
      waves: Object.freeze([]),
      recommendations: Object.freeze([]),
      ascii_dag: "",
      metrics: Object.freeze({
        totalWaves: 1,
        maxParallelLanes: 2,
        criticalPathLength: 1,
        averageWaveConcurrency: 2,
        serialBottlenecks: 0,
        parallelEligibleChains: 0,
        totalWork: 2,
        span: 1,
        parallelismFactor: 2.0,
        optimalConcurrency: 2,
      }),
      dependency_forensics: Object.freeze([
        Object.freeze({
          fromTaskId: "task-f1",
          toTaskId: "task-f2",
          reason: "standard declared dependency",
          edgeType: "declared_dep",
        }),
      ]) as readonly DagViewReport["dependency_forensics"][number][],
      serialization_analysis: Object.freeze([]),
      multi_coordinator_opportunities: Object.freeze([]),
      nodes: Object.freeze([
        Object.freeze({
          id: "task-f2",
          label: "Task F2",
          status: "ready",
          priority: 50,
          writeScope: Object.freeze(["scope/b"]),
          resourceScope: Object.freeze([]),
          gate: "bun test",
          dependencies: Object.freeze(["task-f1"]),
          assignedAgent: null,
          attempt: null,
          wave: 1,
          criticalDepth: 0,
          descendantCount: 0,
          effort: 1,
        }),
        Object.freeze({
          id: "task-f1",
          label: "Task F1",
          status: "success",
          priority: 50,
          writeScope: Object.freeze(["scope/a"]),
          resourceScope: Object.freeze([]),
          gate: "bun test",
          dependencies: Object.freeze([]),
          assignedAgent: "agent-frozen",
          attempt: 1,
          wave: 1,
          criticalDepth: 0,
          descendantCount: 1,
          effort: 1,
        }),
      ]) as readonly DagViewReport["nodes"][number][],
    });

    const report = generateDagJsonReport("/frozen/run", frozenDagView);

    expect(report.runId).toBe("run");
    expect(report.nodes.length).toBe(2);
    // Node lanes should be ordered alphabetically: task-f1 gets lane 0, task-f2 gets lane 1
    const nodeF1 = report.nodes.find((n) => n.id === "task-f1")!;
    const nodeF2 = report.nodes.find((n) => n.id === "task-f2")!;
    expect(nodeF1.coordinates.lane).toBe(0);
    expect(nodeF2.coordinates.lane).toBe(1);

    // Verify declared_dep is mapped to 'hard'
    expect(report.edges.length).toBe(1);
    expect(report.edges[0]!.type).toBe("hard");

    // Verify input object remains untouched
    expect(frozenDagView.nodes[0]!.id).toBe("task-f2");
  });

  it("handles empty or sparse DAG views safely", () => {
    const emptyDagView: DagViewReport = {
      markdown: "",
      run_root: "/empty/run",
      is_compiled: false,
      graph_revision: null,
      total_tasks: 0,
      status_summary: {},
      critical_path_length: 0,
      active_agents: [],
      waves: [],
      recommendations: [],
      ascii_dag: "",
      metrics: {
        totalWaves: 0,
        maxParallelLanes: 0,
        criticalPathLength: 0,
        averageWaveConcurrency: 0,
        serialBottlenecks: 0,
        parallelEligibleChains: 0,
        totalWork: 0,
        span: 0,
        parallelismFactor: 0,
        optimalConcurrency: 0,
      },
      dependency_forensics: [],
      serialization_analysis: [],
      multi_coordinator_opportunities: [],
      nodes: [],
    };

    const report = generateDagJsonReport("/empty/run", emptyDagView);
    expect(report.runId).toBe("run");
    expect(report.nodes).toEqual([]);
    expect(report.edges).toEqual([]);
    expect(report.leases).toEqual([]);
    expect(report.metrics.work).toBe(0);
    expect(isDagJsonReport(report)).toBe(true);
  });

  describe("validateGduiReportIntegrity", () => {
    it("returns valid result for properly formatted DAG JSON report", () => {
      const report = generateDagJsonReport("/fake/run", mockDagView);
      const result = validateGduiReportIntegrity(report);
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
    });

    it("detects invalid report structures failing isDagJsonReport schema check", () => {
      const resultNull = validateGduiReportIntegrity(null);
      expect(resultNull.valid).toBe(false);
      expect(resultNull.issues).toContain(
        "Invalid report structure: fails isDagJsonReport schema check",
      );

      const resultObject = validateGduiReportIntegrity({ foo: "bar" });
      expect(resultObject.valid).toBe(false);
      expect(resultObject.issues).toContain(
        "Invalid report structure: fails isDagJsonReport schema check",
      );
    });

    it("detects missing or whitespace runId", () => {
      const report = generateDagJsonReport("/fake/run", mockDagView);
      const invalidReport = { ...report, runId: "   " };
      const result = validateGduiReportIntegrity(invalidReport);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain("Missing or invalid runId");
    });

    it("detects nodes with missing id or invalid coordinates", () => {
      const invalidReport = {
        runId: "valid-run",
        edges: [],
        leases: [],
        metrics: { work: 0, span: 0, parallelWidth: 0, speedupFactor: 0 },
        nodes: [
          {
            id: "",
            label: "No ID Node",
            status: "pending",
            effort: 1,
            coordinates: { rank: -1, lane: 0 },
          },
          {
            id: "node-bad-lane",
            label: "Bad Lane Node",
            status: "pending",
            effort: 1,
            coordinates: { rank: 0, lane: -2 },
          },
        ],
      };

      const result = validateGduiReportIntegrity(invalidReport);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain("Node missing id");
      expect(result.issues).toContain("Node  has invalid coordinates rank=-1, lane=0");
      expect(result.issues).toContain("Node node-bad-lane has invalid coordinates rank=0, lane=-2");
    });
  });
});
