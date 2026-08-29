import { join } from "node:path";
import {
  filterEligibleBacklogItems,
  filterEligibleDefects,
  loadBacklogItems,
  loadDefectItems,
} from "../preplanning/backlog-clusterer.ts";
import { resolveLedgerPath } from "../preplanning/bridge-state.ts";
import type { RawBacklogItem, RawDefectItem, StagnationAuditResult } from "../preplanning/types.ts";

export const MIND_PREPLANNING_STAGNATION = "MIND_PREPLANNING_STAGNATION" as const;
export const DEFAULT_STAGNATION_THRESHOLD_SECONDS = 180; // 3 minutes idle threshold

export interface StagnationAuditOptions {
  readonly rootDir?: string | undefined;
  readonly backlogFile?: string | undefined;
  readonly defectsFile?: string | undefined;
  readonly lastPreplanTimestamp?: string | null | undefined;
  readonly nowMs?: number | undefined;
  readonly stagnationThresholdSeconds?: number | undefined;
  readonly explicitBacklog?: readonly RawBacklogItem[] | undefined;
  readonly explicitDefects?: readonly RawDefectItem[] | undefined;
}

export function auditMindPreplanningStagnation(
  options?: StagnationAuditOptions | undefined,
): StagnationAuditResult {
  const root = options?.rootDir ?? process.cwd();
  const backlogPath = resolveLedgerPath(join(".olt", "backlog.jsonl"), options?.backlogFile, root);
  const defectsPath = resolveLedgerPath(join(".olt", "defects.jsonl"), options?.defectsFile, root);

  const backlogItems = options?.explicitBacklog ?? loadBacklogItems(backlogPath);
  const defectItems = options?.explicitDefects ?? loadDefectItems(defectsPath);

  const eligibleBacklog = filterEligibleBacklogItems(backlogItems);
  const eligibleDefects = filterEligibleDefects(defectItems);

  const nowMs = options?.nowMs ?? Date.now();
  const thresholdSeconds =
    options?.stagnationThresholdSeconds ?? DEFAULT_STAGNATION_THRESHOLD_SECONDS;

  const lastPreplanMs = options?.lastPreplanTimestamp
    ? Date.parse(options.lastPreplanTimestamp)
    : 0;

  const idleDurationSeconds =
    lastPreplanMs > 0 ? Math.max(0, (nowMs - lastPreplanMs) / 1000) : Number.POSITIVE_INFINITY;

  const totalUnplanned = eligibleBacklog.length + eligibleDefects.length;

  if (totalUnplanned === 0) {
    return {
      is_stagnant: false,
      pending_backlog_count: 0,
      open_defects_count: 0,
      last_preplan_timestamp: options?.lastPreplanTimestamp ?? null,
      idle_duration_seconds:
        idleDurationSeconds === Number.POSITIVE_INFINITY ? 0 : idleDurationSeconds,
      findings: Object.freeze([
        "Mind pre-planning pipeline is healthy; all backlog items and defects are planned.",
      ]),
    };
  }

  // If there are unplanned items and idle time exceeds threshold (or never preplanned)
  if (idleDurationSeconds > thresholdSeconds) {
    const findings: string[] = [
      `Mind pre-planning engine has stagnated for ${
        idleDurationSeconds === Number.POSITIVE_INFINITY
          ? "untracked duration"
          : `${idleDurationSeconds.toFixed(1)}s`
      } while ${eligibleBacklog.length} backlog item(s) and ${eligibleDefects.length} defect(s) remain unplanned.`,
    ];

    return {
      is_stagnant: true,
      pending_backlog_count: eligibleBacklog.length,
      open_defects_count: eligibleDefects.length,
      last_preplan_timestamp: options?.lastPreplanTimestamp ?? null,
      idle_duration_seconds:
        idleDurationSeconds === Number.POSITIVE_INFINITY ? 999999 : idleDurationSeconds,
      error_code: MIND_PREPLANNING_STAGNATION,
      findings: Object.freeze(findings),
      recommended_remediation: "RUN_PREPLANNING_FACTORY",
    };
  }

  return {
    is_stagnant: false,
    pending_backlog_count: eligibleBacklog.length,
    open_defects_count: eligibleDefects.length,
    last_preplan_timestamp: options?.lastPreplanTimestamp ?? null,
    idle_duration_seconds: idleDurationSeconds,
    findings: Object.freeze([
      `Unplanned items exist (${totalUnplanned}), but idle duration (${idleDurationSeconds.toFixed(1)}s) is within the allowable window (${thresholdSeconds}s).`,
    ]),
  };
}
