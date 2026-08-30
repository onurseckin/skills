import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolveDefectsPath } from "../../core/shared/paths.ts";

export const MODE_A_AUTONOMIC_DISCOVERY = "MODE_A_AUTONOMIC_DISCOVERY" as const;
export const MODE_B_BACKLOG_REACTIVE = "MODE_B_BACKLOG_REACTIVE" as const;
export const MODE_STANDARD_PREPLAN = "MODE_STANDARD_PREPLAN" as const;
export const MODE_DORMANT = "MODE_DORMANT" as const;
export const CHRONIC_STAGNATION_CYCLE_THRESHOLD = 3;

export type StagnationMode =
  | typeof MODE_A_AUTONOMIC_DISCOVERY
  | typeof MODE_B_BACKLOG_REACTIVE
  | typeof MODE_STANDARD_PREPLAN
  | typeof MODE_DORMANT;

import type { StagnationAuditResult } from "../preplanning/index.ts";

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
        if (item["error_code"] === "LIVE_STAGNATION_DETECTED" && item["status"] !== "RESOLVED") {
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
  if (typeof repoRootOrOptions === "object" && repoRootOrOptions !== null) {
    const opts = repoRootOrOptions;
    const audit = opts.auditResult;
    const consecutive = opts.consecutiveStagnationCount ?? 1;
    const isStagnant = audit?.is_stagnant ?? false;
    const force = opts.forceExecution ?? false;

    if (!isStagnant && !force) {
      return {
        recovered: false,
        triggered: false,
        mode: MODE_STANDARD_PREPLAN,
        escalated: false,
        recoveryAction: "NOOP_HEALTHY",
        resolvedIncidents: 0,
        timestamp: new Date().toISOString(),
      };
    }

    const escalated = consecutive >= CHRONIC_STAGNATION_CYCLE_THRESHOLD;
    const mode = escalated ? MODE_A_AUTONOMIC_DISCOVERY : MODE_STANDARD_PREPLAN;

    const recoveryAction = escalated
      ? "DISPATCH_AUTONOMIC_DISCOVERY_PULSE"
      : "DISPATCH_PREPLANNING_SYNTHESIS";

    if (typeof opts.dispatchAction === "function") {
      opts.dispatchAction();
    }

    return {
      recovered: true,
      triggered: true,
      dispatchedTaskId: `task-shock-${Date.now()}`,
      mode,
      escalated,
      recoveryAction,
      details: escalated
        ? `Chronic stagnation threshold reached (${consecutive} cycles). Auto-escalating to Mode A.`
        : "Standard preplanning recovery synthesis dispatched.",
      resolvedIncidents: 1,
      timestamp: new Date().toISOString(),
    };
  }

  const repoRoot = typeof repoRootOrOptions === "string" ? repoRootOrOptions : process.cwd();
  const now = options?.now ?? new Date().toISOString();
  const idle = options?.idleDurationSeconds ?? 0;
  const threshold = options?.stagnationThresholdSeconds ?? 120;
  const consecutive = options?.consecutiveCycles ?? 1;
  const pendingBacklog = options?.pendingBacklogCount ?? 0;

  if (idle < threshold) {
    return {
      recovered: false,
      triggered: false,
      mode: "NONE",
      escalated: false,
      recoveryAction: "NOOP",
      resolvedIncidents: 0,
      timestamp: now,
    };
  }

  const mode =
    consecutive >= 3 || pendingBacklog === 0
      ? "MODE_A_AUTONOMIC_DISCOVERY"
      : "MODE_B_BACKLOG_REACTIVE";

  const { resolvedCount } = resolveStagnationIncidents(repoRoot);

  return {
    recovered: true,
    triggered: true,
    dispatchedTaskId: `task-shock-${Date.now()}`,
    mode,
    escalated: consecutive >= 3,
    recoveryAction: "DISPATCH_PREPLANNING_SYNTHESIS",
    resolvedIncidents: resolvedCount,
    timestamp: now,
  };
}
