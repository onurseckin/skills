import type { JsonObject } from "../../core/contracts/index.ts";
import { constructSupervisoryPersonaReminder } from "../../authority/supervisory/index.ts";
import {
  generateAsciiDagBadges,
  runScriptBackedDiagnostics,
  type ScriptBackedDiagnosticsResult,
} from "../../engine/scheduler/index.ts";
import { transact } from "../../engine/store/index.ts";
import { rollDayKeyIfNeeded } from "../../mind/lifecycle/budget/index.ts";
import { DEFAULT_MIND_BUDGET } from "../../mind/lifecycle/charter/index.ts";
import { writeLastPulse } from "../../mind/lifecycle/pulse/index.ts";
import { parseDuration } from "../../mind/memory/index.ts";
import { findGrant, readAgentLedger, writeAgentLedger } from "../../workflow/agents/ledger.ts";
import type { MilestoneEvidenceVerification } from "../../mind/evidence/index.ts";
import { formatMindPulseOpenedBrief } from "./mind-pulse-formatter.ts";
import { computeMindCognitiveTelemetry } from "./mind-pulse-metrics.ts";
import { CLOSING_FORBIDDEN_FOR_MIND, type MindPulseResult } from "./mind-pulse-state.ts";

export interface OpenPulseExecutionParams {
  readonly run: string;
  readonly actor: string;
  readonly host: string;
  readonly driver: string;
  readonly arm?: string | undefined;
  readonly nowMs: number;
  readonly state: Record<string, unknown>;
  readonly budgetRecord: Record<string, unknown>;
  readonly baseIntervalMs: number;
  readonly pulsesPerDay: number | null;
  readonly wallClockPerDay: number | null;
  readonly currentCounter: number;
  readonly repoRoot: string;
  readonly evidenceVerification: MilestoneEvidenceVerification;
}

export async function executeOpenPulseTransaction(
  params: OpenPulseExecutionParams,
): Promise<MindPulseResult> {
  const {
    run,
    actor,
    host,
    driver,
    arm,
    nowMs,
    state,
    budgetRecord,
    baseIntervalMs,
    pulsesPerDay,
    wallClockPerDay,
    currentCounter,
    repoRoot,
    evidenceVerification,
  } = params;

  const nextCounter = currentCounter + 1;
  const pulseId = `pulse-${nextCounter}`;
  const openedAt = new Date(nowMs).toISOString();
  const pulseDeadlineMs =
    typeof budgetRecord["pulse_deadline_ms"] === "number"
      ? (budgetRecord["pulse_deadline_ms"] as number)
      : DEFAULT_MIND_BUDGET.pulse_deadline_ms;
  const deadlineAt = new Date(nowMs + pulseDeadlineMs).toISOString();
  const scheduledIntervalMs = arm ? parseDuration(arm) : baseIntervalMs;
  const nextWakeAt = new Date(nowMs + scheduledIntervalMs).toISOString();

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
      evidence_certified: evidenceVerification.certified,
    },
    (working) => {
      const workingLedger = readAgentLedger(working);
      if (!findGrant(workingLedger, actor)) {
        writeAgentLedger(working, [
          ...workingLedger,
          {
            id: actor,
            role: "mind",
            parent_agent_id: null,
            parent_task_id: null,
            host,
            granted_at: openedAt,
            status: "active",
          },
        ]);
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
      evidenceVerification,
    },
  });

  const cognitiveTelemetry = computeMindCognitiveTelemetry(state);
  let diagResult: ScriptBackedDiagnosticsResult | undefined = undefined;
  try {
    diagResult = await runScriptBackedDiagnostics({
      runRoot: run,
      repoRoot,
      state: state as JsonObject,
      clock: { now: () => new Date(nowMs) },
    });
  } catch {}
  const dagBadges = generateAsciiDagBadges(state as JsonObject);

  const pendingBacklog =
    (Array.isArray(state.planning_buffer) ? state.planning_buffer.length : 0) +
    (typeof state.tasks === "object" && state.tasks
      ? Object.values(state.tasks as Record<string, unknown>).filter(
          (t) => t && typeof t === "object" && (t as Record<string, unknown>).status === "proposed",
        ).length
      : 0);

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
    evidence_verification: evidenceVerification,
    budget: {
      pulses_today: updatedPulsesToday,
      pulses_per_day: pulsesPerDay,
      wall_clock_ms_today: updatedWallClockToday,
      wall_clock_ms_per_day: wallClockPerDay,
    },
  };
}
