export type {
  BudgetOutcome,
  BudgetRefusalKey,
  BudgetCheckPass,
  BudgetCheckRefusal,
  BudgetCheckResult,
  DailyBudgetCheckResult,
  QuietHoursCheckResult,
  RollDayKeyResult,
  BudgetLadderOptions,
} from "./types.ts";

export {
  parseNowMs,
  computeTopologicalConcurrency,
  rollDayKeyIfNeeded,
  checkQuietHours,
  checkQuietHoursBudget,
  checkDailyPulseLimit,
  checkDailyWallClockLimit,
} from "./types.ts";

export {
  checkMaxAgentsInFlight,
  checkRoundBudget,
  checkMaxOpenProposals,
  countActiveAgentsInFlight,
  evaluateBudgetRefusalLadder,
  checkDailyBudget,
} from "./calculator.ts";

import { parseCharter, DEFAULT_MIND_BUDGET } from "../charter/index.ts";
import type { MindBudget } from "../charter/index.ts";

export function readMindBudget(charterPath?: string): MindBudget {
  const parsed = parseCharter(charterPath ?? "");
  const overrides = parsed.budgets ?? {};
  return {
    ...DEFAULT_MIND_BUDGET,
    ...overrides,
    day_key: new Date().toISOString().slice(0, 10),
    pulses_today: 0,
    wall_clock_ms_today: 0,
  };
}

export function updateMindBudget(
  updater: (current: MindBudget) => MindBudget,
  charterPath?: string,
): MindBudget {
  const current = readMindBudget(charterPath);
  return updater(current);
}

export { computeNextInterval } from "../interval/index.ts";
