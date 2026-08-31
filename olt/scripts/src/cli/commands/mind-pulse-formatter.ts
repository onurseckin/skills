import type { SupervisoryPersonaReminder } from "../../authority/supervisory/index.ts";
import { formatDuration } from "../../mind/proposals/brief/index.ts";
import { MindAutonomousDiscoveryEngine } from "../../mind/tasks/discovery/index.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import type {
  MindPulseActiveAgentCoordinate,
  MindPulseWaveLaneInfo,
  MindPulseWorkSpanMetrics,
} from "./mind-pulse-metrics.ts";

export interface PulseDirectiveOptions {
  readonly activeRuns: number;
  readonly pendingBacklog: number;
  readonly isStagnating?: boolean | undefined;
  readonly stagnationStreak?: number | undefined;
  readonly stagnationReason?: string | undefined;
  readonly stagnationRemediation?: string | undefined;
  readonly readyTasksCount?: number | undefined;
}

export function formatPulseDirective(params: PulseDirectiveOptions): string {
  // 1. Stagnation Directive
  if (params.isStagnating || (typeof params.stagnationStreak === "number" && params.stagnationStreak >= 2)) {
    const streak = params.stagnationStreak ?? 2;
    const lines = [
      `### 🚨 STAGNATION MITIGATION DIRECTIVE [STREAK ${streak}]`,
      `- **Observation**: ${params.stagnationReason ?? `0 task state transitions observed across ${streak} consecutive ticks.`}`,
      `- **Action**: ${params.stagnationRemediation ?? "Dispatch workers via agent:register, audit task leases with task:heartbeat, or recover stale leases."}`,
      `- **Invariant**: CLOSING_FORBIDDEN_FOR_MIND (Resolve stagnation via continuous autonomous intervention).`,
    ];
    return lines.join("\n");
  }

  // 2. Mode A Autonomous Discovery
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

  // 3. Ready Task Dispatch Directive
  if (typeof params.readyTasksCount === "number" && params.readyTasksCount > 0 && params.activeRuns === 0) {
    return [
      "### ⚡ READY TASK DISPATCH REQUIRED",
      `- **Ready Queue**: ${params.readyTasksCount} tasks waiting in ready state.`,
      `- **Action**: Dispatch Tier 3 implementers via agent:register and claim tasks using task:claim.`,
    ].join("\n");
  }

  return "";
}

export interface MindPulseBriefParams {
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
  readonly telemetryBanner?: string | undefined;
  readonly diffSummary?: string | undefined;
  readonly isStagnating?: boolean | undefined;
  readonly stagnationStreak?: number | undefined;
  readonly stagnationReason?: string | undefined;
  readonly stagnationRemediation?: string | undefined;
  readonly activeRuns?: number | undefined;
  readonly pendingBacklog?: number | undefined;
  readonly readyTasksCount?: number | undefined;
}

export function formatMindPulseActiveBrief(params: MindPulseBriefParams): string {
  const limitStr = params.pulsesPerDay === null ? "∞" : params.pulsesPerDay;
  const lines: string[] = [
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

  if (params.telemetryBanner) {
    lines.push(`- **Telemetry Banner**: \`${params.telemetryBanner}\``);
  }

  if (params.cliReceiptSummaryBadge) {
    lines.push(`- **CLI Diagnostics Receipts**: ${params.cliReceiptSummaryBadge}`);
  }

  if (params.diffSummary) {
    lines.push(`- **Progress Delta**: ${params.diffSummary}`);
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
      isStagnating: params.isStagnating,
      stagnationStreak: params.stagnationStreak,
      stagnationReason: params.stagnationReason,
      stagnationRemediation: params.stagnationRemediation,
      readyTasksCount: params.readyTasksCount,
    });
    if (directive) lines.push(directive);
  }
  return enforceLineLimit(lines.join("\n"), 40);
}

export function formatMindPulseOpenedBrief(params: MindPulseBriefParams): string {
  const limitStr = params.pulsesPerDay === null ? "∞" : params.pulsesPerDay;
  const lines: string[] = [
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

  if (params.telemetryBanner) {
    lines.push(`- **Telemetry Banner**: \`${params.telemetryBanner}\``);
  }

  if (params.cliReceiptSummaryBadge) {
    lines.push(`- **CLI Diagnostics Receipts**: ${params.cliReceiptSummaryBadge}`);
  }

  if (params.diffSummary) {
    lines.push(`- **Progress Delta**: ${params.diffSummary}`);
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
      isStagnating: params.isStagnating,
      stagnationStreak: params.stagnationStreak,
      stagnationReason: params.stagnationReason,
      stagnationRemediation: params.stagnationRemediation,
      readyTasksCount: params.readyTasksCount,
    });
    if (directive) lines.push(directive);
  }
  return enforceLineLimit(lines.join("\n"), 40);
}

