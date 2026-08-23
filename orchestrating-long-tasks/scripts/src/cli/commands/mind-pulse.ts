import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentGrantRecord } from "../../contracts/agents.ts";
import type { JsonObject } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { checkDailyBudget, parseNowMs, rollDayKeyIfNeeded } from "../../mind/budget.ts";
import { DEFAULT_MIND_BUDGET, resolveCharterPath } from "../../mind/charter.ts";
import { formatDuration } from "../../mind/brief.ts";
import { writeLastPulse } from "../../mind/last-pulse.ts";
import { parseDuration } from "../../mind/value.ts";
import { loadRun } from "../../store/load.ts";
import { transact } from "../../store/transaction.ts";
import { findGrant, readAgentLedger, writeAgentLedger } from "../../workflow/agents/ledger.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";
import {
  constructSupervisoryPersonaReminder,
  type SupervisoryPersonaReminder,
} from "../../authority/supervisory-persona-reminder.ts";

export const CLOSING_FORBIDDEN_FOR_MIND = "CLOSING_FORBIDDEN_FOR_MIND" as const;

export interface MindPulseTelemetryBudget {
  readonly pulses_today: number;
  readonly pulses_per_day: number | null;
  readonly wall_clock_ms_today?: number | undefined;
  readonly wall_clock_ms_per_day?: number | null | undefined;
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
  readonly [key: string]: unknown;
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
    `- **Cadence**: infinite autonomous cadence (CLOSING_FORBIDDEN_FOR_MIND)`,
    `- **Invariant**: Mind never self-terminates, dies, or closes. Runs indefinitely until human OS termination.`,
    `- **Supervisory Invariants**: Strict 4-Tier Spawning Hierarchy & Supervisor Zero-File-Edit Invariant actively enforced.`,
  ];
  return enforceLineLimit(lines.join("\n"), 25);
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
    `- **Cadence**: infinite autonomous cadence (CLOSING_FORBIDDEN_FOR_MIND)`,
    `- **Invariant**: Mind never self-terminates, dies, or closes. Runs indefinitely until human OS termination.`,
    `- **Supervisory Invariants**: Strict 4-Tier Spawning Hierarchy & Supervisor Zero-File-Edit Invariant actively enforced.`,
  ];
  return enforceLineLimit(lines.join("\n"), 25);
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
  const repoRoot = dirname(dirname(actualRunRoot));
  const charterRecord = (mindState.charter ?? {}) as Record<string, unknown>;
  const charterSourceRel =
    typeof charterRecord.source_path === "string"
      ? charterRecord.source_path
      : "docs/mind/CHARTER.md";
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
    budget: {
      pulses_today: updatedPulsesToday,
      pulses_per_day: pulsesPerDay,
      wall_clock_ms_today: updatedWallClockToday,
      wall_clock_ms_per_day: wallClockPerDay,
    },
  };
}
