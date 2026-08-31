import { describe, expect, it } from "bun:test";
import { layoutSugiyamaDag } from "../../../olt/scripts/src/graph/sugiyama.ts";
import {
  calculateDashboardMetrics,
  generateDashboardReport,
  renderAgentMatrixSection,
  renderDashboardAscii,
  renderDashboardHeader,
  renderMicroCycleTelemetry,
  renderTaskSummaryTable,
  type DashboardAgentState,
  type DashboardTaskState,
} from "../../../olt/scripts/src/reporting/dashboard.ts";

export const dashboardSuiteName = "Unified Master Reporting Dashboard (reporting/dashboard.ts)";

describe(dashboardSuiteName, () => {
  const mockTasks: DashboardTaskState[] = [
    {
      id: "task-1",
      label: "Auth Schema",
      status: "done",
      effort: 4,
      writeScope: ["src/auth/schema.ts"],
      dependencies: [],
      implementerId: "agent-impl-1",
      pushes: 1,
      maxPushes: 3,
      probes: 2,
      repairRound: 0,
    },
    {
      id: "task-2",
      label: "Auth Endpoints",
      status: "running",
      effort: 6,
      writeScope: ["src/auth/routes.ts"],
      dependencies: ["task-1"],
      implementerId: "agent-impl-2",
      validatorId: "agent-val-1",
      pushes: 2,
      maxPushes: 3,
      probes: 1,
      repairRound: 1,
    },
    {
      id: "task-3",
      label: "Security Audit",
      status: "ready",
      effort: 3,
      writeScope: ["src/auth/audit.ts"],
      dependencies: ["task-2"],
    },
  ];

  const mockAgents: DashboardAgentState[] = [
    { id: "agent-impl-1", role: "implementer", tier: 3, status: "idle" },
    { id: "agent-impl-2", role: "implementer", tier: 3, status: "active", assignedTask: "task-2" },
    { id: "agent-val-1", role: "validator", tier: 2, status: "active", assignedTask: "task-2" },
  ];

  it("calculateDashboardMetrics computes task, agent, and telemetry aggregates", () => {
    const dagReport = layoutSugiyamaDag([], []);
    const metrics = calculateDashboardMetrics(mockTasks, mockAgents, dagReport);
    expect(metrics.totalTasks).toBe(3);
    expect(metrics.satisfiedTasks).toBe(1);
    expect(metrics.activeTasks).toBe(1);
    expect(metrics.standbyTasks).toBe(1);
    expect(metrics.totalWork).toBe(13);
    expect(metrics.activeAgents).toBe(2);
    expect(metrics.totalPushes).toBe(3);
    expect(metrics.totalProbes).toBe(3);
    expect(metrics.quotaDeficitTasks).toBe(1);
  });

  it("renderMicroCycleTelemetry formats adversarial probes and pushback metrics", () => {
    const emptyLines = renderMicroCycleTelemetry([]);
    expect(emptyLines.some((l) => l.includes("No active micro-cycles"))).toBe(true);

    const activeLines = renderMicroCycleTelemetry(mockTasks);
    const text = activeLines.join("\n");
    expect(text).toContain("task-1");
    expect(text).toContain("task-2");
    expect(text).toContain("Pushes: 2/3");
    expect(text).toContain("Probes: 1");
    expect(text).toContain("Repair: R1");
    expect(text).toContain("⚠️ [DEFICIT: Pushes: 1/5, Probes: 2/5]");
  });

  it("renderTaskSummaryTable formats topology with scopes and dependencies", () => {
    const tableLines = renderTaskSummaryTable(mockTasks);
    const text = tableLines.join("\n");
    expect(text).toContain("task-1");
    expect(text).toContain("DONE");
    expect(text).toContain("src/auth/schema.ts");
    expect(text).toContain("task-2");
    expect(text).toContain("RUNNING");
  });

  it("renderAgentMatrixSection displays agent roles, tiers, and assignments", () => {
    const agentLines = renderAgentMatrixSection(mockAgents);
    const text = agentLines.join("\n");
    expect(text).toContain("agent-impl-2");
    expect(text).toContain("IMPLEMENTER");
    expect(text).toContain("T3");
    expect(text).toContain("ACTIVE");
    expect(text).toContain("task-2");
  });

  it("renderDashboardHeader renders banner with phase and summary metrics", () => {
    const metrics = {
      totalTasks: 3,
      satisfiedTasks: 1,
      activeTasks: 1,
      standbyTasks: 1,
      totalWork: 13,
      criticalPathSpan: 10,
      totalLayers: 3,
      totalCrossings: 0,
      activeAgents: 2,
      totalPushes: 3,
      totalProbes: 3,
      quotaDeficitTasks: 1,
    };
    const header = renderDashboardHeader("run-live-101", "Executing", metrics);
    const text = header.join("\n");
    expect(text).toContain("UNIFIED MASTER REPORTING DASHBOARD: run-live-101");
    expect(text).toContain("Phase: Executing");
    expect(text).toContain("Active Agents: 2");
  });

  it("generateDashboardReport handles empty task and agent lists gracefully (AGP-1)", () => {
    const report = generateDashboardReport("run-empty", "Init", [], []);
    expect(report.metrics.totalTasks).toBe(0);
    expect(report.metrics.totalWork).toBe(0);
    expect(report.dagReport.asciiDiagram).toBe("(Empty DAG)");
    expect(report.asciiDashboard).toContain("UNIFIED MASTER REPORTING DASHBOARD");
  });

  it("tracks quota deficit for completed tasks with deficit pushbacks/probes (AGP-2)", () => {
    const deficitTasks: DashboardTaskState[] = [
      {
        id: "t-def",
        label: "Deficit Task",
        status: "completed",
        effort: 2,
        writeScope: [],
        dependencies: [],
        pushes: 2,
        probes: 1,
      },
    ];
    const dagReport = layoutSugiyamaDag([], []);
    const metrics = calculateDashboardMetrics(deficitTasks, [], dagReport);
    expect(metrics.quotaDeficitTasks).toBe(1);
    const telemetry = renderMicroCycleTelemetry(deficitTasks).join("\n");
    expect(telemetry).toContain("[DEFICIT: Pushes: 2/5, Probes: 1/5]");
  });

  it("generateDashboardReport and renderDashboardAscii assemble full dashboard view", () => {
    const report = generateDashboardReport("run-test-flow", "Executing", mockTasks, mockAgents, {
      detailed: true,
    });
    expect(report.runId).toBe("run-test-flow");
    expect(report.phase).toBe("Executing");
    expect(report.metrics.totalTasks).toBe(3);
    expect(report.dagReport.totalNodes).toBe(3);
    expect(report.dagReport.totalLayers).toBe(3);

    const ascii = renderDashboardAscii(report);
    expect(ascii).toContain("UNIFIED MASTER REPORTING DASHBOARD: run-test-flow");
    expect(ascii).toContain("SUGIYAMA VISUAL DEPENDENCY GRAPH");
    expect(ascii).toContain("TASK TOPOLOGY");
    expect(ascii).toContain("MICRO-CYCLE TELEMETRY");
    expect(ascii).toContain("AGENT MATRIX");
    expect(ascii).toContain("task-1");
    expect(ascii).toContain("task-2");
    expect(ascii).toContain("task-3");
  });
});
