import { existsSync } from "node:fs";
import { generateUnifiedReport } from "../../../reporting/unified.ts";
import { isRecord } from "../../../requirements/predicates.ts";
import { systemClock, type Clock } from "../../../workflow/types.ts";
import { dependencyMap } from "../../../graph/dependency-map.ts";
import { schedulingMetrics } from "../topology/metrics.ts";
import { computeReceiptHash, type CliDiagnosticReceipt } from "./receipts.ts";
import { runInspectorDoctor, runInspectorHealth } from "./system-inspectors.ts";

export { runInspectorDoctor, runInspectorHealth };

export async function runInspectorDagView(
  runRoot?: string,
  state?: unknown,
  repoRoot: string = process.cwd(),
  clock: Clock = systemClock,
): Promise<CliDiagnosticReceipt> {
  const start = Date.now();
  const timestamp = clock.now().toISOString();

  try {
    let taskCount = 0;
    let waveCount = 1;
    let parallelismFactor = 1;
    let rawTasks: unknown[] = [];

    if (runRoot && existsSync(runRoot)) {
      const { dagViewCommand } = await import("../../../cli/commands/dag-view.ts");
      const report = dagViewCommand({ run: runRoot, repo: repoRoot });
      taskCount = typeof report.total_tasks === "number" ? report.total_tasks : 0;
      const waves = Array.isArray(report.waves) ? report.waves : [];
      waveCount = Math.max(1, waves.length);
      if (isRecord(report.metrics) && typeof report.metrics.parallelismFactor === "number") {
        parallelismFactor = report.metrics.parallelismFactor;
      }
      if (Array.isArray(report.nodes)) {
        rawTasks = report.nodes;
      }
    } else if (isRecord(state)) {
      const tasksMap = isRecord(state.tasks) ? state.tasks : {};
      const tasksList = Object.values(tasksMap);
      taskCount = tasksList.length;
      rawTasks = tasksList;

      if (isRecord(state.graph)) {
        const deps = dependencyMap(state.graph);
        const metrics = schedulingMetrics(deps);
        let maxDepth = 0;
        for (const d of metrics.criticalDepth.values()) {
          maxDepth = Math.max(maxDepth, d);
        }
        waveCount = Math.max(1, maxDepth + 1);
        parallelismFactor = taskCount > 0 ? Number((taskCount / waveCount).toFixed(2)) : 1;
      }
    }

    const durationMs = Date.now() - start;
    const summary = `DAG topology evaluated: ${taskCount} task(s) mapped across ${waveCount} wave(s) (P=${parallelismFactor})`;
    const receiptHash = computeReceiptHash("dag:view", timestamp, "passed", summary);
    const badge = `[RECEIPT: dag:view ${waveCount}-WAVES (P=${parallelismFactor})]`;

    return {
      inspector: "dag:view",
      status: "passed",
      timestamp,
      durationMs,
      summary,
      receiptHash,
      badge,
      details: {
        taskCount,
        waveCount,
        parallelismFactor,
        taskCountTotal: rawTasks.length,
      },
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    const summary = `dag:view inspector failed: ${errMsg}`;
    const receiptHash = computeReceiptHash("dag:view", timestamp, "failed", summary);
    return {
      inspector: "dag:view",
      status: "failed",
      timestamp,
      durationMs,
      summary,
      receiptHash,
      badge: "[RECEIPT: dag:view FAIL]",
      error: errMsg,
    };
  }
}

export async function runInspectorUnifiedReport(
  runRoot?: string,
  state?: unknown,
  clock: Clock = systemClock,
): Promise<CliDiagnosticReceipt> {
  const start = Date.now();
  const timestamp = clock.now().toISOString();

  if (!runRoot || !existsSync(runRoot)) {
    if (isRecord(state)) {
      const taskCount = isRecord(state.tasks) ? Object.keys(state.tasks).length : 0;
      const durationMs = Date.now() - start;
      const summary = `In-memory unified report generated: ${taskCount} tasks in state`;
      const receiptHash = computeReceiptHash("report:unified", timestamp, "passed", summary);
      return {
        inspector: "report:unified",
        status: "passed",
        timestamp,
        durationMs,
        summary,
        receiptHash,
        badge: `[RECEIPT: report:unified IN-MEMORY (${taskCount} tasks)]`,
        details: { taskCount },
      };
    }

    const durationMs = Date.now() - start;
    const summary = "No runRoot or state provided; unified report skipped";
    const receiptHash = computeReceiptHash("report:unified", timestamp, "skipped", summary);
    return {
      inspector: "report:unified",
      status: "skipped",
      timestamp,
      durationMs,
      summary,
      receiptHash,
      badge: "[RECEIPT: report:unified SKIP]",
    };
  }

  try {
    const report = generateUnifiedReport(runRoot, { detailed: false });
    const durationMs = Date.now() - start;
    const totalTasks = report.topology.total_tasks;
    const satisfiedTasks = report.topology.satisfied;
    const summary = `Unified run report verified: ${satisfiedTasks}/${totalTasks} tasks satisfied, ${report.agent_matrix.length} agents tracked`;
    const receiptHash = computeReceiptHash("report:unified", timestamp, "passed", summary);
    const badge = `[RECEIPT: report:unified OK (${satisfiedTasks}/${totalTasks})]`;

    return {
      inspector: "report:unified",
      status: "passed",
      timestamp,
      durationMs,
      summary,
      receiptHash,
      badge,
      details: {
        totalTasks,
        satisfiedTasks,
        totalAgents: report.agent_matrix.length,
        activeLeases: report.leases.length,
      },
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    const summary = `Unified report generation failed: ${errMsg}`;
    const receiptHash = computeReceiptHash("report:unified", timestamp, "failed", summary);
    return {
      inspector: "report:unified",
      status: "failed",
      timestamp,
      durationMs,
      summary,
      receiptHash,
      badge: "[RECEIPT: report:unified FAIL]",
      error: errMsg,
    };
  }
}
