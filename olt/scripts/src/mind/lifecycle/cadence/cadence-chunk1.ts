/**
 * Perpetual Autonomic Mind Cadence & Anti-Idle Immediate Rollover Engine.
 *
 * Implements the infinite autonomous cadence invariants:
 * - PERPETUAL_NON_STOPPING_CADENCE: Mind loops never terminate when idle.
 * - CLOSING_FORBIDDEN_FOR_MIND: Mind runs cannot self-close or terminate.
 * - Anti-Idle Immediate Rollover: Active work / pending tasks / feedback trigger 0ms instant rollover.
 * - Zero artificial sleep loops: transitions between phases are strictly non-blocking.
 * - Deterministic trigger dispatching and dynamic backoff coordination.
 */

import { HarnessError } from "../../../core/errors/index.ts";

import {
  applyIntervalJitter,
  calculateExponentialBackoff,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  DEFAULT_MAX_PAUSE_INTERVAL_MS,
  type JitterOptions,
} from "../../interval.ts";


export const PERPETUAL_NON_STOPPING_CADENCE = "infinite_autonomous" as const;

export const CLOSING_FORBIDDEN_FOR_MIND = "CLOSING_FORBIDDEN_FOR_MIND" as const;

export const ZERO_SLEEP_DELAY_MS = 0 as const;

export const DEFAULT_CADENCE_BASE_INTERVAL_MS = 900_000;
 // 15 minutes
export const DEFAULT_CADENCE_MAX_INTERVAL_MS = 14_400_000;
 // 4 hours
export const DEFAULT_CADENCE_GRACE_MS = 300_000;
 // 5 minutes

export type CadencePhase =
  | "IDLE"
  | "POLLING"
  | "ACTIVE"
  | "SYNTHESIZING"
  | "EXECUTING"
  | "ROLLOVER"
  | "RESTING"
  | "HALTED";


export type CadenceTriggerType =
  | "WORK_AVAILABLE"
  | "FEEDBACK_RECEIVED"
  | "PULSE_COMPLETED"
  | "IMMEDIATE_ROLLOVER"
  | "TIMER_EXPIRED"
  | "MANUAL_DISPATCH"
  | "STALE_PULSE_DETECTED"
  | "RATE_LIMIT_BACKOFF"
  | "SAFETY_HALT";


export type TriggerPriority = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";


export interface CadenceTrigger {
  readonly type: CadenceTriggerType;
  readonly source: string;
  readonly timestamp: string;
  readonly payload?: Readonly<Record<string, unknown>> | undefined;
  readonly priority?: TriggerPriority | undefined;
}


export interface RolloverDecision {
  readonly shouldRolloverImmediately: boolean;
  readonly targetDelayMs: number; // 0 for immediate rollover, > 0 for resting, -1 if halted
  readonly targetPhase: CadencePhase;
  readonly reason: string;
  readonly trigger: CadenceTrigger;
  readonly zeroValueStreak: number;
  readonly hasPendingWork: boolean;
  readonly pendingTaskCount: number;
  readonly pendingFeedbackCount: number;
}


export interface CadenceState {
  readonly status: "RUNNING" | "PAUSED" | "HALTED";
  readonly currentPhase: CadencePhase;
  readonly generation: number;
  readonly pulseCounter: number;
  readonly rolloverCounter: number;
  readonly immediateRolloverCounter: number;
  readonly zeroValueStreak: number;
  readonly lastPulseAt: string | null;
  readonly lastRolloverAt: string | null;
  readonly currentIntervalMs: number;
  readonly nextWakeAt: string;
  readonly infiniteCadenceEnforced: true;
  readonly closing_permitted: false;
  readonly invariant: typeof CLOSING_FORBIDDEN_FOR_MIND;
}


export interface CadenceTelemetry {
  readonly totalPulses: number;
  readonly totalRollovers: number;
  readonly totalImmediateRollovers: number;
  readonly immediateRolloverRatio: number;
  readonly totalZeroSleepTransitions: number;
  readonly averagePulseDurationMs: number;
  readonly quiescenceStreak: number;
  readonly lastTriggerType: CadenceTriggerType | null;
  readonly isAntiIdleActive: boolean;
}


export interface CadenceEvent {
  readonly type:
    | "PHASE_CHANGE"
    | "TRIGGER_DISPATCHED"
    | "ROLLOVER_EXECUTED"
    | "PULSE_TICK"
    | "STATE_TRANSITION";
  readonly previousPhase?: CadencePhase | undefined;
  readonly currentPhase: CadencePhase;
  readonly trigger?: CadenceTrigger | undefined;
  readonly decision?: RolloverDecision | undefined;
  readonly state: CadenceState;
  readonly timestamp: string;
}


export type CadenceEventListener = (event: CadenceEvent) => void | Promise<void>;


export interface RolloverEvaluationOptions {
  readonly trigger: CadenceTrigger;
  readonly pendingTasks?: number | undefined;
  readonly pendingFeedback?: number | undefined;
  readonly zeroValueStreak?: number | undefined;
  readonly baseIntervalMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
  readonly maxPauseIntervalMs?: number | undefined;
  readonly previousIntervalMs?: number | undefined;
  readonly isHalted?: boolean | undefined;
  readonly isRateLimited?: boolean | undefined;
  readonly applyJitter?: boolean | undefined;
  readonly random?: (() => number) | undefined;
  readonly now?: string | number | Date | undefined;
}


export interface CadenceStepInput {
  readonly trigger?: CadenceTrigger | undefined;
  readonly pendingTasks?: number | undefined;
  readonly pendingFeedback?: number | undefined;
  readonly pulseOutcome?: string | undefined;
  readonly pulseValue?: number | undefined;
  readonly pulseDurationMs?: number | undefined;
  readonly now?: string | number | Date | undefined;
}


export interface CadenceStepResult {
  readonly decision: RolloverDecision;
  readonly previousState: CadenceState;
  readonly newState: CadenceState;
  readonly executedImmediately: boolean;
  readonly delayMs: number;
  readonly durationMs: number;
  readonly timestamp: string;
}


/**
 * Creates a structured CadenceTrigger with default source and ISO timestamp.
 */
export function createCadenceTrigger(
  type: CadenceTriggerType,
  source: string = "autonomic-cadence",
  payload?: Readonly<Record<string, unknown>>,
  priority: TriggerPriority = "NORMAL",
): CadenceTrigger {
  return {
    type,
    source,
    timestamp: new Date().toISOString(),
    payload,
    priority,
  };
}


export function enforceLineLimit(text: string, maxLines = 30): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  const truncated = lines.slice(0, maxLines - 1);
  truncated.push("... (truncated)");
  return truncated.join("\n");
}
