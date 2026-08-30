import { HarnessError } from "../../core/errors/index.ts";
import { checkDailyBudget, parseNowMs } from "../../mind/lifecycle/budget/index.ts";
import { DEFAULT_MIND_BUDGET } from "../../mind/lifecycle/charter/index.ts";
import { parseDuration } from "../../mind/memory/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { resolveHostProviderLoose } from "../../core/config/host-canon.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";
import {
  constructSupervisoryPersonaReminder,
  type SupervisoryPersonaReminder,
} from "../../authority/supervisory/index.ts";
import {
  generateAsciiDagBadges,
  runScriptBackedDiagnostics,
  type CliDiagnosticReceipt,
  type ScriptBackedDiagnosticsResult,
} from "../../engine/scheduler/index.ts";
import {
  computeMindCognitiveTelemetry,
  type MindCognitiveTelemetry,
  type MindPulseActiveAgentCoordinate,
  type MindPulseTelemetryBudget,
  type MindPulseWaveLaneInfo,
  type MindPulseWorkSpanMetrics,
} from "./mind-pulse-metrics.ts";
import {
  formatMindPulseActiveBrief,
  formatMindPulseOpenedBrief,
  formatPulseDirective,
} from "./mind-pulse-formatter.ts";
import {
  CLOSING_FORBIDDEN_FOR_MIND,
  assertMindNotHalted,
  executeOpenPulseTransaction,
  resolveMindPulseGrant,
  verifyMindCharterSha,
} from "./mind-pulse-state.ts";

export {
  CLOSING_FORBIDDEN_FOR_MIND,
  computeMindCognitiveTelemetry,
  formatMindPulseActiveBrief,
  formatMindPulseOpenedBrief,
  formatPulseDirective,
};

export type {
  MindCognitiveTelemetry,
  MindPulseActiveAgentCoordinate,
  MindPulseTelemetryBudget,
  MindPulseWaveLaneInfo,
  MindPulseWorkSpanMetrics,
};

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

export async function mindPulseCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<MindPulseResult> {
  const run = textFlag(flags, "run", true)!;
  const actor = textFlag(flags, "actor", false) ?? "mind-1";
  const host = resolveHostProviderLoose(textFlag(flags, "host", false));
  const driver = textFlag(flags, "driver", false) ?? "perpetual-loop";
  const arm = textFlag(flags, "arm", false);
  const now = textFlag(flags, "now", false);

  const nowMs = parseNowMs(now);
  const loaded = loadRun(run, false);
  const state = loaded.state;

  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  assertMindNotHalted(mindState);
  resolveMindPulseGrant(state, actor, host, nowMs);

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
  const scheduledIntervalMs = arm ? parseDuration(arm) : baseIntervalMs;
  const repoRoot = findRepoRoot(loaded?.runRoot ?? run);

  let diagResult: ScriptBackedDiagnosticsResult | undefined;
  try {
    diagResult = await runScriptBackedDiagnostics({
      runRoot: run,
      repoRoot,
      state,
      clock: { now: () => new Date(nowMs) },
    });
  } catch {}
  const dagBadges = generateAsciiDagBadges(state);
  const cognitiveTelemetry = computeMindCognitiveTelemetry(state);
  const pendingBacklog =
    (Array.isArray(state.planning_buffer) ? state.planning_buffer.length : 0) +
    (typeof state.tasks === "object" && state.tasks
      ? Object.values(state.tasks).filter(
          (t) => t && typeof t === "object" && (t as Record<string, unknown>).status === "proposed",
        ).length
      : 0);

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
      context: { role: "mind", agentId: pulseActor, runId: run, pulseId: openPulseId, now: nowMs },
    });

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
      pendingBacklog,
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

  verifyMindCharterSha(repoRoot, mindState, loaded.manifest.prompt_sha256);
  const eventSequence = state.event_sequence ?? 0;
  if (eventSequence >= 100_000) {
    throw new HarnessError(
      "INVALID_STATE",
      `event headroom threshold reached (${eventSequence} >= 100000 events); pulse is halted. Outcome: halted.`,
    );
  }

  const budgetCheck = checkDailyBudget(budgetRecord, nowMs);
  if (!budgetCheck.ok) {
    throw new HarnessError(
      "INVALID_STATE",
      `${budgetCheck.reason}. Outcome: ${budgetCheck.outcome}. Next: ${budgetCheck.repairArgv}`,
    );
  }

  const currentCounter = typeof pulseState.counter === "number" ? pulseState.counter : 0;
  const nextCounter = currentCounter + 1;
  const pulseId = `pulse-${nextCounter}`;
  const pulseDeadlineMs =
    typeof budgetRecord.pulse_deadline_ms === "number"
      ? budgetRecord.pulse_deadline_ms
      : DEFAULT_MIND_BUDGET.pulse_deadline_ms;

  const txnResult = executeOpenPulseTransaction({
    run,
    actor,
    host,
    driver,
    nowMs,
    nextCounter,
    pulseId,
    scheduledIntervalMs,
    pulseDeadlineMs,
    state,
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

  const markdown = formatMindPulseOpenedBrief({
    pulseId,
    runRoot: run,
    actor,
    host,
    driver,
    openedAt: txnResult.openedAt,
    deadlineAt: txnResult.deadlineAt,
    scheduledIntervalMs,
    nextWakeAt: txnResult.nextWakeAt,
    pulsesToday: txnResult.updatedPulsesToday,
    pulsesPerDay,
    personaReminder,
    workSpan: cognitiveTelemetry.workSpan,
    activeAgents: cognitiveTelemetry.activeAgents,
    waveLanes: cognitiveTelemetry.waveLanes,
    cliReceiptSummaryBadge: diagResult?.receiptSummaryBadge,
    dagBadges,
    activeRuns: cognitiveTelemetry.activeAgents?.length ?? 0,
    pendingBacklog,
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
    opened_at: txnResult.openedAt,
    deadline_at: txnResult.deadlineAt,
    scheduled_interval_ms: scheduledIntervalMs,
    next_wake_at: txnResult.nextWakeAt,
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
      pulses_today: txnResult.updatedPulsesToday,
      pulses_per_day: pulsesPerDay,
      wall_clock_ms_today: txnResult.updatedWallClockToday,
      wall_clock_ms_per_day: wallClockPerDay,
    },
  };
}
