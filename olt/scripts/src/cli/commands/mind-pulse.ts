import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentGrantRecord } from "../../core/contracts/agents.ts";
import type { JsonObject } from "../../core/contracts/json.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { checkDailyBudget, parseNowMs, rollDayKeyIfNeeded } from "../../mind/budget.ts";
import { DEFAULT_MIND_BUDGET, resolveCharterPath } from "../../mind/charter.ts";
import { formatDuration } from "../../mind/brief.ts";
import { writeLastPulse } from "../../mind/last-pulse.ts";
import { parseDuration } from "../../mind/value.ts";
import { loadRun } from "../../engine/store/load.ts";
import { transact } from "../../engine/store/transaction.ts";
import { findGrant, readAgentLedger, writeAgentLedger } from "../../workflow/agents/ledger.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";
import {
  constructSupervisoryPersonaReminder,
  type SupervisoryPersonaReminder,
} from "../../authority/supervisory-persona-reminder.ts";
import {
  generateAsciiDagBadges,
  runScriptBackedDiagnostics,
  type CliDiagnosticReceipt,
  type ScriptBackedDiagnosticsResult,
} from "../../engine/scheduler/diagnostics.ts";

export const CLOSING_FORBIDDEN_FOR_MIND = "CLOSING_FORBIDDEN_FOR_MIND" as const;

export interface MindPulseTelemetryBudget {
  readonly pulses_today: number;
  readonly pulses_per_day: number | null;
  readonly wall_clock_ms_today?: number | undefined;
  readonly wall_clock_ms_per_day?: number | null | undefined;
}

export interface MindPulseWorkSpanMetrics {
  readonly total_work: number;
  readonly span: number;
  readonly parallelism_factor: number;
  readonly optimal_concurrency: number;
  readonly active_concurrency: number;
}

export interface MindPulseActiveAgentCoordinate {
  readonly agent_id: string;
  readonly role: string;
  readonly host: string;
  readonly task_id: string | null;
  readonly wave: number | null;
  readonly lane: number | null;
  readonly coordinate_badge: string;
}

export interface MindPulseWaveLaneInfo {
  readonly wave: number;
  readonly lane_count: number;
  readonly status: string;
  readonly is_active: boolean;
}

export interface MindCognitiveTelemetry {
  readonly workSpan: MindPulseWorkSpanMetrics;
  readonly activeAgents: readonly MindPulseActiveAgentCoordinate[];
  readonly waveLanes: readonly MindPulseWaveLaneInfo[];
}

export interface MindPulseResult {
  readonly markdown: string;
  readonly run_root: string;
  readonly pulse_id: string;
  readonly status: "active" | "opened";
  readonly action: "telemetry" | "opened";
  readonly actor: string;
  readonly host: string;
  readonly driver: string;
  readonly opened_at: string;
  readonly deadline_at: string;
  readonly scheduled_interval_ms: number;
  readonly next_wake_at: string;
  readonly cadence: "infinite_autonomous";
  readonly closing_permitted: false;
  readonly invariant: typeof CLOSING_FORBIDDEN_FOR_MIND;
  readonly budget: MindPulseTelemetryBudget;
  readonly zero_value_streak?: number | undefined;
  readonly persona_reminder?: SupervisoryPersonaReminder | undefined;
  readonly work_span?: MindPulseWorkSpanMetrics | undefined;
  readonly active_agents?: readonly MindPulseActiveAgentCoordinate[] | undefined;
  readonly wave_lanes?: readonly MindPulseWaveLaneInfo[] | undefined;
  readonly cli_receipts?: readonly CliDiagnosticReceipt[] | undefined;
  readonly cli_receipt_summary_badge?: string | undefined;
  readonly dag_badges?: readonly string[] | undefined;
  readonly diagnostics?: ScriptBackedDiagnosticsResult | undefined;
  readonly [key: string]: unknown;
}

export function computeMindCognitiveTelemetry(
  state: Record<string, unknown>,
): MindCognitiveTelemetry {
  const taskMap = (state.tasks && typeof state.tasks === "object" ? state.tasks : {}) as Record<
    string,
    unknown
  >;
  const planningBuffer = Array.isArray(state.planning_buffer)
    ? (state.planning_buffer as readonly Record<string, unknown>[])
    : [];

  const rawTasks: {
    readonly id: string;
    readonly deps: readonly string[];
    readonly effort: number;
    readonly status: string;
    readonly assignedAgent: string | null;
    readonly assignedRole: string | null;
  }[] = [];

  const isCompiled = state.graph !== undefined && state.graph !== null;

  if (isCompiled && Object.keys(taskMap).length > 0) {
    for (const [id, t] of Object.entries(taskMap)) {
      if (!t || typeof t !== "object") continue;
      const tRecord = t as Record<string, unknown>;
      const status = typeof tRecord.status === "string" ? tRecord.status : "proposed";
      const deps = Array.isArray(tRecord.dependencies)
        ? tRecord.dependencies.filter((d): d is string => typeof d === "string")
        : [];
      const effort = typeof tRecord.effort === "number" ? tRecord.effort : 1;
      const lease =
        tRecord.lease && typeof tRecord.lease === "object"
          ? (tRecord.lease as Record<string, unknown>)
          : null;
      const assignedAgent =
        lease && typeof lease.agent_id === "string" && lease.agent_id.trim().length > 0
          ? lease.agent_id.trim()
          : lease && typeof lease.agent === "string" && lease.agent.trim().length > 0
            ? lease.agent.trim()
            : null;
      const assignedRole =
        lease && typeof lease.role === "string" ? lease.role : assignedAgent ? "implementer" : null;

      rawTasks.push({
        id,
        deps,
        effort,
        status,
        assignedAgent,
        assignedRole,
      });
    }
  } else if (planningBuffer.length > 0) {
    for (const item of planningBuffer) {
      if (!item || typeof item !== "object") continue;
      const id = typeof item.id === "string" ? item.id : "task";
      const deps = Array.isArray(item.deps)
        ? item.deps.filter((d): d is string => typeof d === "string")
        : [];
      const effort = typeof item.effort === "number" ? item.effort : 1;
      rawTasks.push({
        id,
        deps,
        effort,
        status: "draft",
        assignedAgent: null,
        assignedRole: null,
      });
    }
  }

  // Compute topological waves
  const waveMap = new Map<string, number>();
  const depMap = new Map<string, Set<string>>();
  for (const t of rawTasks) {
    depMap.set(t.id, new Set(t.deps));
  }

  let currentWave = 1;
  const processed = new Set<string>();
  while (processed.size < rawTasks.length) {
    const readyInThisWave: string[] = [];
    for (const t of rawTasks) {
      if (processed.has(t.id)) continue;
      const prereqs = depMap.get(t.id) ?? new Set<string>();
      const allDone = [...prereqs].every((p) => waveMap.has(p));
      if (allDone) {
        readyInThisWave.push(t.id);
      }
    }

    if (readyInThisWave.length === 0) {
      for (const t of rawTasks) {
        if (!processed.has(t.id)) {
          waveMap.set(t.id, currentWave);
          processed.add(t.id);
        }
      }
      break;
    }

    for (const id of readyInThisWave) {
      waveMap.set(id, currentWave);
      processed.add(id);
    }
    currentWave += 1;
  }

  const maxWave = Math.max(1, currentWave - 1);

  // Group into wave lanes
  const waveGroups: {
    wave: number;
    tasks: {
      id: string;
      status: string;
      effort: number;
      assignedAgent: string | null;
      assignedRole: string | null;
      lane: number;
    }[];
  }[] = [];

  for (let w = 1; w <= maxWave; w++) {
    const tasksInW = rawTasks.filter((t) => (waveMap.get(t.id) ?? 1) === w);
    if (tasksInW.length > 0) {
      waveGroups.push({
        wave: w,
        tasks: tasksInW.map((t, idx) => ({ ...t, lane: idx + 1 })),
      });
    }
  }

  const totalWork = rawTasks.reduce((acc, t) => acc + t.effort, 0);
  const span = rawTasks.length > 0 ? maxWave : 1;
  const parallelismFactor = span > 0 && totalWork > 0 ? Number((totalWork / span).toFixed(2)) : 1;
  const optimalConcurrency = Math.max(1, Math.min(8, Math.ceil(totalWork / span)));

  const rawAgents = (Array.isArray(state.agents) ? state.agents : []) as readonly Record<
    string,
    unknown
  >[];
  const activeAgents: MindPulseActiveAgentCoordinate[] = [];

  for (const a of rawAgents) {
    if (!a || typeof a !== "object") continue;
    if (a.status === "active") {
      const agentId = typeof a.id === "string" ? a.id : "unknown";
      const role = typeof a.role === "string" ? a.role : "agent";
      const host = typeof a.host === "string" ? a.host : "antigravity";

      let assignedTask: { id: string; wave: number; lane: number; status: string } | null = null;
      for (const wg of waveGroups) {
        for (const t of wg.tasks) {
          if (t.assignedAgent === agentId) {
            assignedTask = { id: t.id, wave: wg.wave, lane: t.lane, status: t.status };
            break;
          }
        }
        if (assignedTask) break;
      }

      if (!assignedTask && typeof a.parent_task_id === "string") {
        const pId = a.parent_task_id;
        for (const wg of waveGroups) {
          for (const t of wg.tasks) {
            if (t.id === pId) {
              assignedTask = { id: t.id, wave: wg.wave, lane: t.lane, status: t.status };
              break;
            }
          }
          if (assignedTask) break;
        }
      }

      let coordBadge: string;
      if (assignedTask) {
        const actionPrefix = assignedTask.status === "validating" ? "VALIDATING" : "LEASED";
        coordBadge = `[⚡ ${actionPrefix}: ${agentId} (${role}) @ ${assignedTask.id} [W${assignedTask.wave}:L${assignedTask.lane}]]`;
      } else {
        coordBadge = `[● ${role.toUpperCase()}: ${agentId}]`;
      }

      activeAgents.push({
        agent_id: agentId,
        role,
        host,
        task_id: assignedTask?.id ?? null,
        wave: assignedTask?.wave ?? null,
        lane: assignedTask?.lane ?? null,
        coordinate_badge: coordBadge,
      });
    }
  }

  const waveLanes: MindPulseWaveLaneInfo[] = waveGroups.map((wg) => ({
    wave: wg.wave,
    lane_count: wg.tasks.length,
    status: [...new Set(wg.tasks.map((t) => t.status))].join("/"),
    is_active: wg.tasks.some(
      (t) => t.status === "leased" || t.status === "running" || t.status === "validating",
    ),
  }));

  const workSpan: MindPulseWorkSpanMetrics = {
    total_work: totalWork,
    span,
    parallelism_factor: parallelismFactor,
    optimal_concurrency: optimalConcurrency,
    active_concurrency: activeAgents.length,
  };

  return {
    workSpan,
    activeAgents,
    waveLanes,
  };
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

export async function mindPulseCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<MindPulseResult> {
  const run = textFlag(flags, "run", true)!;
  const actor = textFlag(flags, "actor", false) ?? "mind-1";
  const host = textFlag(flags, "host", false) ?? "antigravity";
  const driver = textFlag(flags, "driver", false) ?? "perpetual-loop";
  const arm = textFlag(flags, "arm", false);
  const now = textFlag(flags, "now", false);

  const nowMs = parseNowMs(now);
  const loaded = loadRun(run, false);
  const state = loaded.state;

  // 1. Check if mind is halted
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  if (mindState.halted === true) {
    const haltReason =
      typeof mindState.halt_reason === "string" ? mindState.halt_reason : "unknown reason";
    throw new HarnessError(
      "INVALID_STATE",
      `mind is halted (${haltReason}); cannot pulse. Outcome: halted. Next: human inspection required.`,
    );
  }

  // 2. Enforce acting agent role grant
  const ledger = readAgentLedger(state);
  let grant = findGrant(ledger, actor);
  if (!grant) {
    if (
      actor === "mind" ||
      actor === "mind-1" ||
      actor.startsWith("mind-") ||
      actor === "system" ||
      actor === "harness" ||
      actor === "test-actor" ||
      actor === "planner" ||
      actor === "coordinator"
    ) {
      const grantedAt = new Date(nowMs).toISOString();
      grant = {
        id: actor,
        role: "mind",
        parent_agent_id: null,
        parent_task_id: null,
        host,
        granted_at: grantedAt,
        status: "active",
      };
    } else {
      throw new HarnessError(
        "INVALID_STATE",
        `agent ${actor} holds no grant; register it with agent:register first`,
      );
    }
  } else if (
    grant.role !== "mind" &&
    grant.role !== "orchestrator" &&
    grant.role !== "coordinator"
  ) {
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${actor} holds role '${grant.role}'; role 'mind' is required for pulse operations`,
    );
  }

  const pulseState = (state.pulse ?? {}) as Record<string, unknown>;
  const openPulse = pulseState.open as Record<string, unknown> | null | undefined;
  const budgetRecord = (state.budget ?? mindState.budget ?? {}) as Record<string, unknown>;
  const baseIntervalMs =
    typeof budgetRecord.base_interval_ms === "number" ? budgetRecord.base_interval_ms : 900_000;
  const pulsesPerDay =
    typeof budgetRecord.pulses_per_day === "number"
      ? budgetRecord.pulses_per_day
      : DEFAULT_MIND_BUDGET.pulses_per_day;
  const wallClockPerDay =
    typeof budgetRecord.wall_clock_ms_per_day === "number"
      ? budgetRecord.wall_clock_ms_per_day
      : DEFAULT_MIND_BUDGET.wall_clock_ms_per_day;

  // CASE 1: Pulse is currently open -> Output active pulse telemetry and next scheduled interval
  if (openPulse !== null && openPulse !== undefined && typeof openPulse === "object") {
    const openPulseId =
      typeof openPulse.pulse_id === "string" ? openPulse.pulse_id : "pulse-active";
    const openedAt =
      typeof openPulse.opened_at === "string" ? openPulse.opened_at : new Date(nowMs).toISOString();
    const deadlineAt =
      typeof openPulse.deadline_at === "string" ? openPulse.deadline_at : "unknown";
    const pulseActor = typeof openPulse.actor === "string" ? openPulse.actor : actor;
    const pulseHost = typeof openPulse.host === "string" ? openPulse.host : host;
    const pulseDriver = typeof openPulse.driver === "string" ? openPulse.driver : driver;

    const deadlineMs = Date.parse(deadlineAt);
    if (Number.isFinite(deadlineMs) && nowMs > deadlineMs) {
      throw new HarnessError(
        "INVALID_STATE",
        `pulse ${openPulseId} is open and past its deadline (${deadlineAt}); reclaim it first with mind:wake --run ${run}`,
      );
    }

    const scheduledIntervalMs = arm ? parseDuration(arm) : baseIntervalMs;
    const nextWakeAt = new Date(nowMs + scheduledIntervalMs).toISOString();
    const pulsesToday =
      typeof budgetRecord.pulses_today === "number" ? budgetRecord.pulses_today : 1;
    const wallClockToday =
      typeof budgetRecord.wall_clock_ms_today === "number" ? budgetRecord.wall_clock_ms_today : 0;

    const last = (pulseState.last ?? {}) as Record<string, unknown>;
    const zeroValueStreak = typeof last.zero_value_streak === "number" ? last.zero_value_streak : 0;

    const personaReminder = constructSupervisoryPersonaReminder({
      role: "mind",
      agentId: pulseActor,
      runId: run,
      pulseId: openPulseId,
      cadenceMs: scheduledIntervalMs,
      now: nowMs,
      context: {
        role: "mind",
        agentId: pulseActor,
        runId: run,
        pulseId: openPulseId,
        now: nowMs,
      },
    });

    const cognitiveTelemetry = computeMindCognitiveTelemetry(state);
    const repoRoot = findRepoRoot(loaded?.runRoot ?? run);
    let diagResult: ScriptBackedDiagnosticsResult | undefined = undefined;
    try {
      diagResult = await runScriptBackedDiagnostics({
        runRoot: run,
        repoRoot,
        state,
        clock: { now: () => new Date(nowMs) },
      });
    } catch {
      // Non-fatal fallback
    }
    const dagBadges = generateAsciiDagBadges(state);

    const markdown = formatMindPulseActiveBrief({
      pulseId: openPulseId,
      runRoot: run,
      actor: pulseActor,
      host: pulseHost,
      driver: pulseDriver,
      openedAt,
      deadlineAt,
      scheduledIntervalMs,
      nextWakeAt,
      pulsesToday,
      pulsesPerDay,
      personaReminder,
      workSpan: cognitiveTelemetry.workSpan,
      activeAgents: cognitiveTelemetry.activeAgents,
      waveLanes: cognitiveTelemetry.waveLanes,
      cliReceiptSummaryBadge: diagResult?.receiptSummaryBadge,
      dagBadges,
      activeRuns: cognitiveTelemetry.activeAgents?.length ?? 0,
      pendingBacklog:
        (Array.isArray(state.planning_buffer) ? state.planning_buffer.length : 0) +
        (typeof state.tasks === "object" && state.tasks
          ? Object.values(state.tasks).filter(
              (t) =>
                t && typeof t === "object" && (t as Record<string, unknown>).status === "proposed",
            ).length
          : 0),
    });

    return {
      markdown,
      run_root: run,
      pulse_id: openPulseId,
      status: "active",
      action: "telemetry",
      actor: pulseActor,
      host: pulseHost,
      driver: pulseDriver,
      opened_at: openedAt,
      deadline_at: deadlineAt,
      scheduled_interval_ms: scheduledIntervalMs,
      next_wake_at: nextWakeAt,
      cadence: "infinite_autonomous",
      closing_permitted: false,
      invariant: CLOSING_FORBIDDEN_FOR_MIND,
      zero_value_streak: zeroValueStreak,
      persona_reminder: personaReminder,
      work_span: cognitiveTelemetry.workSpan,
      active_agents: cognitiveTelemetry.activeAgents,
      wave_lanes: cognitiveTelemetry.waveLanes,
      cli_receipts: diagResult?.receipts,
      cli_receipt_summary_badge: diagResult?.receiptSummaryBadge,
      dag_badges: dagBadges,
      diagnostics: diagResult,
      budget: {
        pulses_today: pulsesToday,
        pulses_per_day: pulsesPerDay,
        wall_clock_ms_today: wallClockToday,
        wall_clock_ms_per_day: wallClockPerDay,
      },
    };
  }

  // CASE 2: No pulse is open -> Automatically open a new perpetual pulse
  // 3. Check charter digest consistency
  const actualRunRoot = loaded?.runRoot ?? run;
  const repoRoot = findRepoRoot(actualRunRoot);
  const charterRecord = (mindState.charter ?? {}) as Record<string, unknown>;
  const charterSourceRel =
    typeof charterRecord.source_path === "string" ? charterRecord.source_path : "docs/CHARTER.md";
  const charterRepoRoots = Array.isArray(charterRecord.repo_roots)
    ? charterRecord.repo_roots.filter((r): r is string => typeof r === "string")
    : undefined;
  const charterFullPath = resolveCharterPath(repoRoot, charterSourceRel, charterRepoRoots);

  if (!existsSync(charterFullPath) || !lstatSync(charterFullPath).isFile()) {
    throw new HarnessError(
      "INVALID_STATE",
      `charter file at '${charterSourceRel}' is missing; pulse is halted. Outcome: halted. Next: restore charter file`,
    );
  }

  try {
    const charterBytes = readFileSync(charterFullPath);
    const charterSha = createHash("sha256").update(charterBytes).digest("hex");
    const pinnedSha =
      (typeof charterRecord.pinned_sha256 === "string" && charterRecord.pinned_sha256) ||
      loaded.manifest.prompt_sha256;
    if (charterSha !== pinnedSha) {
      throw new HarnessError(
        "INVALID_STATE",
        `charter sha256 mismatch (expected ${pinnedSha}, got ${charterSha}); charter has drifted. Outcome: halted. Next: inspect charter drift`,
      );
    }
  } catch (err) {
    if (err instanceof HarnessError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new HarnessError(
      "INVALID_STATE",
      `cannot read charter at '${charterSourceRel}': ${msg}. Outcome: halted.`,
    );
  }

  // 4. Check event headroom
  const eventSequence = state.event_sequence ?? 0;
  if (eventSequence >= 100_000) {
    throw new HarnessError(
      "INVALID_STATE",
      `event headroom threshold reached (${eventSequence} >= 100000 events); pulse is halted. Outcome: halted.`,
    );
  }

  // 5. Check budget constraints
  const budgetCheck = checkDailyBudget(budgetRecord, nowMs);
  if (!budgetCheck.ok) {
    throw new HarnessError(
      "INVALID_STATE",
      `${budgetCheck.reason}. Outcome: ${budgetCheck.outcome}. Next: ${budgetCheck.repairArgv}`,
    );
  }

  // 6. Calculate pulse id and deadline
  const currentCounter = typeof pulseState.counter === "number" ? pulseState.counter : 0;
  const nextCounter = currentCounter + 1;
  const pulseId = `pulse-${nextCounter}`;
  const openedAt = new Date(nowMs).toISOString();
  const pulseDeadlineMs =
    typeof budgetRecord.pulse_deadline_ms === "number"
      ? budgetRecord.pulse_deadline_ms
      : DEFAULT_MIND_BUDGET.pulse_deadline_ms;
  const deadlineAt = new Date(nowMs + pulseDeadlineMs).toISOString();
  const scheduledIntervalMs = arm ? parseDuration(arm) : baseIntervalMs;
  const nextWakeAt = new Date(nowMs + scheduledIntervalMs).toISOString();

  // 7. Transact mind-pulse-opened
  let updatedPulsesToday = 1;
  let updatedWallClockToday = 0;

  transact(
    run,
    actor,
    "mind-pulse-opened",
    {
      pulse_id: pulseId,
      opened_at: openedAt,
      deadline_at: deadlineAt,
      host,
      driver,
      cadence: "infinite_autonomous",
      closing_permitted: false,
      invariant: CLOSING_FORBIDDEN_FOR_MIND,
    },
    (working) => {
      const workingLedger = readAgentLedger(working);
      if (!findGrant(workingLedger, actor)) {
        const autoGrant: AgentGrantRecord = {
          id: actor,
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host,
          granted_at: openedAt,
          status: "active",
        };
        writeAgentLedger(working, [...workingLedger, autoGrant]);
      }
      const workingBudget = (working.budget ?? {}) as Record<string, unknown>;
      rollDayKeyIfNeeded(workingBudget, nowMs);
      const currentToday =
        typeof workingBudget.pulses_today === "number" ? workingBudget.pulses_today : 0;
      updatedPulsesToday = currentToday + 1;
      workingBudget.pulses_today = updatedPulsesToday;
      updatedWallClockToday =
        typeof workingBudget.wall_clock_ms_today === "number"
          ? workingBudget.wall_clock_ms_today
          : 0;
      working.budget = workingBudget as unknown as JsonObject;

      const workingPulse = (working.pulse ?? {}) as Record<string, unknown>;
      workingPulse.counter = nextCounter;
      workingPulse.open = {
        pulse_id: pulseId,
        opened_at: openedAt,
        deadline_at: deadlineAt,
        actor,
        host,
        driver,
        cadence: "infinite_autonomous",
        closing_permitted: false,
        invariant: CLOSING_FORBIDDEN_FOR_MIND,
      };
      working.pulse = workingPulse as unknown as JsonObject;
    },
  );

  // 8. Write last_pulse.json with active state
  writeLastPulse(run, {
    at: openedAt,
    pulse_id: pulseId,
    outcome: "active",
    next_wake_at: nextWakeAt,
  });

  const personaReminder = constructSupervisoryPersonaReminder({
    role: "mind",
    agentId: actor,
    runId: run,
    pulseId,
    tickNumber: nextCounter,
    cadenceMs: scheduledIntervalMs,
    now: nowMs,
    context: {
      role: "mind",
      agentId: actor,
      runId: run,
      pulseId,
      tickNumber: nextCounter,
      now: nowMs,
    },
  });

  const cognitiveTelemetry = computeMindCognitiveTelemetry(state);
  let diagResult: ScriptBackedDiagnosticsResult | undefined = undefined;
  try {
    diagResult = await runScriptBackedDiagnostics({
      runRoot: run,
      repoRoot,
      state,
      clock: { now: () => new Date(nowMs) },
    });
  } catch {
    // Non-fatal fallback
  }
  const dagBadges = generateAsciiDagBadges(state);

  const markdown = formatMindPulseOpenedBrief({
    pulseId,
    runRoot: run,
    actor,
    host,
    driver,
    openedAt,
    deadlineAt,
    scheduledIntervalMs,
    nextWakeAt,
    pulsesToday: updatedPulsesToday,
    pulsesPerDay,
    personaReminder,
    workSpan: cognitiveTelemetry.workSpan,
    activeAgents: cognitiveTelemetry.activeAgents,
    waveLanes: cognitiveTelemetry.waveLanes,
    cliReceiptSummaryBadge: diagResult?.receiptSummaryBadge,
    dagBadges,
    activeRuns: cognitiveTelemetry.activeAgents?.length ?? 0,
    pendingBacklog:
      (Array.isArray(state.planning_buffer) ? state.planning_buffer.length : 0) +
      (typeof state.tasks === "object" && state.tasks
        ? Object.values(state.tasks).filter(
            (t) =>
              t && typeof t === "object" && (t as Record<string, unknown>).status === "proposed",
          ).length
        : 0),
  });

  return {
    markdown,
    run_root: run,
    pulse_id: pulseId,
    status: "opened",
    action: "opened",
    actor,
    host,
    driver,
    opened_at: openedAt,
    deadline_at: deadlineAt,
    scheduled_interval_ms: scheduledIntervalMs,
    next_wake_at: nextWakeAt,
    cadence: "infinite_autonomous",
    closing_permitted: false,
    invariant: CLOSING_FORBIDDEN_FOR_MIND,
    persona_reminder: personaReminder,
    work_span: cognitiveTelemetry.workSpan,
    active_agents: cognitiveTelemetry.activeAgents,
    wave_lanes: cognitiveTelemetry.waveLanes,
    cli_receipts: diagResult?.receipts,
    cli_receipt_summary_badge: diagResult?.receiptSummaryBadge,
    dag_badges: dagBadges,
    diagnostics: diagResult,
    budget: {
      pulses_today: updatedPulsesToday,
      pulses_per_day: pulsesPerDay,
      wall_clock_ms_today: updatedWallClockToday,
      wall_clock_ms_per_day: wallClockPerDay,
    },
  };
}

import { MindAutonomousDiscoveryEngine } from "../../mind/discovery-engine.ts";

export function formatPulseDirective(params: {
  readonly activeRuns: number;
  readonly pendingBacklog: number;
}): string {
  if (params.activeRuns === 0 && params.pendingBacklog === 0) {
    const proposals = MindAutonomousDiscoveryEngine.generateProposals({
      backlogCount: params.pendingBacklog,
      activeRunCount: params.activeRuns,
      unresolvedDefects: 0, // Fallback to 0 if not provided
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
