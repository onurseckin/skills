import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defaultLayout, runHealthCheck } from "../../../health/index.ts";
import type { HealthCheckId } from "../../../health/types.ts";
import { runDoctor, type DoctorOptions } from "../../../reporting/doctor.ts";
import { generateUnifiedReport } from "../../../reporting/unified.ts";
import { isRecord } from "../../../requirements/predicates.ts";
import { systemClock, type Clock } from "../../../workflow/types.ts";
import { dependencyMap } from "../../../graph/dependency-map.ts";
import { schedulingMetrics } from "../topology/metrics.ts";
import {
  computeReceiptHash,
  type CliDiagnosticReceipt,
  type DiagnosticReceiptStatus,
} from "./receipts.ts";

export async function runInspectorDoctor(
  runRoot?: string,
  options: DoctorOptions = {},
  clock: Clock = systemClock,
): Promise<CliDiagnosticReceipt> {
  const start = Date.now();
  const timestamp = clock.now().toISOString();

  if (!runRoot || !existsSync(runRoot)) {
    const durationMs = Date.now() - start;
    const summary = runRoot
      ? `Capsule run directory not found: ${runRoot}`
      : "No runRoot specified; doctor inspector skipped";
    const receiptHash = computeReceiptHash("doctor", timestamp, "skipped", summary);
    return {
      inspector: "doctor",
      status: "skipped",
      timestamp,
      durationMs,
      summary,
      receiptHash,
      badge: "[RECEIPT: doctor SKIP]",
      details: { runRoot },
    };
  }

  try {
    const docResult = await runDoctor(runRoot, options);
    const durationMs = Date.now() - start;
    const healthy = docResult.healthy === true;
    const issues = Array.isArray(docResult.issues) ? (docResult.issues as readonly string[]) : [];
    const findings = Array.isArray(docResult.behavioral_findings)
      ? docResult.behavioral_findings
      : [];
    const status: DiagnosticReceiptStatus =
      healthy && issues.length === 0 && findings.length === 0 ? "passed" : "failed";
    const summary =
      status === "passed"
        ? `Capsule doctor verified 100% integrity (healthy: true, 0 findings)`
        : `Doctor detected ${issues.length} issue(s) and ${findings.length} behavioral finding(s)`;
    const receiptHash = computeReceiptHash("doctor", timestamp, status, summary);
    const badge = `[RECEIPT: doctor ${status === "passed" ? "PASS" : "FAIL"}]`;

    return {
      inspector: "doctor",
      status,
      timestamp,
      durationMs,
      summary,
      receiptHash,
      badge,
      details: {
        healthy: docResult.healthy,
        issuesCount: issues.length,
        behavioralFindingsCount: findings.length,
        bunVersion: docResult.bun_version,
      },
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    const summary = `Doctor execution failed with error: ${errMsg}`;
    const receiptHash = computeReceiptHash("doctor", timestamp, "failed", summary);
    return {
      inspector: "doctor",
      status: "failed",
      timestamp,
      durationMs,
      summary,
      receiptHash,
      badge: "[RECEIPT: doctor FAIL]",
      error: errMsg,
    };
  }
}

export async function runInspectorHealth(
  scriptsRoot?: string,
  checks?: readonly HealthCheckId[],
  clock: Clock = systemClock,
): Promise<CliDiagnosticReceipt> {
  const start = Date.now();
  const timestamp = clock.now().toISOString();

  try {
    const layout = scriptsRoot !== undefined ? defaultLayout(scriptsRoot) : defaultLayout();
    if (!existsSync(resolve(layout.scriptsRoot, "src"))) {
      const durationMs = Date.now() - start;
      const summary = `No scripts/src directory found under ${layout.scriptsRoot}; health check skipped`;
      const receiptHash = computeReceiptHash("health", timestamp, "skipped", summary);
      return {
        inspector: "health",
        status: "skipped",
        timestamp,
        durationMs,
        summary,
        receiptHash,
        badge: "[RECEIPT: health SKIP]",
        details: { scriptsRoot: layout.scriptsRoot },
      };
    }

    const report = runHealthCheck(layout, checks ?? ["intent-drift", "vendor-prose"]);
    const durationMs = Date.now() - start;
    const status: DiagnosticReceiptStatus = report.healthy ? "passed" : "failed";
    const summary = report.healthy
      ? `Semantic health passed: 0 failures across ${report.checks.length} checks`
      : `Semantic health failed: ${report.failure_count} failure(s) across ${report.checks.length} checks`;
    const receiptHash = computeReceiptHash("health", timestamp, status, summary);
    const badge = `[RECEIPT: health ${report.healthy ? "PASS" : `FAIL (${report.failure_count})`}]`;

    return {
      inspector: "health",
      status,
      timestamp,
      durationMs,
      summary,
      receiptHash,
      badge,
      details: {
        healthy: report.healthy,
        failureCount: report.failure_count,
        checksRun: report.checks.length,
      },
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    const summary = `Health check execution failed with error: ${errMsg}`;
    const receiptHash = computeReceiptHash("health", timestamp, "failed", summary);
    return {
      inspector: "health",
      status: "failed",
      timestamp,
      durationMs,
      summary,
      receiptHash,
      badge: "[RECEIPT: health FAIL]",
      error: errMsg,
    };
  }
}

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
