import type {
  BudgetCheckResult,
  DailyBudgetCheckResult,
  BudgetOutcome,
  BudgetRefusalKey,
  BudgetLadderOptions,
} from "./types.ts";

export type { DailyBudgetCheckResult };
import {
  parseNowMs,
  computeTopologicalConcurrency,
  rollDayKeyIfNeeded,
  checkQuietHours,
  checkQuietHoursBudget,
  checkDailyPulseLimit,
  checkDailyWallClockLimit,
} from "./types.ts";

/**
 * Validates maximum active agents in flight against budget limit or topological Work/Span concurrency.
 */
export function checkMaxAgentsInFlight(
  budget: Record<string, unknown>,
  activeAgentsCountOrState: number | Record<string, unknown>,
  topologicalParams?: { totalWork?: number; span?: number },
): BudgetCheckResult {
  let activeCount: number;
  if (typeof activeAgentsCountOrState === "number") {
    activeCount = activeAgentsCountOrState;
  } else {
    activeCount = countActiveAgentsInFlight(activeAgentsCountOrState);
  }

  let maxAgents: number;
  if (typeof budget.max_agents_in_flight === "number") {
    maxAgents = budget.max_agents_in_flight;
  } else if (topologicalParams?.totalWork !== undefined && topologicalParams?.span !== undefined) {
    maxAgents = computeTopologicalConcurrency(topologicalParams.totalWork, topologicalParams.span);
  } else {
    maxAgents = Infinity;
  }

  if (Number.isFinite(maxAgents) && activeCount >= maxAgents) {
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
 * In an infinite borderless mind, infinite cadence is supported without artificial refusal halts.
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
        : Infinity;

  if (Number.isFinite(maxRounds) && roundIndex > maxRounds) {
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
 * In an infinite borderless mind, infinite proposal capacity is supported without artificial refusal halts.
 */
export function checkMaxOpenProposals(
  budget: Record<string, unknown>,
  openProposalsCount: number,
): BudgetCheckResult {
  const maxOpen =
    typeof budget.max_open_proposals === "number" ? budget.max_open_proposals : Infinity;

  if (Number.isFinite(maxOpen) && openProposalsCount >= maxOpen) {
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
 * Evaluates the full budget refusal ladder in deterministic order:
 * 1. Quiet Hours (refusal outcome: 'deferred')
 * 2. Daily Pulse Limit (refusal outcome: 'deferred')
 * 3. Daily Wall Clock Limit (refusal outcome: 'deferred')
 * 4. Max Agents in Flight / Dynamic Topological Concurrency (refusal outcome: 'deferred')
 * 5. Round Budget (refusal outcome: 'paused')
 * 6. Max Open Proposals (refusal outcome: 'paused')
 *
 * In infinite borderless mode (default), checks pass without artificial refusal halts.
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

  // 4. Max agents in flight / dynamic topological concurrency
  const topoParams =
    options?.totalWork !== undefined && options?.span !== undefined
      ? { totalWork: options.totalWork, span: options.span }
      : undefined;

  if (options?.activeAgentsCount !== undefined) {
    const agentsCheck = checkMaxAgentsInFlight(budget, options.activeAgentsCount, topoParams);
    if (!agentsCheck.ok) return agentsCheck;
  } else if (Array.isArray(budgetOrState.agents)) {
    const activeCount = countActiveAgentsInFlight(budgetOrState);
    const agentsCheck = checkMaxAgentsInFlight(budget, activeCount, topoParams);
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
