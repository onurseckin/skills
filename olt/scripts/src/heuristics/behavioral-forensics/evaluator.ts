/**
 * @file evaluator.ts
 * Main coordinator for behavioral forensics heuristics, efficiency scoring, and report rendering.
 */

import { calculateForensicsEfficiencyScore } from "./efficiency-scorer.ts";
import { synthesizePlanInjectionProposals } from "./plan-injection.ts";
import { evaluateRoleBoundaryHeuristics } from "./role-boundaries.ts";
import { evaluateSerializationHeuristics } from "./serialization.ts";
import { evaluateSystemLeaksHeuristics } from "./system-leaks.ts";
import { evaluateTokenBurnHeuristics } from "./token-burn.ts";
import type {
  BehavioralForensicsAnalysisResult,
  BehavioralForensicsContext,
  BehavioralForensicsIncident,
  BehavioralForensicsMetrics,
  BehavioralForensicsSummary,
  ExtractedToolCall,
  ForensicsSeverity,
  RootCauseCategory,
} from "./types.ts";

export interface RunForensicsAnalysisInput {
  readonly runId?: string | undefined;
  readonly allToolCalls?: readonly ExtractedToolCall[] | undefined;
  readonly events?: readonly Record<string, unknown>[] | undefined;
  readonly tasks?: readonly import("./types.ts").TaskRecord[] | undefined;
  readonly agents?: readonly import("./types.ts").AgentRecord[] | undefined;
  readonly state?: Record<string, unknown> | null | undefined;
  readonly agentId?: string | undefined;
}

const SEVERITY_PRECEDENCE: Readonly<Record<ForensicsSeverity, number>> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export function analyzeBehavioralForensics(
  input: RunForensicsAnalysisInput,
): BehavioralForensicsAnalysisResult {
  const runId = input.runId ?? "run-anonymous";
  const analyzedAt = new Date().toISOString();
  const rawIncidents: BehavioralForensicsIncident[] = [];
  const addIncident = (inc: BehavioralForensicsIncident) => rawIncidents.push(inc);

  const allToolCalls = input.allToolCalls ?? [];
  const events = input.events ?? [];
  const tasks = input.tasks;
  const agents = input.agents;
  const state = input.state;
  const agentId = input.agentId;

  const context: BehavioralForensicsContext = {
    allToolCalls,
    events,
    tasks,
    agents,
    state,
    agentId,
    addIncident,
  };

  evaluateTokenBurnHeuristics(context);
  const { sequentialWaveBottlenecks } = evaluateSerializationHeuristics(context);
  const { totalBoundaryViolations } = evaluateRoleBoundaryHeuristics(context);
  const { pollingCallsCount, ghostLeasesCount, stragglerTasksCount, contextOverflowCount } =
    evaluateSystemLeaksHeuristics(context);

  const seen = new Set<string>();
  const incidents: BehavioralForensicsIncident[] = [];
  for (const inc of rawIncidents) {
    const key = `${inc.category}:${inc.title}:${inc.observation}`;
    if (!seen.has(key)) {
      seen.add(key);
      incidents.push(inc);
    }
  }

  incidents.sort(
    (a, b) => (SEVERITY_PRECEDENCE[a.severity] ?? 99) - (SEVERITY_PRECEDENCE[b.severity] ?? 99),
  );

  let fileReadCount = 0;
  let fileWriteCount = 0;
  for (const call of allToolCalls) {
    if (call.isRead) fileReadCount++;
    if (call.isWrite) fileWriteCount++;
  }
  const readToWriteRatio = fileWriteCount > 0 ? fileReadCount / fileWriteCount : fileReadCount;

  const efficiencyReport = calculateForensicsEfficiencyScore({
    incidents,
    totalToolCalls: allToolCalls.length,
    fileReadCount,
    fileWriteCount,
    readToWriteRatio,
    pollingCallsCount,
    sequentialWaveBottlenecks,
    contextOverflowCount,
  });

  const criticalCount = incidents.filter((i) => i.severity === "CRITICAL").length;
  const highCount = incidents.filter((i) => i.severity === "HIGH").length;
  const mediumCount = incidents.filter((i) => i.severity === "MEDIUM").length;
  const lowCount = incidents.filter((i) => i.severity === "LOW").length;
  const isClean = incidents.length === 0;

  const summaryText = isClean
    ? `Run '${runId}' achieved 100% behavioral efficiency with zero forensics deviations.`
    : `Run '${runId}' exhibited ${incidents.length} behavioral forensics deviation(s) (${efficiencyReport.formattedScore} efficiency).`;

  const summary: BehavioralForensicsSummary = {
    clean: isClean,
    totalIncidents: incidents.length,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    summaryText,
  };

  const incidentCountsByCategory: Record<RootCauseCategory, number> = {
    TOKEN_BURNING: incidents.filter((i) => i.category === "TOKEN_BURNING").length,
    FALSE_SERIALIZATION: incidents.filter((i) => i.category === "FALSE_SERIALIZATION").length,
    ROLE_BOUNDARY_DEVIATION: incidents.filter((i) => i.category === "ROLE_BOUNDARY_DEVIATION")
      .length,
    POLLING_WASTE: incidents.filter((i) => i.category === "POLLING_WASTE").length,
    CONTEXT_OVERFLOW: incidents.filter((i) => i.category === "CONTEXT_OVERFLOW").length,
    GHOST_LEASE: incidents.filter((i) => i.category === "GHOST_LEASE").length,
    STRAGGLER: incidents.filter((i) => i.category === "STRAGGLER").length,
  };

  const incidentCountsBySeverity: Record<ForensicsSeverity, number> = {
    CRITICAL: criticalCount,
    HIGH: highCount,
    MEDIUM: mediumCount,
    LOW: lowCount,
  };

  let totalTokensIn = 0;
  let totalTokensOut = 0;
  if (agents) {
    for (const ag of agents) {
      totalTokensIn += ag.tokensIn ?? 0;
      totalTokensOut += ag.tokensOut ?? 0;
    }
  }

  const metrics: BehavioralForensicsMetrics = {
    totalToolCalls: allToolCalls.length,
    fileReadCount,
    fileWriteCount,
    readToWriteRatio,
    pollingCallsCount,
    sequentialWaveBottlenecks,
    boundaryDeviationsCount: totalBoundaryViolations,
    stragglerTasksCount,
    ghostLeasesCount,
    contextOverflowCount,
    efficiencyScore: efficiencyReport.boundedScore,
    totalTokensIn,
    totalTokensOut,
    incidentCountsByCategory,
    incidentCountsBySeverity,
  };

  const proposals = synthesizePlanInjectionProposals(incidents);

  return {
    runId,
    analyzedAt,
    isClean,
    efficiencyScore: efficiencyReport.boundedScore,
    efficiencyReport,
    summary,
    metrics,
    incidents,
    proposals,
  };
}

export function formatBehavioralForensicsReport(result: BehavioralForensicsAnalysisResult): string {
  const lines: string[] = [];
  lines.push(`# Behavioral Forensics & Token Burn Analysis Report`);
  lines.push(``);
  lines.push(`- **Run ID**: \`${result.runId}\``);
  lines.push(`- **Efficiency Score**: **${result.efficiencyReport.formattedScore}**`);
  lines.push(
    `- **Verdict**: **${result.isClean ? "CLEAN / HIGH EFFICIENCY" : "FORENSICS DEVIATIONS DETECTED"}**`,
  );
  lines.push(``);
  lines.push(`## Operational Metrics`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`| :--- | :--- |`);
  lines.push(`| Total Tool Calls | \`${result.metrics.totalToolCalls}\` |`);
  lines.push(
    `| File Reads / Writes | \`${result.metrics.fileReadCount}\` / \`${result.metrics.fileWriteCount}\` (Ratio \`${result.metrics.readToWriteRatio.toFixed(2)}\`) |`,
  );
  lines.push(`| Polling Calls | \`${result.metrics.pollingCallsCount}\` |`);
  lines.push(`| Sequential Wave Bottlenecks | \`${result.metrics.sequentialWaveBottlenecks}\` |`);
  lines.push(`| Boundary Deviations | \`${result.metrics.boundaryDeviationsCount}\` |`);
  lines.push(`| Straggler Tasks | \`${result.metrics.stragglerTasksCount}\` |`);
  lines.push(`| Ghost Leases | \`${result.metrics.ghostLeasesCount}\` |`);
  lines.push(``);
  lines.push(`## Incidents (${result.incidents.length})`);
  lines.push(``);
  if (result.incidents.length === 0) {
    lines.push(`> [!NOTE]`);
    lines.push(`> No behavioral deviations, token burning, or concurrency bottlenecks detected.`);
  } else {
    for (const inc of result.incidents) {
      lines.push(`### [${inc.severity}] ${inc.title} (\`${inc.id}\`)`);
      lines.push(`- **Category**: \`${inc.category}\``);
      if (inc.agentId) lines.push(`- **Agent**: \`${inc.agentId}\``);
      if (inc.taskId) lines.push(`- **Task**: \`${inc.taskId}\``);
      lines.push(`- **Observation**: ${inc.observation}`);
      lines.push(`- **Remediation Directive**: ${inc.remediation}`);
      lines.push(``);
    }
  }
  lines.push(`## Autonomous Remediation Proposals (${result.proposals.length})`);
  lines.push(``);
  for (const prop of result.proposals) {
    lines.push(`- **[${prop.priority}] ${prop.title}** (\`${prop.id}\`)`);
    lines.push(`  * Target Role: \`${prop.targetRole}\` | Root Cause: \`${prop.rootCause}\``);
    lines.push(`  * Directive: ${prop.remediationDirective}`);
  }
  return lines.join("\n");
}

export function renderBehavioralForensicsAsciiTable(
  incidents: readonly BehavioralForensicsIncident[],
): string {
  if (incidents.length === 0) {
    return "+-------------------------------------------------------------------------+\n| No forensics incidents detected. Run is fully compliant.                |\n+-------------------------------------------------------------------------+";
  }
  const rows = incidents.map((inc) => {
    const id = inc.id.padEnd(22).slice(0, 22);
    const cat = inc.category.padEnd(22).slice(0, 22);
    const sev = inc.severity.padEnd(8).slice(0, 8);
    const target = (inc.agentId ?? inc.taskId ?? "N/A").padEnd(18).slice(0, 18);
    const title = inc.title.slice(0, 36).padEnd(36);
    return `| ${id} | ${cat} | ${sev} | ${target} | ${title} |`;
  });
  const sep =
    "+------------------------+------------------------+----------+--------------------+--------------------------------------+";
  const header = `| ID                     | Category               | Severity | Target             | Title                                |\n${sep}`;
  return `${sep}\n${header}\n${rows.join("\n")}\n${sep}`;
}
