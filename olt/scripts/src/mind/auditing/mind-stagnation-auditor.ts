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
import { generateZeroDeltaChallengePrompt } from "./cognitive/challenge-generator.ts";

export const MIND_PREPLANNING_STAGNATION = "MIND_PREPLANNING_STAGNATION" as const;
export const MIND_CREATIVE_STAGNATION = "MIND_CREATIVE_STAGNATION" as const;
export const DEFAULT_STAGNATION_THRESHOLD_SECONDS = 180;
export const DEFAULT_ZERO_DELTA_THRESHOLD_CYCLES = 2;
export const DEFAULT_MAINTENANCE_LOOP_THRESHOLD_CYCLES = 2;

import {
  compareReportDelta,
  type MindStagnationAuditResult,
  type StagnationAuditOptions,
} from "./stagnation-delta.ts";

export * from "./stagnation-delta.ts";

export function auditMindPreplanningStagnation(
  options?: StagnationAuditOptions | undefined,
): MindStagnationAuditResult {
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
  const zeroDeltaThreshold =
    options?.zeroDeltaThresholdCycles ?? DEFAULT_ZERO_DELTA_THRESHOLD_CYCLES;
  const maintenanceThreshold =
    options?.maintenanceLoopThresholdCycles ?? DEFAULT_MAINTENANCE_LOOP_THRESHOLD_CYCLES;

  const lastPreplanMs = options?.lastPreplanTimestamp
    ? Date.parse(options.lastPreplanTimestamp)
    : 0;
  const idleDurationSeconds =
    lastPreplanMs > 0 ? Math.max(0, (nowMs - lastPreplanMs) / 1000) : Number.POSITIVE_INFINITY;
  const totalUnplanned = eligibleBacklog.length + eligibleDefects.length;
  const recordedTimestamp = options?.lastPreplanTimestamp ?? null;

  const previousReport = options !== undefined ? options.previousReport : undefined;
  let isMaintenanceLoop = false;
  if (options !== undefined && options.isMaintenanceOnlyLoop === true) {
    isMaintenanceLoop = true;
  } else if (
    options !== undefined &&
    typeof options.consecutiveMaintenanceCycles === "number" &&
    options.consecutiveMaintenanceCycles >= maintenanceThreshold &&
    options.productProgressMade !== true
  ) {
    isMaintenanceLoop = true;
  }

  // Check 1: Maintenance-only loop without product progress (MIND_CREATIVE_STAGNATION)
  if (isMaintenanceLoop) {
    const cycleCount =
      options !== undefined && options.consecutiveMaintenanceCycles !== undefined
        ? options.consecutiveMaintenanceCycles
        : 1;
    const findings = [
      `Mind is in a maintenance-only loop without product progress (${cycleCount} cycle${cycleCount === 1 ? "" : "s"}) (MIND_CREATIVE_STAGNATION). Autonomic creative overload required.`,
    ];
    const challengePrompt = generateZeroDeltaChallengePrompt(root, {
      cycleIndex: cycleCount,
      consecutiveZeroDeltaCount: cycleCount,
      now: new Date(nowMs).toISOString(),
    });

    const baseResult: MindStagnationAuditResult = {
      is_stagnant: true,
      pending_backlog_count: eligibleBacklog.length,
      open_defects_count: eligibleDefects.length,
      last_preplan_timestamp: recordedTimestamp,
      idle_duration_seconds:
        idleDurationSeconds === Number.POSITIVE_INFINITY ? 0 : idleDurationSeconds,
      error_code: MIND_CREATIVE_STAGNATION,
      findings: Object.freeze(findings),
      recommended_remediation: "AUTONOMIC_CREATIVE_OVERLOAD",
      zero_delta: false,
      suppressed: false,
      cognitive_challenge_prompt: challengePrompt,
    };

    if (options !== undefined && options.triggerShockRecovery === true) {
      const shockResult = executeStagnationShockRecovery(root, {
        idleDurationSeconds: baseResult.idle_duration_seconds,
        stagnationThresholdSeconds: thresholdSeconds,
        pendingBacklogCount: eligibleBacklog.length,
        consecutiveCycles: options.consecutiveStagnationCount,
        auditResult: baseResult,
      });
      return {
        ...baseResult,
        shock_recovery: shockResult,
      };
    }
    return baseResult;
  }

  // Calculate candidate base result for zero-delta comparison
  let candidateResult: MindStagnationAuditResult;
  if (totalUnplanned === 0) {
    candidateResult = {
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
  } else if (idleDurationSeconds > thresholdSeconds) {
    const formattedDuration =
      idleDurationSeconds === Number.POSITIVE_INFINITY
        ? "untracked duration"
        : `${idleDurationSeconds.toFixed(1)}s`;
    candidateResult = {
      is_stagnant: true,
      pending_backlog_count: eligibleBacklog.length,
      open_defects_count: eligibleDefects.length,
      last_preplan_timestamp: recordedTimestamp,
      idle_duration_seconds:
        idleDurationSeconds === Number.POSITIVE_INFINITY ? 999999 : idleDurationSeconds,
      error_code: MIND_PREPLANNING_STAGNATION,
      findings: Object.freeze([
        `Mind pre-planning engine has stagnated for ${formattedDuration} while ${eligibleBacklog.length} backlog item(s) and ${eligibleDefects.length} defect(s) remain unplanned.`,
      ]),
      recommended_remediation: "RUN_PREPLANNING_FACTORY",
    };
  } else {
    candidateResult = {
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

  // Zero-delta comparison
  const delta = compareReportDelta(candidateResult, previousReport);
  const consecutiveZeroDelta = delta.isZeroDelta
    ? (options !== undefined && options.consecutiveZeroDeltaCount !== undefined
        ? options.consecutiveZeroDeltaCount
        : 0) + 1
    : 0;

  let shouldChallenge = false;
  if (delta.isZeroDelta) {
    shouldChallenge = true;
  } else if (totalUnplanned === 0) {
    shouldChallenge = true;
  }

  const challengePrompt = shouldChallenge
    ? generateZeroDeltaChallengePrompt(root, {
        cycleIndex: consecutiveZeroDelta,
        consecutiveZeroDeltaCount: consecutiveZeroDelta,
        now: new Date(nowMs).toISOString(),
      })
    : undefined;

  let isChronicZeroDelta = false;
  if (consecutiveZeroDelta >= zeroDeltaThreshold) {
    isChronicZeroDelta = true;
  } else if (
    options !== undefined &&
    options.consecutiveZeroDeltaCount !== undefined &&
    options.consecutiveZeroDeltaCount >= zeroDeltaThreshold &&
    delta.isZeroDelta
  ) {
    isChronicZeroDelta = true;
  }

  // Check 2: Consecutive pulses producing identical state with 0 delta (MIND_CREATIVE_STAGNATION)
  if (isChronicZeroDelta) {
    let zeroCycles = zeroDeltaThreshold;
    if (consecutiveZeroDelta !== 0) {
      zeroCycles = consecutiveZeroDelta;
    } else if (options !== undefined && options.consecutiveZeroDeltaCount !== undefined) {
      zeroCycles = options.consecutiveZeroDeltaCount;
    }
    const findings = [
      `Consecutive pulses produced identical state with 0 delta (${zeroCycles} cycles) (MIND_CREATIVE_STAGNATION). Autonomic creative overload required.`,
    ];
    const baseResult: MindStagnationAuditResult = {
      is_stagnant: true,
      pending_backlog_count: eligibleBacklog.length,
      open_defects_count: eligibleDefects.length,
      last_preplan_timestamp: recordedTimestamp,
      idle_duration_seconds:
        idleDurationSeconds === Number.POSITIVE_INFINITY ? 0 : idleDurationSeconds,
      error_code: MIND_CREATIVE_STAGNATION,
      findings: Object.freeze(findings),
      recommended_remediation: "AUTONOMIC_CREATIVE_OVERLOAD",
      zero_delta: true,
      consecutive_zero_delta_count: zeroCycles,
      delta_summary: delta.summary,
      cognitive_challenge_prompt: challengePrompt,
    };

    if (options?.triggerShockRecovery === true) {
      const shockResult = executeStagnationShockRecovery(root, {
        idleDurationSeconds: baseResult.idle_duration_seconds,
        stagnationThresholdSeconds: thresholdSeconds,
        pendingBacklogCount: eligibleBacklog.length,
        consecutiveCycles: options.consecutiveStagnationCount,
        auditResult: baseResult,
      });
      return { ...baseResult, shock_recovery: shockResult };
    }
    return baseResult;
  }

  // If stagnant under standard pre-planning
  if (candidateResult.is_stagnant) {
    const shockResult = executeStagnationShockRecovery(root, {
      idleDurationSeconds,
      stagnationThresholdSeconds: thresholdSeconds,
      pendingBacklogCount: eligibleBacklog.length,
      consecutiveCycles: options?.consecutiveStagnationCount,
      auditResult: candidateResult,
    });

    const baseResult: MindStagnationAuditResult = {
      ...candidateResult,
      zero_delta: delta.isZeroDelta,
      consecutive_zero_delta_count: consecutiveZeroDelta,
      delta_summary: delta.summary,
      cognitive_challenge_prompt: challengePrompt,
      ...(options?.triggerShockRecovery === true ? { shock_recovery: shockResult } : {}),
    };
    return baseResult;
  }

  // Healthy result with optional zero-delta suppression
  return {
    ...candidateResult,
    zero_delta: delta.isZeroDelta,
    suppressed: options?.suppressZeroDelta === true ? delta.isZeroDelta : false,
    consecutive_zero_delta_count: consecutiveZeroDelta,
    delta_summary: delta.summary,
    cognitive_challenge_prompt: challengePrompt,
  };
}

export function auditMindCreativeStagnation(
  options?: StagnationAuditOptions | undefined,
): MindStagnationAuditResult {
  const isMaintenanceOnlyLoop =
    options !== undefined && options.isMaintenanceOnlyLoop !== undefined
      ? options.isMaintenanceOnlyLoop
      : true;
  return auditMindPreplanningStagnation({
    ...options,
    isMaintenanceOnlyLoop,
  });
}

export const auditMindPreplanningLiveness = auditMindPreplanningStagnation;
export type { MindAuditorStagnationReport } from "../preplanning/types.ts";
