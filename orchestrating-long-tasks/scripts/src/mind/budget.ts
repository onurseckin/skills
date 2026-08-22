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
 * Hard refusal with outcome: 'deferred'.
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
        : 96;

  if (pulsesToday >= pulsesPerDay) {
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
 * Hard refusal with outcome: 'deferred'.
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
        : 21_600_000;

  if (wallClockToday >= wallClockPerDay) {
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

/**
 * Validates maximum active agents in flight against budget limit.
 * Hard refusal with outcome: 'deferred'.
 */
export function checkMaxAgentsInFlight(
  budget: Record<string, unknown>,
  activeAgentsCountOrState: number | Record<string, unknown>,
): BudgetCheckResult {
  let activeCount: number;
  if (typeof activeAgentsCountOrState === "number") {
    activeCount = activeAgentsCountOrState;
  } else {
    activeCount = countActiveAgentsInFlight(activeAgentsCountOrState);
  }

  const maxAgents =
    typeof budget.max_agents_in_flight === "number" ? budget.max_agents_in_flight : 8;

  if (activeCount >= maxAgents) {
    return {
      ok: false,
      key: "max_agents_in_flight",
      reason: `max agents in flight reached (${activeCount}/${maxAgents}); subagent dispatch is deferred until capacity frees`,
      outcome: "deferred",
      repairArgv: "agent:release",
      current: activeCount,
      limit: maxAgents,
    };
  }

  return { ok: true };
}

/**
 * Validates round budget against max rounds per objective.
 * Hard refusal with outcome: 'paused'.
 */
export function checkRoundBudget(
  budget: Record<string, unknown>,
  roundIndex: number,
  objectiveId?: string,
): BudgetCheckResult {
  const maxRounds =
    typeof budget.max_rounds_per_objective === "number"
      ? budget.max_rounds_per_objective
      : typeof budget.round_budget === "number"
        ? budget.round_budget
        : 3;

  if (roundIndex > maxRounds) {
    const objLabel = objectiveId ? ` for objective '${objectiveId}'` : "";
    return {
      ok: false,
      key: "round_budget",
      reason: `round budget spent${objLabel} (${roundIndex} > max ${maxRounds} rounds); round opening is paused`,
      outcome: "paused",
      repairArgv: "mind:wake",
      current: roundIndex,
      limit: maxRounds,
    };
  }

  return { ok: true };
}

/**
 * Validates open proposals count against max_open_proposals budget.
 * Hard refusal with outcome: 'paused'.
 */
export function checkMaxOpenProposals(
  budget: Record<string, unknown>,
  openProposalsCount: number,
): BudgetCheckResult {
  const maxOpen = typeof budget.max_open_proposals === "number" ? budget.max_open_proposals : 5;

  if (openProposalsCount >= maxOpen) {
    return {
      ok: false,
      key: "max_open_proposals",
      reason: `open proposal ceiling reached (${openProposalsCount}/${maxOpen}); proposal creation is paused`,
      outcome: "paused",
      repairArgv: "mind:wake",
      current: openProposalsCount,
      limit: maxOpen,
    };
  }

  return { ok: true };
}

/**
 * Counts active agents in flight from a state object.
 */
export function countActiveAgentsInFlight(state: Record<string, unknown>): number {
  const agents = (Array.isArray(state.agents) ? state.agents : []) as readonly Record<
    string,
    unknown
  >[];
  return agents.filter((a) => {
    const status = String(a.status ?? "");
    const role = String(a.role ?? "");
    return (
      status === "active" &&
      (role === "implementer" ||
        role === "validator" ||
        role === "orchestrator" ||
        role === "repairer" ||
        role === "mind-auditor")
    );
  }).length;
}

/**
 * Evaluates the full strict budget refusal ladder in deterministic order:
 * 1. Quiet Hours (refusal outcome: 'deferred')
 * 2. Daily Pulse Limit (refusal outcome: 'deferred')
 * 3. Daily Wall Clock Limit (refusal outcome: 'deferred')
 * 4. Max Agents in Flight (refusal outcome: 'deferred')
 * 5. Round Budget (refusal outcome: 'paused')
 * 6. Max Open Proposals (refusal outcome: 'paused')
 *
 * All budget checks return hard refusals (NEVER warnings), prescribing explicit outcomes.
 */
export function evaluateBudgetRefusalLadder(
  budgetOrState: Record<string, unknown>,
  options?: BudgetLadderOptions,
): BudgetCheckResult {
  const budget = (
    budgetOrState.budget && typeof budgetOrState.budget === "object"
      ? budgetOrState.budget
      : budgetOrState
  ) as Record<string, unknown>;

  // 1. Quiet hours
  const quietCheck = checkQuietHoursBudget(budget, options?.now);
  if (!quietCheck.ok) return quietCheck;

  // 2. Daily pulse limit
  const pulseCheck = checkDailyPulseLimit(budget, options?.now);
  if (!pulseCheck.ok) return pulseCheck;

  // 3. Daily wall clock limit
  const wallCheck = checkDailyWallClockLimit(budget, options?.now);
  if (!wallCheck.ok) return wallCheck;

  // 4. Max agents in flight
  if (options?.activeAgentsCount !== undefined) {
    const agentsCheck = checkMaxAgentsInFlight(budget, options.activeAgentsCount);
    if (!agentsCheck.ok) return agentsCheck;
  } else if (Array.isArray(budgetOrState.agents)) {
    const activeCount = countActiveAgentsInFlight(budgetOrState);
    const agentsCheck = checkMaxAgentsInFlight(budget, activeCount);
    if (!agentsCheck.ok) return agentsCheck;
  }

  // 5. Round budget
  if (options?.roundIndex !== undefined) {
    const roundCheck = checkRoundBudget(budget, options.roundIndex, options.objectiveId);
    if (!roundCheck.ok) return roundCheck;
  }

  // 6. Max open proposals
  if (options?.openProposalsCount !== undefined) {
    const proposalCheck = checkMaxOpenProposals(budget, options.openProposalsCount);
    if (!proposalCheck.ok) return proposalCheck;
  }

  return { ok: true };
}

/**
 * Validates budget headroom (quiet hours, daily pulses, wall clock time).
 * Rolls over day key before checking.
 */
export function checkDailyBudget(
  budget: Record<string, unknown>,
  nowInput?: number | Date | string,
): DailyBudgetCheckResult {
  rollDayKeyIfNeeded(budget, nowInput);

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
    };
  }

  const pulseResult = checkDailyPulseLimit(budget, nowInput);
  if (!pulseResult.ok) {
    return {
      ok: false,
      key: pulseResult.key,
      reason: pulseResult.reason,
      outcome: pulseResult.outcome,
      repairArgv: pulseResult.repairArgv,
    };
  }

  const wallResult = checkDailyWallClockLimit(budget, nowInput);
  if (!wallResult.ok) {
    return {
      ok: false,
      key: wallResult.key,
      reason: wallResult.reason,
      outcome: wallResult.outcome,
      repairArgv: wallResult.repairArgv,
    };
  }

  return { ok: true };
}
