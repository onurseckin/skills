import type { SupervisoryPersonaReminder } from "../../authority/supervisory/index.ts";
import { formatDuration } from "../../mind/proposals/brief/index.ts";
import { MindAutonomousDiscoveryEngine } from "../../mind/tasks/discovery/index.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import type {
  MindPulseActiveAgentCoordinate,
  MindPulseWaveLaneInfo,
  MindPulseWorkSpanMetrics,
} from "./mind-pulse-metrics.ts";

export function formatPulseDirective(params: {
  readonly activeRuns: number;
  readonly pendingBacklog: number;
}): string {
  if (params.activeRuns === 0 && params.pendingBacklog === 0) {
    const proposals = MindAutonomousDiscoveryEngine.generateProposals({
      backlogCount: params.pendingBacklog,
      activeRunCount: params.activeRuns,
      unresolvedDefects: 0,
    });
    const lines = [
      "### MODE A AUTONOMOUS DISCOVERY REQUIRED",
      "- Active Runs: 0",
      "- Pending Backlog: 0",
      "- Action: Generate candidate proposals using MindAutonomousDiscoveryEngine.",
      "- Invariant: CLOSING_FORBIDDEN_FOR_MIND",
    ];
    if (proposals.length > 0) {
      lines.push("");
      lines.push("#### Discovery Proposals:");
      for (const p of proposals) {
        lines.push(`- **${p.title}** (${p.category}): ${p.candidateGoal}`);
      }
    }
    return lines.join("\n");
  }
  return "";
}

export function formatMindPulseActiveBrief(params: {
  readonly pulseId: string;
  readonly runRoot: string;
  readonly actor: string;
  readonly host: string;
  readonly driver: string;
  readonly openedAt: string;
  readonly deadlineAt: string;
  readonly scheduledIntervalMs: number;
  readonly nextWakeAt: string;
  readonly pulsesToday: number;
  readonly pulsesPerDay: number | null;
  readonly personaReminder?: SupervisoryPersonaReminder | undefined;
  readonly workSpan?: MindPulseWorkSpanMetrics | undefined;
  readonly activeAgents?: readonly MindPulseActiveAgentCoordinate[] | undefined;
  readonly waveLanes?: readonly MindPulseWaveLaneInfo[] | undefined;
  readonly cliReceiptSummaryBadge?: string | undefined;
  readonly dagBadges?: readonly string[] | undefined;
  readonly activeRuns?: number;
  readonly pendingBacklog?: number;
}): string {
  const limitStr = params.pulsesPerDay === null ? "∞" : params.pulsesPerDay;
  const lines = [
    `### Mind Pulse Active: ${params.pulseId}`,
    `- **Status**: active (perpetual)`,
    `- **Capsule Root**: \`${params.runRoot}\``,
    `- **Actor**: \`${params.actor}\``,
    `- **Host**: \`${params.host}\``,
    `- **Driver**: \`${params.driver}\``,
    `- **Opened At**: \`${params.openedAt}\``,
    `- **Deadline At**: \`${params.deadlineAt}\``,
    `- **Next Scheduled Interval**: \`${formatDuration(params.scheduledIntervalMs)}\` (\`${params.nextWakeAt}\`)`,
    `- **Budget Headroom**: ${params.pulsesToday} / ${limitStr} pulses today`,
  ];

  if (params.cliReceiptSummaryBadge) {
    lines.push(`- **CLI Diagnostics Receipts**: ${params.cliReceiptSummaryBadge}`);
  }

  if (params.workSpan && params.workSpan.total_work > 0) {
    lines.push(
      `- **Work/Span Concurrency**: Work=${params.workSpan.total_work}, Span=${params.workSpan.span}, P=${params.workSpan.parallelism_factor} (Optimal=${params.workSpan.optimal_concurrency}, Active=${params.workSpan.active_concurrency})`,
    );
  }

  if (params.activeAgents && params.activeAgents.length > 0) {
    const badges = params.activeAgents.map((a) => a.coordinate_badge).join(" ");
    lines.push(`- **Active Agents**: ${badges}`);
  }

  if (params.dagBadges && params.dagBadges.length > 0) {
    lines.push(`- **ASCII DAG Badges**: ${params.dagBadges.slice(0, 6).join(" ")}`);
  }

  if (params.waveLanes && params.waveLanes.length > 0) {
    const lanesStr = params.waveLanes
      .map(
        (w) => `Wave ${w.wave}: ${w.lane_count} lane(s) [${w.status}]${w.is_active ? " ⚡" : ""}`,
      )
      .join(" | ");
    lines.push(`- **Wave Lanes**: ${lanesStr}`);
  }

  if (params.personaReminder) {
    lines.push(`- **Persona Mandate**: ${params.personaReminder.persona.coreMandate}`);
  }

  lines.push(
    `- **Cadence**: infinite autonomous cadence (CLOSING_FORBIDDEN_FOR_MIND)`,
    `- **Invariant**: Mind never self-terminates, dies, or closes. Runs indefinitely until human OS termination.`,
    `- **Supervisory Invariants**: Strict 4-Tier Spawning Hierarchy & Supervisor Zero-File-Edit Invariant actively enforced.`,
  );

  if (typeof params.activeRuns === "number" && typeof params.pendingBacklog === "number") {
    const directive = formatPulseDirective({
      activeRuns: params.activeRuns,
      pendingBacklog: params.pendingBacklog,
    });
    if (directive) lines.push(directive);
  }
  return enforceLineLimit(lines.join("\n"), 35);
}

export function formatMindPulseOpenedBrief(params: {
  readonly pulseId: string;
  readonly runRoot: string;
  readonly actor: string;
  readonly host: string;
  readonly driver: string;
  readonly openedAt: string;
  readonly deadlineAt: string;
  readonly scheduledIntervalMs: number;
  readonly nextWakeAt: string;
  readonly pulsesToday: number;
  readonly pulsesPerDay: number | null;
  readonly personaReminder?: SupervisoryPersonaReminder | undefined;
  readonly workSpan?: MindPulseWorkSpanMetrics | undefined;
  readonly activeAgents?: readonly MindPulseActiveAgentCoordinate[] | undefined;
  readonly waveLanes?: readonly MindPulseWaveLaneInfo[] | undefined;
  readonly cliReceiptSummaryBadge?: string | undefined;
  readonly dagBadges?: readonly string[] | undefined;
  readonly activeRuns?: number;
  readonly pendingBacklog?: number;
}): string {
  const limitStr = params.pulsesPerDay === null ? "∞" : params.pulsesPerDay;
  const lines = [
    `### Mind Pulse Opened: ${params.pulseId}`,
    `- **Status**: opened (perpetual)`,
    `- **Capsule Root**: \`${params.runRoot}\``,
    `- **Actor**: \`${params.actor}\``,
    `- **Host**: \`${params.host}\``,
    `- **Driver**: \`${params.driver}\``,
    `- **Opened At**: \`${params.openedAt}\``,
    `- **Deadline At**: \`${params.deadlineAt}\``,
    `- **Next Scheduled Interval**: \`${formatDuration(params.scheduledIntervalMs)}\` (\`${params.nextWakeAt}\`)`,
    `- **Budget Headroom**: ${params.pulsesToday} / ${limitStr} pulses today`,
  ];

  if (params.cliReceiptSummaryBadge) {
    lines.push(`- **CLI Diagnostics Receipts**: ${params.cliReceiptSummaryBadge}`);
  }

  if (params.workSpan && params.workSpan.total_work > 0) {
    lines.push(
      `- **Work/Span Concurrency**: Work=${params.workSpan.total_work}, Span=${params.workSpan.span}, P=${params.workSpan.parallelism_factor} (Optimal=${params.workSpan.optimal_concurrency}, Active=${params.workSpan.active_concurrency})`,
    );
  }

  if (params.activeAgents && params.activeAgents.length > 0) {
    const badges = params.activeAgents.map((a) => a.coordinate_badge).join(" ");
    lines.push(`- **Active Agents**: ${badges}`);
  }

  if (params.dagBadges && params.dagBadges.length > 0) {
    lines.push(`- **ASCII DAG Badges**: ${params.dagBadges.slice(0, 6).join(" ")}`);
  }

  if (params.waveLanes && params.waveLanes.length > 0) {
    const lanesStr = params.waveLanes
      .map(
        (w) => `Wave ${w.wave}: ${w.lane_count} lane(s) [${w.status}]${w.is_active ? " ⚡" : ""}`,
      )
      .join(" | ");
    lines.push(`- **Wave Lanes**: ${lanesStr}`);
  }

  if (params.personaReminder) {
    lines.push(`- **Persona Mandate**: ${params.personaReminder.persona.coreMandate}`);
  }

  lines.push(
    `- **Cadence**: infinite autonomous cadence (CLOSING_FORBIDDEN_FOR_MIND)`,
    `- **Invariant**: Mind never self-terminates, dies, or closes. Runs indefinitely until human OS termination.`,
    `- **Supervisory Invariants**: Strict 4-Tier Spawning Hierarchy & Supervisor Zero-File-Edit Invariant actively enforced.`,
  );

  if (typeof params.activeRuns === "number" && typeof params.pendingBacklog === "number") {
    const directive = formatPulseDirective({
      activeRuns: params.activeRuns,
      pendingBacklog: params.pendingBacklog,
    });
    if (directive) lines.push(directive);
  }
  return enforceLineLimit(lines.join("\n"), 35);
}
