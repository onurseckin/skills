import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { ALL_CHECKS, defaultLayout, runHealthCheck } from "../../health/index.ts";
import type { HealthCheckId, HealthReport } from "../../health/types.ts";
import { runDoctor, type DoctorOptions } from "../../reporting/doctor.ts";
import { generateUnifiedReport, type UnifiedReport } from "../../reporting/unified.ts";
import { isRecord } from "../../requirements/predicates.ts";
import { systemClock, type Clock, type WorkflowState } from "../../workflow/types.ts";
import { statusGlyph } from "../../summary/dag-visualizer.ts";
import { dependencyMap } from "../../graph/dependency-map.ts";
import { schedulingMetrics } from "./metrics.ts";

export type DiagnosticInspectorName =
  | "doctor"
  | "health"
  | "dag:view"
  | "report:unified"
  | (string & {});

export type DiagnosticReceiptStatus = "passed" | "failed" | "warning" | "skipped";

export interface CliDiagnosticReceipt {
  readonly inspector: DiagnosticInspectorName;
  readonly status: DiagnosticReceiptStatus;
  readonly timestamp: string;
  readonly durationMs: number;
  readonly summary: string;
  readonly receiptHash: string;
  readonly badge: string;
  readonly details?: Record<string, unknown> | undefined;
  readonly error?: string | undefined;
}

export interface ScriptBackedDiagnosticsOptions {
  readonly runRoot?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly scriptsRoot?: string | undefined;
  readonly state?: WorkflowState | Record<string, unknown> | unknown | undefined;
  readonly inspectors?: readonly DiagnosticInspectorName[] | undefined;
  readonly clock?: Clock | undefined;
  readonly strict?: boolean | undefined;
  readonly doctorOptions?: DoctorOptions | undefined;
  readonly healthChecks?: readonly HealthCheckId[] | undefined;
  readonly customInspectors?:
    | Readonly<
        Record<
          string,
          (
            options: ScriptBackedDiagnosticsOptions,
          ) => Promise<CliDiagnosticReceipt> | CliDiagnosticReceipt
        >
      >
    | undefined;
}

export interface ScriptBackedDiagnosticsResult {
  readonly healthy: boolean;
  readonly executedAt: string;
  readonly durationMs: number;
  readonly receipts: readonly CliDiagnosticReceipt[];
  readonly receiptSummaryBadge: string;
  readonly doctorReceipt?: CliDiagnosticReceipt | undefined;
  readonly healthReceipt?: CliDiagnosticReceipt | undefined;
  readonly dagViewReceipt?: CliDiagnosticReceipt | undefined;
  readonly unifiedReportReceipt?: CliDiagnosticReceipt | undefined;
  readonly liveAsciiDag?: string | undefined;
  readonly dagBadges?: readonly string[] | undefined;
  readonly errors: readonly string[];
}

export function computeReceiptHash(
  inspector: string,
  timestamp: string,
  status: string,
  summary: string,
): string {
  return createHash("sha256")
    .update(`${inspector}:${timestamp}:${status}:${summary}`)
    .digest("hex");
}

export function generateReceiptBadge(receipt: CliDiagnosticReceipt): string {
  const icon =
    receipt.status === "passed"
      ? "PASS"
      : receipt.status === "warning"
        ? "WARN"
        : receipt.status === "skipped"
          ? "SKIP"
          : "FAIL";
  return `[RECEIPT: ${receipt.inspector} ${icon}]`;
}

export function generateReceiptSummaryBadge(receipts: readonly CliDiagnosticReceipt[]): string {
  if (receipts.length === 0) {
    return "[CLI-RECEIPTS: none]";
  }
  const parts = receipts.map((r) => {
    const symbol =
      r.status === "passed"
        ? "✓"
        : r.status === "warning"
          ? "⚠️"
          : r.status === "skipped"
            ? "○"
            : "✗";
    return `${r.inspector} ${symbol}`;
  });
  return `[CLI-RECEIPTS: ${parts.join(" | ")}]`;
}

export function generateAsciiDagBadges(
  stateOrTasks: unknown,
  providedWaveMap?: ReadonlyMap<string, number>,
): readonly string[] {
  const badges: string[] = [];

  let rawTasks: {
    id: string;
    status: string;
    deps: readonly string[];
    assignedAgent: string | null;
    role: string | null;
  }[] = [];

  if (Array.isArray(stateOrTasks)) {
    rawTasks = stateOrTasks.map((t) => {
      if (isRecord(t)) {
        const id = typeof t.id === "string" ? t.id : "unknown";
        const status = typeof t.status === "string" ? t.status : "proposed";
        const deps = Array.isArray(t.dependencies)
          ? t.dependencies.filter((d): d is string => typeof d === "string")
          : Array.isArray(t.deps)
            ? t.deps.filter((d): d is string => typeof d === "string")
            : [];
        const lease = isRecord(t.lease) ? t.lease : null;
        const assignedAgent = lease
          ? typeof lease.agent_id === "string" && lease.agent_id.trim().length > 0
            ? lease.agent_id.trim()
            : typeof lease.agent === "string" && lease.agent.trim().length > 0
              ? lease.agent.trim()
              : null
          : typeof t.assignedAgent === "string"
            ? t.assignedAgent
            : null;
        const role = lease && typeof lease.role === "string" ? lease.role : null;
        return { id, status, deps, assignedAgent, role };
      }
      return { id: String(t), status: "proposed", deps: [], assignedAgent: null, role: null };
    });
  } else if (isRecord(stateOrTasks) && isRecord(stateOrTasks.tasks)) {
    for (const [id, t] of Object.entries(stateOrTasks.tasks)) {
      if (isRecord(t)) {
        const status = typeof t.status === "string" ? t.status : "proposed";
        const deps = Array.isArray(t.dependencies)
          ? t.dependencies.filter((d): d is string => typeof d === "string")
          : [];
        const lease = isRecord(t.lease) ? t.lease : null;
        const assignedAgent = lease
          ? typeof lease.agent_id === "string" && lease.agent_id.trim().length > 0
            ? lease.agent_id.trim()
            : typeof lease.agent === "string" && lease.agent.trim().length > 0
              ? lease.agent.trim()
              : null
          : null;
        const role = lease && typeof lease.role === "string" ? lease.role : null;
        rawTasks.push({ id, status, deps, assignedAgent, role });
      }
    }
  }

  if (rawTasks.length === 0) {
    return [];
  }

  // Compute wave map if not provided
  const waveMap = new Map<string, number>();
  if (providedWaveMap) {
    for (const [k, v] of providedWaveMap) {
      waveMap.set(k, v);
    }
  } else {
    const depMap = new Map<string, Set<string>>();
    for (const t of rawTasks) {
      depMap.set(t.id, new Set(t.deps));
    }
    let curWave = 1;
    const processed = new Set<string>();
    while (processed.size < rawTasks.length) {
      const readyInWave: string[] = [];
      for (const t of rawTasks) {
        if (processed.has(t.id)) continue;
        const prereqs = depMap.get(t.id) ?? new Set<string>();
        if ([...prereqs].every((p) => waveMap.has(p))) {
          readyInWave.push(t.id);
        }
      }
      if (readyInWave.length === 0) {
        for (const t of rawTasks) {
          if (!processed.has(t.id)) {
            waveMap.set(t.id, curWave);
            processed.add(t.id);
          }
        }
        break;
      }
      for (const id of readyInWave) {
        waveMap.set(id, curWave);
        processed.add(id);
      }
      curWave++;
    }
  }

  // Assign lane index per wave
  const waveLaneCounters = new Map<number, number>();
  for (const t of rawTasks) {
    const wave = waveMap.get(t.id) ?? 1;
    const curLane = (waveLaneCounters.get(wave) ?? 0) + 1;
    waveLaneCounters.set(wave, curLane);

    const glyph = statusGlyph(t.status, t.deps.length > 0);
    if (
      t.assignedAgent &&
      (t.status === "leased" || t.status === "running" || t.status === "validating")
    ) {
      const roleStr = t.role ? ` (${t.role})` : "";
      badges.push(`[W${wave}:L${curLane} ${glyph} ${t.assignedAgent}${roleStr} @ ${t.id}]`);
    } else {
      badges.push(`[W${wave}:L${curLane} ${glyph} ${t.id}]`);
    }
  }

  return badges;
}

export function formatDiagnosticReceiptsMarkdown(result: ScriptBackedDiagnosticsResult): string {
  const lines: string[] = [
    `### Script-Backed Diagnostics Engine Telemetry`,
    `- **Status**: ${result.healthy ? "HEALTHY (All CLI Diagnostics Passed)" : "ATTENTION (Diagnostics Failed)"}`,
    `- **Executed At**: \`${result.executedAt}\` (${result.durationMs}ms)`,
    `- **Summary Badge**: \`${result.receiptSummaryBadge}\``,
  ];

  if (result.receipts.length > 0) {
    lines.push(`- **Live CLI Diagnostic Receipts**:`);
    for (const receipt of result.receipts) {
      const mark =
        receipt.status === "passed"
          ? "✓"
          : receipt.status === "skipped"
            ? "○"
            : receipt.status === "warning"
              ? "⚠️"
              : "✗";
      lines.push(
        `  - \`${receipt.badge}\` **${receipt.inspector}** (${receipt.durationMs}ms) [${mark}]: ${receipt.summary}`,
      );
      lines.push(`    - *Receipt Hash*: \`${receipt.receiptHash.slice(0, 16)}...\``);
    }
  }

  if (result.dagBadges && result.dagBadges.length > 0) {
    lines.push(`- **ASCII DAG Badges**:`);
    lines.push(`  ${result.dagBadges.join(" ")}`);
  }

  if (result.errors.length > 0) {
    lines.push(`- **Diagnostic Errors**:`);
    for (const err of result.errors) {
      lines.push(`  - ❌ ${err}`);
    }
  }

  return lines.join("\n");
}

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

    const report = runHealthCheck(layout, checks ?? ["vendor-identifiers", "vendor-prose"]);
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
      const { dagViewCommand } = await import("../../cli/commands/dag-view.ts");
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

/**
 * Standardized Script-Backed Diagnostics Engine
 * Executes real Harness CLI diagnostic inspectors (doctor, health, dag:view, report:unified)
 * and generates live cryptographic receipts and ASCII DAG badges before telemetry emission.
 */
export async function runScriptBackedDiagnostics(
  options: ScriptBackedDiagnosticsOptions = {},
): Promise<ScriptBackedDiagnosticsResult> {
  const start = Date.now();
  const clock = options.clock ?? systemClock;
  const executedAt = clock.now().toISOString();
  const errors: string[] = [];

  const inspectorsToRun = options.inspectors ?? ["doctor", "health", "dag:view", "report:unified"];
  const receipts: CliDiagnosticReceipt[] = [];

  let doctorReceipt: CliDiagnosticReceipt | undefined = undefined;
  let healthReceipt: CliDiagnosticReceipt | undefined = undefined;
  let dagViewReceipt: CliDiagnosticReceipt | undefined = undefined;
  let unifiedReportReceipt: CliDiagnosticReceipt | undefined = undefined;

  for (const inspector of inspectorsToRun) {
    try {
      if (options.customInspectors && options.customInspectors[inspector]) {
        const customReceipt = await options.customInspectors[inspector]!(options);
        receipts.push(customReceipt);
        if (customReceipt.status === "failed") {
          errors.push(`Custom inspector '${inspector}' failed: ${customReceipt.summary}`);
        }
        continue;
      }

      switch (inspector) {
        case "doctor": {
          doctorReceipt = await runInspectorDoctor(
            options.runRoot,
            options.doctorOptions ?? {},
            clock,
          );
          receipts.push(doctorReceipt);
          if (doctorReceipt.status === "failed") {
            errors.push(`Doctor inspector failed: ${doctorReceipt.summary}`);
          }
          break;
        }
        case "health": {
          healthReceipt = await runInspectorHealth(
            options.scriptsRoot,
            options.healthChecks,
            clock,
          );
          receipts.push(healthReceipt);
          if (healthReceipt.status === "failed") {
            errors.push(`Health inspector failed: ${healthReceipt.summary}`);
          }
          break;
        }
        case "dag:view": {
          dagViewReceipt = await runInspectorDagView(
            options.runRoot,
            options.state,
            options.repoRoot ?? process.cwd(),
            clock,
          );
          receipts.push(dagViewReceipt);
          if (dagViewReceipt.status === "failed") {
            errors.push(`dag:view inspector failed: ${dagViewReceipt.summary}`);
          }
          break;
        }
        case "report:unified": {
          unifiedReportReceipt = await runInspectorUnifiedReport(
            options.runRoot,
            options.state,
            clock,
          );
          receipts.push(unifiedReportReceipt);
          if (unifiedReportReceipt.status === "failed") {
            errors.push(`Unified report inspector failed: ${unifiedReportReceipt.summary}`);
          }
          break;
        }
        default: {
          const timestamp = clock.now().toISOString();
          const summary = `Unrecognized inspector '${inspector}'`;
          receipts.push({
            inspector,
            status: "warning",
            timestamp,
            durationMs: 0,
            summary,
            receiptHash: computeReceiptHash(inspector, timestamp, "warning", summary),
            badge: `[RECEIPT: ${inspector} WARN]`,
          });
          break;
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`Inspector '${inspector}' threw unexpected error: ${errMsg}`);
      const timestamp = clock.now().toISOString();
      receipts.push({
        inspector,
        status: "failed",
        timestamp,
        durationMs: 0,
        summary: errMsg,
        receiptHash: computeReceiptHash(inspector, timestamp, "failed", errMsg),
        badge: `[RECEIPT: ${inspector} FAIL]`,
        error: errMsg,
      });
    }
  }

  const receiptSummaryBadge = generateReceiptSummaryBadge(receipts);

  // Compute live DAG badges
  const dagBadges = generateAsciiDagBadges(options.state);

  const healthy = receipts.every((r) => r.status === "passed" || r.status === "skipped");
  const durationMs = Date.now() - start;

  if (options.strict && !healthy) {
    throw new HarnessError(
      "INVALID_STATE",
      `Script-backed diagnostics failed strict verification: ${errors.join("; ")}`,
      errors,
    );
  }

  return {
    healthy,
    executedAt,
    durationMs,
    receipts,
    receiptSummaryBadge,
    doctorReceipt,
    healthReceipt,
    dagViewReceipt,
    unifiedReportReceipt,
    dagBadges,
    errors,
  };
}
