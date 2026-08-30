import { checkDailyBudget, parseNowMs } from "../../mind/lifecycle/budget/index.ts";
import { DEFAULT_MIND_BUDGET } from "../../mind/lifecycle/charter/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";
import {
  assertMindNotHalted,
  assertPulseNotOpen,
  executeOpenPulseTransaction,
  resolveMindPulseGrant,
  verifyMindCharterSha,
} from "./mind-pulse-state.ts";
import { formatMindPulseOpenBrief } from "./mind-pulse-formatter.ts";

export interface MindPulseOpenResult {
  markdown: string;
  run_root: string;
  pulse_id: string;
  actor: string;
  host: string;
  driver: string;
  opened_at: string;
  deadline_at: string;
  budget: {
    pulses_today: number;
    pulses_per_day: number | null;
    wall_clock_ms_today: number;
    wall_clock_ms_per_day: number | null;
  };
}

export { formatMindPulseOpenBrief };

export function mindPulseOpenCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const run = textFlag(flags, "run", true)!;
  const actor = textFlag(flags, "actor", true)!;
  const host = textFlag(flags, "host", true)!;
  const driver = textFlag(flags, "driver", true)!;
  const now = textFlag(flags, "now", false);

  const nowMs = parseNowMs(now);
  const loaded = loadRun(run, false);
  const state = loaded.state;

  resolveMindPulseGrant(state, actor, host, nowMs, "to open a pulse");
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  assertMindNotHalted(mindState);

  const pulseState = (state.pulse ?? {}) as Record<string, unknown>;
  const openPulse = pulseState.open as Record<string, unknown> | null | undefined;
  assertPulseNotOpen(openPulse, nowMs, run);

  const actualRunRoot = loaded?.runRoot ?? run;
  const repoRoot = findRepoRoot(actualRunRoot);
  verifyMindCharterSha(repoRoot, mindState, loaded.manifest.prompt_sha256);

  const eventSequence = state.event_sequence ?? 0;
  if (eventSequence >= 100_000) {
    throw new HarnessError(
      "INVALID_STATE",
      `event headroom threshold reached (${eventSequence} >= 100000 events); pulse is halted. Outcome: halted.`,
    );
  }

  const budgetRecord = (state.budget ?? mindState.budget ?? {}) as Record<string, unknown>;
  const budgetCheck = checkDailyBudget(budgetRecord, nowMs);
  if (!budgetCheck.ok) {
    throw new HarnessError(
      "INVALID_STATE",
      `${budgetCheck.reason}. Outcome: ${budgetCheck.outcome}. Next: ${budgetCheck.repairArgv}`,
    );
  }

  const pulsesPerDay =
    typeof budgetRecord.pulses_per_day === "number"
      ? budgetRecord.pulses_per_day
      : DEFAULT_MIND_BUDGET.pulses_per_day;
  const wallClockPerDay =
    typeof budgetRecord.wall_clock_ms_per_day === "number"
      ? budgetRecord.wall_clock_ms_per_day
      : DEFAULT_MIND_BUDGET.wall_clock_ms_per_day;

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
    scheduledIntervalMs: pulseDeadlineMs,
    pulseDeadlineMs,
    state,
  });

  const markdown = formatMindPulseOpenBrief({
    pulseId,
    runRoot: run,
    actor,
    host,
    driver,
    openedAt: txnResult.openedAt,
    deadlineAt: txnResult.deadlineAt,
    pulsesToday: txnResult.updatedPulsesToday,
    pulsesPerDay,
  });

  return {
    markdown,
    run_root: run,
    pulse_id: pulseId,
    actor,
    host,
    driver,
    opened_at: txnResult.openedAt,
    deadline_at: txnResult.deadlineAt,
    budget: {
      pulses_today: txnResult.updatedPulsesToday,
      pulses_per_day: pulsesPerDay,
      wall_clock_ms_today: txnResult.updatedWallClockToday,
      wall_clock_ms_per_day: wallClockPerDay,
    },
  };
}
