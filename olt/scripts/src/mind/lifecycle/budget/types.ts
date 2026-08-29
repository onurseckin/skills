export type BudgetOutcome = "deferred" | "paused" | "halted";

export type BudgetRefusalKey =
  | "quiet_hours"
  | "daily_pulse_limit"
  | "daily_wall_clock_limit_ms"
  | "max_agents_in_flight"
  | "round_budget"
  | "max_open_proposals";

export interface BudgetCheckPass {
  readonly ok: true;
}

export interface BudgetCheckRefusal {
  readonly ok: false;
  readonly key: BudgetRefusalKey;
  readonly reason: string;
  readonly outcome: BudgetOutcome;
  readonly repairArgv?: string | undefined;
  readonly current?: number | string | null | undefined;
  readonly limit?: number | string | null | undefined;
}

export type BudgetCheckResult = BudgetCheckPass | BudgetCheckRefusal;

export interface DailyBudgetCheckResult {
  readonly ok: boolean;
  readonly reason?: string | undefined;
  readonly outcome?: "deferred" | "halted" | "paused" | undefined;
  readonly repairArgv?: string | undefined;
  readonly key?: BudgetRefusalKey | undefined;
}

export interface QuietHoursCheckResult {
  readonly inQuietHours: boolean;
  readonly quietHours: string | null;
}

export interface RollDayKeyResult {
  readonly rolled: boolean;
  readonly dayKey: string;
}

export interface BudgetLadderOptions {
  readonly now?: number | Date | string | undefined;
  readonly activeAgentsCount?: number | undefined;
  readonly roundIndex?: number | undefined;
  readonly objectiveId?: string | undefined;
  readonly openProposalsCount?: number | undefined;
  readonly totalWork?: number | undefined;
  readonly span?: number | undefined;
}

export function parseNowMs(nowInput?: number | Date | string): number {
  if (typeof nowInput === "number") return nowInput;
  if (nowInput instanceof Date) return nowInput.getTime();
  if (typeof nowInput === "string") {
    const parsed = Date.parse(nowInput);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

/**
 * Computes dynamic topological concurrency governed by Work/Span math:
 * P = W / S (where W = total work, S = critical path span).
 * In an infinite borderless mind, concurrency scales dynamically with topological parallelism.
 */
export function computeTopologicalConcurrency(
  totalWork: number,
  span: number,
  minConcurrency: number = 1,
): number {
  if (!Number.isFinite(totalWork) || totalWork <= 0) return minConcurrency;
  if (!Number.isFinite(span) || span <= 0) return Math.max(minConcurrency, Math.ceil(totalWork));
  const p = Math.ceil(totalWork / span);
  return Math.max(minConcurrency, p);
}

/**
 * Rolls the budget day_key when it differs from current UTC day,
 * resetting pulses_today and wall_clock_ms_today.
 */
export function rollDayKeyIfNeeded(
  budget: Record<string, unknown>,
  nowInput?: number | Date | string,
): RollDayKeyResult {
  const nowMs = parseNowMs(nowInput);
  const todayKey = new Date(nowMs).toISOString().slice(0, 10);

  if (budget.day_key !== todayKey) {
    budget.day_key = todayKey;
    budget.pulses_today = 0;
    budget.wall_clock_ms_today = 0;
    return { rolled: true, dayKey: todayKey };
  }

  return { rolled: false, dayKey: todayKey };
}

/**
 * Checks whether the given time falls within configured quiet hours.
 * Expected format: "HH:MM-HH:MM" (e.g. "23:00-05:00" or "01:00-06:00" in UTC).
 */
export function checkQuietHours(
  quietHours: string | null | undefined,
  nowInput?: number | Date | string,
): QuietHoursCheckResult {
  if (
    quietHours === null ||
    quietHours === undefined ||
    quietHours === "null" ||
    quietHours === "none" ||
    quietHours.trim() === ""
  ) {
    return { inQuietHours: false, quietHours: null };
  }

  const trimmed = quietHours.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/);
  if (!match) {
    return { inQuietHours: false, quietHours: trimmed };
  }

  const startH = parseInt(match[1]!, 10);
  const startM = parseInt(match[2]!, 10);
  const endH = parseInt(match[3]!, 10);
  const endM = parseInt(match[4]!, 10);

  if (
    startH < 0 ||
    startH > 23 ||
    startM < 0 ||
    startM > 59 ||
    endH < 0 ||
    endH > 23 ||
    endM < 0 ||
    endM > 59
  ) {
    return { inQuietHours: false, quietHours: trimmed };
  }

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  const nowMs = parseNowMs(nowInput);
  const date = new Date(nowMs);
  const nowMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();

  let inQuietHours: boolean;
  if (startMinutes <= endMinutes) {
    inQuietHours = nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  } else {
    // Spans across midnight, e.g. 23:00 to 05:00
    inQuietHours = nowMinutes >= startMinutes || nowMinutes <= endMinutes;
  }

  return { inQuietHours, quietHours: trimmed };
}

/**
 * Validates quiet hours constraint in budget.
 * Hard refusal with outcome: 'deferred'.
 */
export function checkQuietHoursBudget(
  budget: Record<string, unknown>,
  nowInput?: number | Date | string,
): BudgetCheckResult {
  const quiet = checkQuietHours(
    typeof budget.quiet_hours === "string" ? budget.quiet_hours : null,
    nowInput,
  );
  if (quiet.inQuietHours) {
    return {
      ok: false,
      key: "quiet_hours",
      reason: `current time is inside quiet hours (${quiet.quietHours}); pulse is deferred`,
      outcome: "deferred",
      repairArgv: "mind:wake",
      current: quiet.quietHours,
      limit: quiet.quietHours,
    };
  }
  return { ok: true };
}

/**
 * Validates daily pulse limit against budget.
 * In an infinite borderless mind, infinite cadence is supported without artificial refusal halts.
 */
export function checkDailyPulseLimit(
  budget: Record<string, unknown>,
  nowInput?: number | Date | string,
): BudgetCheckResult {
  rollDayKeyIfNeeded(budget, nowInput);

  const pulsesToday = typeof budget.pulses_today === "number" ? budget.pulses_today : 0;
  const pulsesPerDay =
    typeof budget.pulses_per_day === "number"
      ? budget.pulses_per_day
      : typeof budget.daily_pulse_limit === "number"
        ? budget.daily_pulse_limit
        : Infinity;

  if (Number.isFinite(pulsesPerDay) && pulsesToday >= pulsesPerDay) {
    return {
      ok: false,
      key: "daily_pulse_limit",
      reason: `daily pulse budget exhausted (${pulsesToday}/${pulsesPerDay} pulses); pulse is deferred until next UTC day`,
      outcome: "deferred",
      repairArgv: "mind:wake",
      current: pulsesToday,
      limit: pulsesPerDay,
    };
  }

  return { ok: true };
}

/**
 * Validates daily wall clock limit against budget.
 * In an infinite borderless mind, infinite cadence is supported without artificial refusal halts.
 */
export function checkDailyWallClockLimit(
  budget: Record<string, unknown>,
  nowInput?: number | Date | string,
): BudgetCheckResult {
  rollDayKeyIfNeeded(budget, nowInput);

  const wallClockToday =
    typeof budget.wall_clock_ms_today === "number" ? budget.wall_clock_ms_today : 0;
  const wallClockPerDay =
    typeof budget.wall_clock_ms_per_day === "number"
      ? budget.wall_clock_ms_per_day
      : typeof budget.daily_wall_clock_limit_ms === "number"
        ? budget.daily_wall_clock_limit_ms
        : Infinity;

  if (Number.isFinite(wallClockPerDay) && wallClockToday >= wallClockPerDay) {
    return {
      ok: false,
      key: "daily_wall_clock_limit_ms",
      reason: `daily wall clock budget exhausted (${wallClockToday}ms / ${wallClockPerDay}ms); pulse is deferred until next UTC day`,
      outcome: "deferred",
      repairArgv: "mind:wake",
      current: wallClockToday,
      limit: wallClockPerDay,
    };
  }

  return { ok: true };
}
