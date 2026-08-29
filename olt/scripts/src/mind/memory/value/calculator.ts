import { HarnessError } from "../../../core/errors/index.ts";
import {
  calculateThrottleInterval,
  type ThrottleIntervalOptions,
  type ThrottleIntervalResult,
} from "../../lifecycle/interval/index.ts";

export const PULSE_OUTCOMES = [
  "advance_dispatched",
  "advance_quiescent",
  "repair_resolved",
  "repair_quiescent",
  "rescue_healed",
  "rescue_quiescent",
  "discover_synthesized",
  "discover_quiescent",
  "quiescent",
  "halted",
  "unarmed",
] as const;

export type PulseOutcome = (typeof PULSE_OUTCOMES)[number];

export const TERMINAL_OUTCOMES = ["halted", "unarmed"] as const;
export type TerminalOutcome = (typeof TERMINAL_OUTCOMES)[number];

export function isPulseOutcome(outcome: string): outcome is PulseOutcome {
  return (PULSE_OUTCOMES as readonly string[]).includes(outcome);
}

export function isTerminalOutcome(outcome: string): outcome is TerminalOutcome {
  return (TERMINAL_OUTCOMES as readonly string[]).includes(outcome);
}

export function parseDuration(duration: number | string): number {
  if (typeof duration === "number") {
    if (duration < 0 || Number.isNaN(duration)) {
      throw new HarnessError("INVALID_ARGUMENT", "duration must be non-negative");
    }
    return duration;
  }
  if (typeof duration !== "string" || duration.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "duration string cannot be empty");
  }
  const match = duration.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/);
  if (!match) {
    throw new HarnessError("INVALID_ARGUMENT", `invalid duration format: ${duration}`);
  }
  const num = parseFloat(match[1]!);
  const unit = match[2] ?? "ms";
  switch (unit) {
    case "ms":
      return num;
    case "s":
      return num * 1000;
    case "m":
      return num * 60 * 1000;
    case "h":
      return num * 60 * 60 * 1000;
    case "d":
      return num * 24 * 60 * 60 * 1000;
    default:
      return num;
  }
}

export function calculateQuiescentBackoffInterval(
  baseIntervalMs: number,
  maxIntervalMs: number,
  consecutiveZeroStreak: number = 0,
): number {
  if (consecutiveZeroStreak <= 0) return baseIntervalMs;
  const backoff = baseIntervalMs * Math.pow(1.5, consecutiveZeroStreak);
  return Math.min(maxIntervalMs, Math.round(backoff));
}

export function calculateNextWakeInterval(
  options: ThrottleIntervalOptions,
): ThrottleIntervalResult {
  return calculateThrottleInterval(options);
}
