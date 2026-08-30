import { join } from "node:path";
import {
  filterEligibleBacklogItems,
  filterEligibleDefects,
  loadBacklogItems,
  loadDefectItems,
} from "../preplanning/backlog-clusterer.ts";
import { resolveLedgerPath } from "../preplanning/bridge-state.ts";
import type { RawBacklogItem, RawDefectItem, StagnationAuditResult } from "../preplanning/types.ts";
import {
  executeStagnationShockRecovery,
  type StagnationShockResult,
} from "./stagnation-recovery-interlock.ts";

export const MIND_PREPLANNING_STAGNATION = "MIND_PREPLANNING_STAGNATION" as const;
export const DEFAULT_STAGNATION_THRESHOLD_SECONDS = 180;

export interface StagnationAuditOptions {
  readonly rootDir?: string | undefined;
  readonly backlogFile?: string | undefined;
  readonly defectsFile?: string | undefined;
  readonly lastPreplanTimestamp?: string | null | undefined;
  readonly nowMs?: number | undefined;
  readonly stagnationThresholdSeconds?: number | undefined;
  readonly explicitBacklog?: readonly RawBacklogItem[] | undefined;
  readonly explicitDefects?: readonly RawDefectItem[] | undefined;
  readonly consecutiveStagnationCount?: number | undefined;
  readonly triggerShockRecovery?: boolean | undefined;
}

export function auditMindPreplanningStagnation(
  options?: StagnationAuditOptions | undefined,
): StagnationAuditResult & { shock_recovery?: StagnationShockResult | undefined } {
  const root =
    options !== undefined && options.rootDir !== undefined ? options.rootDir : process.cwd();
  const customBacklog = options !== undefined ? options.backlogFile : undefined;
  const customDefects = options !== undefined ? options.defectsFile : undefined;

  const backlogPath = resolveLedgerPath(join(".olt", "backlog.jsonl"), customBacklog, root);
  const defectsPath = resolveLedgerPath(join(".olt", "defects.jsonl"), customDefects, root);

  const backlogItems =
    options !== undefined && options.explicitBacklog !== undefined
      ? options.explicitBacklog
      : loadBacklogItems(backlogPath);
  const defectItems =
    options !== undefined && options.explicitDefects !== undefined
      ? options.explicitDefects
      : loadDefectItems(defectsPath);

  const eligibleBacklog = filterEligibleBacklogItems(backlogItems);
  const eligibleDefects = filterEligibleDefects(defectItems);

  const nowMs = options !== undefined && options.nowMs !== undefined ? options.nowMs : Date.now();
  const thresholdSeconds =
    options !== undefined && options.stagnationThresholdSeconds !== undefined
      ? options.stagnationThresholdSeconds
      : DEFAULT_STAGNATION_THRESHOLD_SECONDS;

  const lastPreplanMs =
    options !== undefined &&
    options.lastPreplanTimestamp !== undefined &&
    options.lastPreplanTimestamp !== null
      ? Date.parse(options.lastPreplanTimestamp)
      : 0;

  const idleDurationSeconds =
    lastPreplanMs > 0 ? Math.max(0, (nowMs - lastPreplanMs) / 1000) : Number.POSITIVE_INFINITY;

  const totalUnplanned = eligibleBacklog.length + eligibleDefects.length;
  const recordedTimestamp =
    options !== undefined && options.lastPreplanTimestamp !== undefined
      ? options.lastPreplanTimestamp
      : null;

  if (totalUnplanned === 0) {
    return {
      is_stagnant: false,
      pending_backlog_count: 0,
      open_defects_count: 0,
      last_preplan_timestamp: recordedTimestamp,
      idle_duration_seconds:
        idleDurationSeconds === Number.POSITIVE_INFINITY ? 0 : idleDurationSeconds,
      findings: Object.freeze([
        "Mind pre-planning pipeline is healthy; all backlog items and defects are planned.",
      ]),
    };
  }

  if (idleDurationSeconds > thresholdSeconds) {
    const formattedDuration =
      idleDurationSeconds === Number.POSITIVE_INFINITY
        ? "untracked duration"
        : `${idleDurationSeconds.toFixed(1)}s`;

    const findings: string[] = [
      `Mind pre-planning engine has stagnated for ${formattedDuration} while ${eligibleBacklog.length} backlog item(s) and ${eligibleDefects.length} defect(s) remain unplanned.`,
    ];

    const baseResult: StagnationAuditResult = {
      is_stagnant: true,
      pending_backlog_count: eligibleBacklog.length,
      open_defects_count: eligibleDefects.length,
      last_preplan_timestamp: recordedTimestamp,
      idle_duration_seconds:
        idleDurationSeconds === Number.POSITIVE_INFINITY ? 999999 : idleDurationSeconds,
      error_code: MIND_PREPLANNING_STAGNATION,
      findings: Object.freeze(findings),
      recommended_remediation: "RUN_PREPLANNING_FACTORY",
    };

    if (options?.triggerShockRecovery) {
      const shockResult = executeStagnationShockRecovery({
        auditResult: baseResult,
        consecutiveStagnationCount: options.consecutiveStagnationCount,
        rootDir: root,
      });
      return {
        ...baseResult,
        shock_recovery: shockResult,
      };
    }

    return baseResult;
  }

  return {
    is_stagnant: false,
    pending_backlog_count: eligibleBacklog.length,
    open_defects_count: eligibleDefects.length,
    last_preplan_timestamp: recordedTimestamp,
    idle_duration_seconds: idleDurationSeconds,
    findings: Object.freeze([
      `Unplanned items exist (${totalUnplanned}), but idle duration (${idleDurationSeconds.toFixed(1)}s) is within the allowable window (${thresholdSeconds}s).`,
    ]),
  };
}

export const auditMindPreplanningLiveness = auditMindPreplanningStagnation;
export type { MindAuditorStagnationReport } from "../preplanning/types.ts";
