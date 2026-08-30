import { randomUUID } from "node:crypto";
import type { StagnationAuditResult } from "../preplanning/types.ts";

export const MODE_A_AUTONOMIC_DISCOVERY = "MODE_A_AUTONOMIC_DISCOVERY" as const;
export const MODE_STANDARD_PREPLAN = "MODE_STANDARD_PREPLAN" as const;
export const MODE_DORMANT = "MODE_DORMANT" as const;

export const CHRONIC_STAGNATION_CYCLE_THRESHOLD = 3;

export type StagnationMode =
  | typeof MODE_A_AUTONOMIC_DISCOVERY
  | typeof MODE_STANDARD_PREPLAN
  | typeof MODE_DORMANT;

export interface StagnationShockOptions {
  readonly auditResult?: StagnationAuditResult | undefined;
  readonly consecutiveStagnationCount?: number | undefined;
  readonly rootDir?: string | undefined;
  readonly forceExecution?: boolean | undefined;
  readonly dispatchTaskId?: string | undefined;
  readonly dispatchAction?: (() => Promise<string | void> | string | void) | undefined;
}

export interface StagnationShockResult {
  readonly triggered: boolean;
  readonly dispatchedTaskId?: string | undefined;
  readonly mode: StagnationMode;
  readonly consecutiveStagnationCount: number;
  readonly escalated: boolean;
  readonly recoveryAction: string;
  readonly timestamp: string;
  readonly details?: string | undefined;
}

export function executeStagnationShockRecovery(
  options?: StagnationShockOptions | undefined,
): StagnationShockResult {
  const nowIso = new Date().toISOString();
  const isStagnant = options?.auditResult?.is_stagnant ?? false;
  const force = options?.forceExecution ?? false;

  if (!isStagnant && !force) {
    return {
      triggered: false,
      mode: MODE_STANDARD_PREPLAN,
      consecutiveStagnationCount: options?.consecutiveStagnationCount ?? 0,
      escalated: false,
      recoveryAction: "NOOP_HEALTHY",
      timestamp: nowIso,
      details: "Mind pre-planning is healthy; stagnation shock bypass engaged.",
    };
  }

  const consecutiveCount =
    typeof options?.consecutiveStagnationCount === "number" &&
    options.consecutiveStagnationCount > 0
      ? options.consecutiveStagnationCount
      : 1;

  const isChronic = consecutiveCount >= CHRONIC_STAGNATION_CYCLE_THRESHOLD;
  const targetMode: StagnationMode = isChronic
    ? MODE_A_AUTONOMIC_DISCOVERY
    : MODE_STANDARD_PREPLAN;

  const dispatchedTaskId =
    options?.dispatchTaskId ?? `shock-recovery-${randomUUID().slice(0, 8)}`;

  const recoveryAction = isChronic
    ? "DISPATCH_AUTONOMIC_DISCOVERY_PULSE"
    : "DISPATCH_PREPLANNING_SYNTHESIS";

  if (options?.dispatchAction) {
    try {
      void options.dispatchAction();
    } catch {}
  }

  const details = isChronic
    ? `Chronic stagnation threshold reached (${consecutiveCount} cycles >= ${CHRONIC_STAGNATION_CYCLE_THRESHOLD}). Auto-escalated to ${MODE_A_AUTONOMIC_DISCOVERY}.`
    : `Standard stagnation shock pulse triggered. Dispatched task ${dispatchedTaskId} under ${MODE_STANDARD_PREPLAN}.`;

  return {
    triggered: true,
    dispatchedTaskId,
    mode: targetMode,
    consecutiveStagnationCount: consecutiveCount,
    escalated: isChronic,
    recoveryAction,
    timestamp: nowIso,
    details,
  };
}
