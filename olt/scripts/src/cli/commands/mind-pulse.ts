import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import type { AgentGrantRecord, JsonObject } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import {
  checkDailyBudget,
  parseNowMs,
  rollDayKeyIfNeeded,
} from "../../mind/lifecycle/budget/index.ts";
import { DEFAULT_MIND_BUDGET, resolveCharterPath } from "../../mind/lifecycle/charter/index.ts";
import { writeLastPulse } from "../../mind/lifecycle/pulse/index.ts";
import { parseDuration } from "../../mind/memory/index.ts";
import { loadRun, transact } from "../../engine/store/index.ts";
import { findGrant, readAgentLedger, writeAgentLedger } from "../../workflow/agents/ledger.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { resolveHostProviderLoose } from "../../core/config/host-canon.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";
import { constructSupervisoryPersonaReminder } from "../../authority/supervisory/index.ts";
import {
  generateAsciiDagBadges,
  runScriptBackedDiagnostics,
  type ScriptBackedDiagnosticsResult,
} from "../../engine/scheduler/index.ts";
import {
  computeMindCognitiveTelemetry,
  type MindCognitiveTelemetry,
  type MindPulseActiveAgentCoordinate,
  type MindPulseWaveLaneInfo,
  type MindPulseWorkSpanMetrics,
} from "./mind-pulse-metrics.ts";
import {
  CLOSING_FORBIDDEN_FOR_MIND,
  type MindPulseResult,
  type MindPulseTelemetryBudget,
} from "./mind-pulse-state.ts";
import {
  formatMindPulseActiveBrief,
  formatMindPulseOpenedBrief,
  formatPulseDirective,
} from "./mind-pulse-formatter.ts";
import { handleOpenPulseTelemetry } from "./mind-pulse-telemetry.ts";

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
  MindPulseResult,
  MindPulseTelemetryBudget,
  MindPulseWaveLaneInfo,
  MindPulseWorkSpanMetrics,
};

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
  if (mindState.halted === true) {
    const haltReason =
      typeof mindState.halt_reason === "string" ? mindState.halt_reason : "unknown reason";
    throw new HarnessError(
      "INVALID_STATE",
      `mind is halted (${haltReason}); cannot pulse. Outcome: halted. Next: human inspection required.`,
    );
  }

  const ledger = readAgentLedger(state);
  let grant = findGrant(ledger, actor);
  if (!grant) {
    const isAutoGrant =
      actor === "mind" ||
      actor === "mind-1" ||
      actor.startsWith("mind-") ||
      actor === "system" ||
      actor === "harness" ||
      actor === "test-actor" ||
      actor === "planner" ||
      actor === "coordinator";
    if (isAutoGrant) {
      grant = {
        id: actor,
        role: "mind",
        parent_agent_id: null,
        parent_task_id: null,
        host,
        granted_at: new Date(nowMs).toISOString(),
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

  if (openPulse !== null && openPulse !== undefined && typeof openPulse === "object") {
    return handleOpenPulseTelemetry({
      run,
      actor,
      host,
      driver,
      arm,
      nowMs,
      state,
      openPulse,
      pulseState,
      budgetRecord,
      baseIntervalMs,
      pulsesPerDay,
      wallClockPerDay,
      loadedRunRoot: loaded?.runRoot,
    });
  }

  const actualRunRoot = loaded?.runRoot ?? run;
  const repoRoot = findRepoRoot(actualRunRoot);
  const charterRecord = (mindState.charter ?? {}) as Record<string, unknown>;
  const charterSourceRel =
    typeof charterRecord.source_path === "string"
      ? charterRecord.source_path
      : "olt/agents/mind.yaml";
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
  const openedAt = new Date(nowMs).toISOString();
  const pulseDeadlineMs =
    typeof budgetRecord.pulse_deadline_ms === "number"
      ? budgetRecord.pulse_deadline_ms
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
  } catch {}
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
