import { describe, expect, it, mock } from "bun:test";

// Mock must be defined before import
mock.module("../../../orchestrating-long-tasks/scripts/src/cli/commands/dag-view.ts", () => {
  return {
    dagViewCommand: () => ({
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
          tool: "run_command"
        }
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
          edgeType: "scope_conflict"
        },
        {
          fromTaskId: "task-0",
          toTaskId: "task-1",
          reason: "must happen first",
          edgeType: "explicit_justification"
        }
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
        }
      ]
    }),
    resolveCapsuleRun: (repo: string, runFlag?: string) => runFlag || "/fake/run",
  };
});

import { generateDagJsonReport } from "../../../orchestrating-long-tasks/scripts/src/reporting/graph-json.ts";
import { exportGraphJsonCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/graph-export.ts";

describe("graph-json", () => {
  it("generates a valid DAG JSON report with coordinates and metrics", () => {
    const report = generateDagJsonReport("/fake/run");
    
    expect(report.runId).toBe("run");
    
    // Nodes & Coordinates
    expect(report.nodes.length).toBe(3);
    
    const task1 = report.nodes.find(n => n.id === "task-1")!;
    expect(task1.effort).toBe(2);
    expect(task1.coordinates.rank).toBe(1);
    
    const task1a = report.nodes.find(n => n.id === "task-1a")!;
    expect(task1a.coordinates.rank).toBe(1);
    
    // Lane assignment should be 0 and 1 for rank 1
    const lanes = [task1.coordinates.lane, task1a.coordinates.lane].sort();
    expect(lanes).toEqual([0, 1]);

    const task2 = report.nodes.find(n => n.id === "task-2")!;
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
    const hardAuth = report.edges.find(e => e.type === "authority")!;
    expect(hardAuth.from).toBe("task-1");
    expect(hardAuth.to).toBe("task-2");

    const soft = report.edges.find(e => e.type === "soft")!;
    expect(soft.from).toBe("task-0");
    expect(soft.to).toBe("task-1");
  });

  it("exportGraphJsonCommand executes and optionally formats", () => {
    const res = exportGraphJsonCommand({ run: "/fake/run", pretty: true });
    expect(res).toBeDefined();
    expect((res as any).runId).toBe("run");
  });
});
