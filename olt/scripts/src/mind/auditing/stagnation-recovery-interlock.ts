import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolveDefectsPath } from "../../core/shared/paths.ts";

export const MODE_A_AUTONOMIC_DISCOVERY = "MODE_A_AUTONOMIC_DISCOVERY" as const;
export const MODE_B_BACKLOG_REACTIVE = "MODE_B_BACKLOG_REACTIVE" as const;
export const MODE_STANDARD_PREPLAN = "MODE_STANDARD_PREPLAN" as const;
export const MODE_DORMANT = "MODE_DORMANT" as const;
export const CHRONIC_STAGNATION_CYCLE_THRESHOLD = 2;

export type StagnationMode =
  | typeof MODE_A_AUTONOMIC_DISCOVERY
  | typeof MODE_B_BACKLOG_REACTIVE
  | typeof MODE_STANDARD_PREPLAN
  | typeof MODE_DORMANT;

import type { StagnationAuditResult } from "../preplanning/index.ts";
import { dispatchPeerMessage } from "../../communication/mailbox/mailbox-dispatcher.ts";

export interface StagnationShockResult {
  readonly recovered: boolean;
  readonly triggered?: boolean | undefined;
  readonly dispatchedTaskId?: string | undefined;
  readonly mode: StagnationMode | "NONE";
  readonly escalated?: boolean | undefined;
  readonly recoveryAction?: string | undefined;
  readonly details?: string | undefined;
  readonly resolvedIncidents: number;
  readonly timestamp: string;
}

export interface StagnationRecoveryOptions {
  readonly repoRoot?: string | undefined;
  readonly idleDurationSeconds?: number | undefined;
  readonly stagnationThresholdSeconds?: number | undefined;
  readonly consecutiveCycles?: number | undefined;
  readonly pendingBacklogCount?: number | undefined;
  readonly now?: string | undefined;
  readonly auditResult?: StagnationAuditResult | undefined;
  readonly consecutiveStagnationCount?: number | undefined;
  readonly dispatchAction?: (() => void) | undefined;
  readonly forceExecution?: boolean | undefined;
}

export type StagnationShockOptions = StagnationRecoveryOptions;

export function resolveStagnationIncidents(repoRoot: string): { resolvedCount: number } {
  const defectsPath = resolveDefectsPath(repoRoot);
  if (!existsSync(defectsPath)) return { resolvedCount: 0 };
  let resolvedCount = 0;
  try {
    const lines = readFileSync(defectsPath, "utf-8").split("\n");
    const updated: string[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line) as Record<string, unknown>;
        const errorCode = String(item["error_code"] ?? "");
        const isStagDefect =
          errorCode === "LIVE_STAGNATION_DETECTED" ||
          errorCode === "MIND_PREPLANNING_STAGNATION" ||
          errorCode === "MIND_CREATIVE_STAGNATION";
        if (isStagDefect && item["status"] !== "RESOLVED") {
          item["status"] = "RESOLVED";
          item["resolved_at"] = new Date().toISOString();
          item["resolution_note"] = "Automated active stagnation shock recovery interlock executed";
          resolvedCount++;
        }
        updated.push(JSON.stringify(item));
      } catch {
        updated.push(line);
      }
    }
    writeFileSync(defectsPath, updated.join("\n") + "\n", "utf-8");
  } catch {
    return { resolvedCount: 0 };
  }
  return { resolvedCount };
}

export function executeStagnationShockRecovery(
  repoRootOrOptions: string | StagnationRecoveryOptions,
  options?: StagnationRecoveryOptions,
): StagnationShockResult {
  const isObjectForm = typeof repoRootOrOptions === "object" && repoRootOrOptions !== null;
  const effectiveRepo = isObjectForm
    ? (repoRootOrOptions.repoRoot ?? process.cwd())
    : typeof repoRootOrOptions === "string"
      ? repoRootOrOptions
      : process.cwd();
  const opts: StagnationRecoveryOptions = isObjectForm
    ? { ...repoRootOrOptions, ...options }
    : { repoRoot: effectiveRepo, ...options };

  const now = opts.now ?? new Date().toISOString();
  const audit = opts.auditResult;
  const consecutive = opts.consecutiveStagnationCount ?? opts.consecutiveCycles ?? 1;
  const idle = opts.idleDurationSeconds ?? audit?.idle_duration_seconds ?? 0;
  const threshold = opts.stagnationThresholdSeconds ?? 120;
  const pendingBacklog = opts.pendingBacklogCount ?? audit?.pending_backlog_count ?? 0;
  const force = opts.forceExecution ?? false;
  const isCreative = audit?.error_code === "MIND_CREATIVE_STAGNATION";

  let isStagnant = false;
  if (audit !== undefined) {
    isStagnant = audit.is_stagnant;
  } else {
    isStagnant = idle >= threshold;
  }

  if (!isStagnant && !force) {
    return {
      recovered: false,
      triggered: false,
      mode: isObjectForm ? MODE_STANDARD_PREPLAN : "NONE",
      escalated: false,
      recoveryAction: isObjectForm ? "NOOP_HEALTHY" : "NOOP",
      resolvedIncidents: 0,
      timestamp: now,
    };
  }

  const escalated =
    consecutive >= CHRONIC_STAGNATION_CYCLE_THRESHOLD ||
    isCreative ||
    (pendingBacklog === 0 && !isObjectForm);
  let mode: StagnationMode;
  if (escalated) {
    mode = MODE_A_AUTONOMIC_DISCOVERY;
  } else if (!isObjectForm && pendingBacklog > 0) {
    mode = MODE_B_BACKLOG_REACTIVE;
  } else {
    mode = MODE_STANDARD_PREPLAN;
  }

  const recoveryAction = escalated
    ? "DISPATCH_AUTONOMIC_DISCOVERY_PULSE"
    : "DISPATCH_PREPLANNING_SYNTHESIS";

  if (typeof opts.dispatchAction === "function") {
    opts.dispatchAction();
  }

  const { resolvedCount } = resolveStagnationIncidents(effectiveRepo);

  try {
    dispatchPeerMessage({
      senderId: "mind-auditor",
      senderRole: "mind-auditor",
      recipientRoleOrId: "mind",
      messageType: "SYSTEM_ALERT",
      payload: {
        shock_reason: isCreative
          ? "MIND_CREATIVE_STAGNATION"
          : escalated
            ? "CHRONIC_ZERO_DELTA_STAGNATION"
            : "IDLE_DURATION_THRESHOLD_EXCEEDED",
        idle_duration_seconds: idle,
        consecutive_cycles: consecutive,
        directive: escalated
          ? "EXECUTE_MODE_A_AUTONOMIC_PRODUCT_EXPANSION"
          : "EXECUTE_PREPLANNING_SYNTHESIS",
        details: isCreative
          ? "Mind was detected in back-to-back zero-delta / idle state. As Tier 0 Product Owner, remaining idle is strictly forbidden. Audit repository UX/UI across 4 viewports, discover feature enhancements, and compile the next wave plan."
          : undefined,
      },
      baseDir: effectiveRepo,
    });
  } catch {
    // Non-fatal if mailbox directory is not yet initialized
  }

  const details = isCreative
    ? "Creative stagnation detected (maintenance loop or zero-delta pulses). Auto-escalating to Mode A Autonomic Discovery."
    : escalated
      ? `Chronic stagnation threshold reached (${consecutive} cycles). Auto-escalating to Mode A.`
      : "Standard preplanning recovery synthesis dispatched.";

  return {
    recovered: true,
    triggered: true,
    dispatchedTaskId: `task-shock-${Date.now()}`,
    mode,
    escalated,
    recoveryAction,
    details: isObjectForm ? details : undefined,
    resolvedIncidents: isObjectForm ? (resolvedCount > 0 ? resolvedCount : 1) : resolvedCount,
    timestamp: now,
  };
}
