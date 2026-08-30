import { HarnessError } from "../../core/errors/index.ts";
import { parseDuration } from "../../mind/memory/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { constructSupervisoryPersonaReminder } from "../../authority/supervisory/index.ts";
import {
  generateAsciiDagBadges,
  runScriptBackedDiagnostics,
  type ScriptBackedDiagnosticsResult,
} from "../../engine/scheduler/index.ts";
import { computeMindCognitiveTelemetry } from "./mind-pulse-metrics.ts";
import { CLOSING_FORBIDDEN_FOR_MIND, type MindPulseResult } from "./mind-pulse-state.ts";
import { formatMindPulseActiveBrief } from "./mind-pulse-formatter.ts";

export async function handleOpenPulseTelemetry(params: {
  readonly run: string;
  readonly actor: string;
  readonly host: string;
  readonly driver: string;
  readonly arm?: string | undefined;
  readonly nowMs: number;
  readonly state: Record<string, unknown>;
  readonly openPulse: Record<string, unknown>;
  readonly pulseState: Record<string, unknown>;
  readonly budgetRecord: Record<string, unknown>;
  readonly baseIntervalMs: number;
  readonly pulsesPerDay: number | null;
  readonly wallClockPerDay: number | null | undefined;
  readonly loadedRunRoot?: string | undefined;
}): Promise<MindPulseResult> {
  const openPulseId =
    typeof params.openPulse.pulse_id === "string" ? params.openPulse.pulse_id : "pulse-active";
  const openedAt =
    typeof params.openPulse.opened_at === "string"
      ? params.openPulse.opened_at
      : new Date(params.nowMs).toISOString();
  const deadlineAt =
    typeof params.openPulse.deadline_at === "string" ? params.openPulse.deadline_at : "unknown";
  const pulseActor =
    typeof params.openPulse.actor === "string" ? params.openPulse.actor : params.actor;
  const pulseHost = typeof params.openPulse.host === "string" ? params.openPulse.host : params.host;
  const pulseDriver =
    typeof params.openPulse.driver === "string" ? params.openPulse.driver : params.driver;

  const deadlineMs = Date.parse(deadlineAt);
  if (Number.isFinite(deadlineMs) && params.nowMs > deadlineMs) {
    throw new HarnessError(
      "INVALID_STATE",
      `pulse ${openPulseId} is open and past its deadline (${deadlineAt}); reclaim it first with mind:wake --run ${params.run}`,
    );
  }

  const scheduledIntervalMs = params.arm ? parseDuration(params.arm) : params.baseIntervalMs;
  const nextWakeAt = new Date(params.nowMs + scheduledIntervalMs).toISOString();
  const pulsesToday =
    typeof params.budgetRecord.pulses_today === "number" ? params.budgetRecord.pulses_today : 1;
  const wallClockToday =
    typeof params.budgetRecord.wall_clock_ms_today === "number"
      ? params.budgetRecord.wall_clock_ms_today
      : 0;

  const last = (params.pulseState.last ?? {}) as Record<string, unknown>;
  const zeroValueStreak = typeof last.zero_value_streak === "number" ? last.zero_value_streak : 0;

  const personaReminder = constructSupervisoryPersonaReminder({
    role: "mind",
    agentId: pulseActor,
    runId: params.run,
    pulseId: openPulseId,
    cadenceMs: scheduledIntervalMs,
    now: params.nowMs,
    context: {
      role: "mind",
      agentId: pulseActor,
      runId: params.run,
      pulseId: openPulseId,
      now: params.nowMs,
    },
  });

  const cognitiveTelemetry = computeMindCognitiveTelemetry(params.state);
  const repoRoot = findRepoRoot(params.loadedRunRoot ?? params.run);
  let diagResult: ScriptBackedDiagnosticsResult | undefined = undefined;
  try {
    diagResult = await runScriptBackedDiagnostics({
      runRoot: params.run,
      repoRoot,
      state: params.state,
      clock: { now: () => new Date(params.nowMs) },
    });
  } catch {}
  const dagBadges = generateAsciiDagBadges(params.state);

  const markdown = formatMindPulseActiveBrief({
    pulseId: openPulseId,
    runRoot: params.run,
    actor: pulseActor,
    host: pulseHost,
    driver: pulseDriver,
    openedAt,
    deadlineAt,
    scheduledIntervalMs,
    nextWakeAt,
    pulsesToday,
    pulsesPerDay: params.pulsesPerDay,
    personaReminder,
    workSpan: cognitiveTelemetry.workSpan,
    activeAgents: cognitiveTelemetry.activeAgents,
    waveLanes: cognitiveTelemetry.waveLanes,
    cliReceiptSummaryBadge: diagResult?.receiptSummaryBadge,
    dagBadges,
    activeRuns: cognitiveTelemetry.activeAgents?.length ?? 0,
    pendingBacklog:
      (Array.isArray(params.state.planning_buffer) ? params.state.planning_buffer.length : 0) +
      (typeof params.state.tasks === "object" && params.state.tasks
        ? Object.values(params.state.tasks).filter(
            (t) =>
              t && typeof t === "object" && (t as Record<string, unknown>).status === "proposed",
          ).length
        : 0),
  });

  return {
    markdown,
    run_root: params.run,
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
      pulses_per_day: params.pulsesPerDay,
      wall_clock_ms_today: wallClockToday,
      wall_clock_ms_per_day: params.wallClockPerDay,
    },
  };
}
