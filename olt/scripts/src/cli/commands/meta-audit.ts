import { HarnessError } from "../../core/errors/index.ts";
import {
  analyzeRunForensics,
  injectRemediationToFeedbackQueue,
  type FeedbackInjectionOptions,
  type FeedbackInjectionResult,
  type ForensicsAnalysisReport,
  type ForensicsCategory,
  type ForensicsEfficiencyMetrics,
  type ForensicsIncident,
  type ForensicsSeverity,
  type ForensicsSummary,
  type MetaAuditAnalysisOptions,
} from "../../mind/auditing/meta/index.ts";
import { enforceLineLimit, formatTable } from "../formatters/line-limiter.ts";
import { assertFlags, boolFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import { resolveBacklogPath } from "../../core/shared/paths.ts";

export type {
  FeedbackInjectionOptions,
  FeedbackInjectionResult,
  ForensicsAnalysisReport,
  ForensicsCategory,
  ForensicsEfficiencyMetrics,
  ForensicsIncident,
  ForensicsSeverity,
  ForensicsSummary,
  MetaAuditAnalysisOptions,
};

export interface MetaAuditCommandResult {
  readonly markdown: string;
  readonly run_root: string;
  readonly format: "markdown" | "json";
  readonly report: ForensicsAnalysisReport;
  readonly injection?: FeedbackInjectionResult | undefined;
  readonly [key: string]: unknown;
}

/**
 * Formats forensics incidents as a markdown table.
 */
export function renderForensicsIncidentTable(
  incidents: readonly ForensicsIncident[],
): readonly string[] {
  if (incidents.length === 0) {
    return ["_No behavioral forensics incidents detected matching filter criteria._"];
  }

  const headers = ["Incident ID", "Severity", "Category", "Agent", "Observation", "Remediation"];

  const rows = incidents.map((inc) => [
    `\`${inc.id}\``,
    inc.severity.toUpperCase(),
    `\`${inc.category}\``,
    inc.agent_id ? `\`${inc.agent_id}\`` : "-",
    inc.observation.replace(/\|/gu, "\\|"),
    inc.remediation.replace(/\|/gu, "\\|"),
  ]);

  return formatTable(headers, rows);
}

/**
 * Formats subagent behavioral & efficiency metrics as a markdown table.
 */
export function renderEfficiencyMetricsTable(
  metrics: ForensicsEfficiencyMetrics,
): readonly string[] {
  const headers = ["Behavioral Metric", "Observed Value", "Forensic Indicator"];
  const rows: (readonly string[])[] = [
    [
      "Total Events Analyzed",
      String(metrics.total_events_analyzed),
      "Capsule event stream timeline density",
    ],
    ["Total Tool Calls", String(metrics.total_tool_calls), "Subagent dispatched tool executions"],
    [
      "Exploration Reads Count",
      String(metrics.exploration_reads_count),
      "Broad/redundant file & directory exploration scans",
    ],
    [
      "Polling Calls Count",
      String(metrics.polling_calls_count),
      "Background status polling & async management checks",
    ],
    [
      "Concurrency Bottlenecks",
      String(metrics.concurrency_bottlenecks_detected),
      "False serialization & blocked execution waves",
    ],
    [
      "Role Boundary Deviations",
      String(metrics.role_boundary_deviations),
      "Actions exceeding role authority contract",
    ],
    [
      "Estimated Token Waste",
      metrics.total_token_waste_estimate !== undefined
        ? String(metrics.total_token_waste_estimate)
        : "0",
      "Estimated token burning from redundant exploratory probes",
    ],
    [
      "Efficiency Score",
      metrics.efficiency_score !== undefined ? `${metrics.efficiency_score}%` : "100%",
      "Overall behavioral & execution efficiency rating",
    ],
  ];

  return formatTable(headers, rows);
}

/**
 * Produces structured markdown summary for the meta-audit CLI command.
 */
export function formatMetaAuditReport(params: {
  readonly report: ForensicsAnalysisReport;
  readonly injection?: FeedbackInjectionResult | undefined;
  readonly verbose?: boolean | undefined;
}): string {
  const { report, injection, verbose } = params;
  const statusBadge = report.summary.clean
    ? "🟢 CLEAN (No Behavioral Defects Detected)"
    : report.summary.critical_count > 0
      ? "🔴 CRITICAL DEFECTS DETECTED"
      : "🟡 WARNINGS DETECTED";

  const lines: string[] = [
    "### Meta-Auditor Deep Behavioral Forensics Report",
    `- **Run Root**: \`${report.run_root}\``,
    `- **Analyzed At**: \`${report.analyzed_at}\``,
    `- **Agent Filter**: ${report.agent_filter ? `\`${report.agent_filter}\`` : "*all agents*"}`,
    `- **Status**: ${statusBadge}`,
    `- **Total Incidents Detected**: ${report.summary.total_incidents}`,
    `- **Severity Breakdown**: Critical: ${report.summary.critical_count} | High: ${report.summary.high_count} | Medium: ${report.summary.medium_count} | Low: ${report.summary.low_count}`,
    "",
    "#### Behavioral & Efficiency Metrics",
    ...renderEfficiencyMetricsTable(report.metrics),
    "",
    "#### Discovered Incidents & Root Causes",
    ...renderForensicsIncidentTable(report.incidents),
    "",
    "#### Feedback Queue Injection Status",
  ];

  if (injection !== undefined) {
    lines.push(
      `- **Status**: Injected ${injection.injected_count} remediation task(s) into feedback queue (\`${injection.queue_path ?? resolveBacklogPath()}\`)`,
    );
    if (injection.injected_items.length > 0) {
      lines.push(`- **Injected Items**: \`${injection.injected_items.join("`, `")}\``);
    }
  } else if (report.summary.total_incidents === 0) {
    lines.push("- **Status**: Clean run — no remediations required.");
  } else {
    lines.push(
      "- **Status**: Skipped (pass `--inject` to autonomously enqueue remediations into feedback queue)",
    );
  }

  if (verbose && report.incidents.length > 0) {
    lines.push("");
    lines.push("#### Forensic Incident Details");
    for (const inc of report.incidents) {
      lines.push(`- **\`${inc.id}\`** [${inc.severity.toUpperCase()} | \`${inc.category}\`]`);
      if (inc.agent_id) {
        lines.push(`  - **Agent**: \`${inc.agent_id}\``);
      }
      if (inc.task_id) {
        lines.push(`  - **Task**: \`${inc.task_id}\``);
      }
      lines.push(`  - **Observation**: ${inc.observation}`);
      lines.push(`  - **Root Cause**: ${inc.root_cause}`);
      lines.push(`  - **Remediation**: ${inc.remediation}`);
      if (inc.impact) {
        lines.push(`  - **Impact**: ${inc.impact}`);
      }
    }
  }

  const maxLines = verbose ? 300 : 35;
  return enforceLineLimit(lines.join("\n"), maxLines);
}

/**
 * meta-audit CLI command handler.
 * Performs deep behavioral forensics over run transcripts, tool calls, and capsule events.
 */
export async function metaAuditCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<MetaAuditCommandResult> {
  assertFlags(flags, ["run", "format", "inject", "agent", "actor", "verbose", "json"]);

  const run = textFlag(flags, "run", true)!;
  const formatFlag = textFlag(flags, "format", false);
  const jsonFlag = boolFlag(flags, "json");
  const inject = boolFlag(flags, "inject");
  const agent = textFlag(flags, "agent", false);
  const actor = textFlag(flags, "actor", false);
  const verbose = boolFlag(flags, "verbose");

  const normalizedFormat =
    formatFlag !== undefined ? formatFlag.trim().toLowerCase() : jsonFlag ? "json" : "markdown";

  if (normalizedFormat !== "markdown" && normalizedFormat !== "json") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `invalid --format '${formatFlag}'; must be 'markdown' or 'json'`,
    );
  }

  const analysisOptions: MetaAuditAnalysisOptions = {
    run,
    ...(agent !== undefined ? { agent } : {}),
    ...(verbose ? { verbose } : {}),
    ...(inject ? { inject } : {}),
  };

  const report: ForensicsAnalysisReport = await analyzeRunForensics(analysisOptions);

  let injectionResult: FeedbackInjectionResult | undefined = undefined;
  if (inject) {
    const injectionOptions: FeedbackInjectionOptions = {
      run,
    };
    injectionResult = await injectRemediationToFeedbackQueue(report.incidents, injectionOptions);
  }

  const markdown = formatMetaAuditReport({
    report,
    ...(actor === undefined ? {} : { actor }),
    ...(injectionResult !== undefined ? { injection: injectionResult } : {}),
    ...(verbose ? { verbose } : {}),
  });

  return {
    markdown,
    run_root: run,
    format: normalizedFormat,
    report,
    ...(injectionResult !== undefined ? { injection: injectionResult } : {}),
  };
}
