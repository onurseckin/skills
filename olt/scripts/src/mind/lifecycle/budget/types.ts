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

export function computeTopologicalConcurrency(
  totalWork: number,
  span: number,
  minConcurrency: number = 5,
  maxConcurrency: number = 50,
): number {
  if (!Number.isFinite(totalWork) || totalWork <= 0) return minConcurrency;
  if (!Number.isFinite(span) || span <= 0) {
    return Math.min(maxConcurrency, Math.max(minConcurrency, Math.ceil(totalWork)));
  }
  const p = Math.ceil(totalWork / span);
  return Math.min(maxConcurrency, Math.max(minConcurrency, p));
}

export interface DayKeyOptions {
  readonly dryRun?: boolean | undefined;
  readonly timezone?: string | undefined;
}

export function getTimeInTimezone(
  nowMs: number,
  timeZone: string = "UTC",
): { hours: number; minutes: number } {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date(nowMs));
    let hours = 0;
    let minutes = 0;
    for (const part of parts) {
      if (part.type === "hour") {
        hours = parseInt(part.value, 10);
      } else if (part.type === "minute") {
        minutes = parseInt(part.value, 10);
      }
    }
    return { hours: hours === 24 ? 0 : hours, minutes };
  } catch {
    const date = new Date(nowMs);
    return { hours: date.getUTCHours(), minutes: date.getUTCMinutes() };
  }
}

export function computeDayKey(nowInput?: number | Date | string, timeZone: string = "UTC"): string {
  const nowMs = parseNowMs(nowInput);
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date(nowMs));
  } catch {
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}

export function getEffectiveDailyBudget(
  budget: Record<string, unknown>,
  nowInput?: number | Date | string,
  timezone?: string,
): { dayKey: string; pulsesToday: number; wallClockToday: number; rolled: boolean } {
  const tz = timezone ?? (typeof budget.timezone === "string" ? budget.timezone : "UTC");
  const todayKey = computeDayKey(nowInput, tz);
  const isDifferent = budget.day_key !== todayKey;
  return {
    dayKey: todayKey,
    pulsesToday: isDifferent
      ? 0
      : typeof budget.pulses_today === "number"
        ? budget.pulses_today
        : 0,
    wallClockToday: isDifferent
      ? 0
      : typeof budget.wall_clock_ms_today === "number"
        ? budget.wall_clock_ms_today
        : 0,
    rolled: isDifferent,
  };
}

export function rollDayKeyIfNeeded(
  budget: Record<string, unknown>,
  nowInput?: number | Date | string,
  options?: DayKeyOptions,
): RollDayKeyResult {
  const tz = options?.timezone ?? (typeof budget.timezone === "string" ? budget.timezone : "UTC");
  const effective = getEffectiveDailyBudget(budget, nowInput, tz);

  if (effective.rolled && !options?.dryRun) {
    budget.day_key = effective.dayKey;
    budget.pulses_today = 0;
    budget.wall_clock_ms_today = 0;
  }

  return { rolled: effective.rolled, dayKey: effective.dayKey };
}

export function checkQuietHours(
  quietHours: string | null | undefined,
  nowInput?: number | Date | string,
  timeZoneOverride?: string,
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
  const match = trimmed.match(
    /^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})(?:\s+([A-Za-z0-9_/+:-]+))?$/,
  );
  if (!match) {
    return { inQuietHours: false, quietHours: trimmed };
  }

  const startH = parseInt(match[1]!, 10);
  const startM = parseInt(match[2]!, 10);
  const endH = parseInt(match[3]!, 10);
  const endM = parseInt(match[4]!, 10);
  const detectedTz = match[5] ?? timeZoneOverride ?? "UTC";

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
  const { hours, minutes } = getTimeInTimezone(nowMs, detectedTz);
  const nowMinutes = hours * 60 + minutes;

  let inQuietHours: boolean;
  if (startMinutes <= endMinutes) {
    inQuietHours = nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  } else {
    inQuietHours = nowMinutes >= startMinutes || nowMinutes <= endMinutes;
  }

  return { inQuietHours, quietHours: trimmed };
}

export function checkQuietHoursBudget(
  budget: Record<string, unknown>,
  nowInput?: number | Date | string,
): BudgetCheckResult {
  const quiet = checkQuietHours(
    typeof budget.quiet_hours === "string" ? budget.quiet_hours : null,
    nowInput,
    typeof budget.timezone === "string" ? budget.timezone : undefined,
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

export function checkDailyPulseLimit(
  budget: Record<string, unknown>,
  nowInput?: number | Date | string,
): BudgetCheckResult {
  const tz = typeof budget.timezone === "string" ? budget.timezone : "UTC";
  const effective = getEffectiveDailyBudget(budget, nowInput, tz);
  const pulsesToday = effective.pulsesToday;
  const pulsesPerDay =
    typeof budget.pulses_per_day === "number"
      ? budget.pulses_per_day
      : typeof budget.daily_pulse_limit === "number"
        ? budget.daily_pulse_limit
        : Infinity;

  if (Number.isFinite(pulsesPerDay) && pulsesToday >= pulsesPerDay) {
    const tzSuffix = tz === "UTC" ? "next UTC day" : `next day (${tz})`;
    return {
      ok: false,
      key: "daily_pulse_limit",
      reason: `daily pulse budget exhausted (${pulsesToday}/${pulsesPerDay} pulses); pulse is deferred until ${tzSuffix}`,
      outcome: "deferred",
      repairArgv: "mind:wake",
      current: pulsesToday,
      limit: pulsesPerDay,
    };
  }

  return { ok: true };
}

export function checkDailyWallClockLimit(
  budget: Record<string, unknown>,
  nowInput?: number | Date | string,
): BudgetCheckResult {
  const tz = typeof budget.timezone === "string" ? budget.timezone : "UTC";
  const effective = getEffectiveDailyBudget(budget, nowInput, tz);
  const wallClockToday = effective.wallClockToday;
  const wallClockPerDay =
    typeof budget.wall_clock_ms_per_day === "number"
      ? budget.wall_clock_ms_per_day
      : typeof budget.daily_wall_clock_limit_ms === "number"
        ? budget.daily_wall_clock_limit_ms
        : Infinity;

  if (Number.isFinite(wallClockPerDay) && wallClockToday >= wallClockPerDay) {
    const tzSuffix = tz === "UTC" ? "next UTC day" : `next day (${tz})`;
    return {
      ok: false,
      key: "daily_wall_clock_limit_ms",
      reason: `daily wall clock budget exhausted (${wallClockToday}ms / ${wallClockPerDay}ms); pulse is deferred until ${tzSuffix}`,
      outcome: "deferred",
      repairArgv: "mind:wake",
      current: wallClockToday,
      limit: wallClockPerDay,
    };
  }

  return { ok: true };
}
