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
export const DEFAULT_ZERO_DELTA_THRESHOLD_CYCLES = 3;
export const DEFAULT_MAINTENANCE_LOOP_THRESHOLD_CYCLES = 3;

export interface ZeroDeltaComparisonResult {
  readonly isZeroDelta: boolean;
  readonly backlogDelta: number;
  readonly defectDelta: number;
  readonly findingsDelta: boolean;
  readonly statusDelta: boolean;
  readonly signatureChanged: boolean;
  readonly suppressed: boolean;
  readonly summary: string;
}

export interface MindStagnationAuditResult extends StagnationAuditResult {
  readonly cognitive_challenge_prompt?: string | undefined;
  readonly shock_recovery?: StagnationShockResult | undefined;
}

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
  readonly previousReport?: StagnationAuditResult | null | undefined;
  readonly consecutiveZeroDeltaCount?: number | undefined;
  readonly zeroDeltaThresholdCycles?: number | undefined;
  readonly isMaintenanceOnlyLoop?: boolean | undefined;
  readonly consecutiveMaintenanceCycles?: number | undefined;
  readonly maintenanceLoopThresholdCycles?: number | undefined;
  readonly productProgressMade?: boolean | undefined;
  readonly suppressZeroDelta?: boolean | undefined;
}

export function computeStateSignature(report: Partial<StagnationAuditResult>): string {
  const isStagnant = report.is_stagnant !== undefined ? report.is_stagnant : false;
  const pending = report.pending_backlog_count !== undefined ? report.pending_backlog_count : 0;
  const defects = report.open_defects_count !== undefined ? report.open_defects_count : 0;
  const errorCode = report.error_code !== undefined ? report.error_code : "NONE";
  const findingsHash = (report.findings !== undefined ? report.findings : []).join("::");
  const remediation =
    report.recommended_remediation !== undefined ? report.recommended_remediation : "NONE";
  return `${isStagnant}|${pending}|${defects}|${errorCode}|${findingsHash}|${remediation}`;
}

export function compareReportDelta(
  current: StagnationAuditResult,
  previous?: StagnationAuditResult | null | undefined,
): ZeroDeltaComparisonResult {
  if (!previous) {
    return {
      isZeroDelta: false,
      backlogDelta: current.pending_backlog_count,
      defectDelta: current.open_defects_count,
      findingsDelta: current.findings.length > 0,
      statusDelta: current.is_stagnant,
      signatureChanged: true,
      suppressed: false,
      summary: "Initial baseline report established (0 previous pulses).",
    };
  }

  const backlogDelta = current.pending_backlog_count - previous.pending_backlog_count;
  const defectDelta = current.open_defects_count - previous.open_defects_count;
  let statusDelta = false;
  if (current.is_stagnant !== previous.is_stagnant) {
    statusDelta = true;
  } else if (current.error_code !== previous.error_code) {
    statusDelta = true;
  }

  let findingsDelta = false;
  if (current.findings.length !== previous.findings.length) {
    findingsDelta = true;
  } else if (current.findings.some((f, idx) => f !== previous.findings[idx])) {
    findingsDelta = true;
  }
  const signatureChanged = computeStateSignature(current) !== computeStateSignature(previous);

  const isZeroDelta =
    backlogDelta === 0 && defectDelta === 0 && !statusDelta && !findingsDelta && !signatureChanged;

  const summary = isZeroDelta
    ? "Zero-delta state detected: state across pulses is identical."
    : `Delta detected: backlog=${backlogDelta > 0 ? `+${backlogDelta}` : backlogDelta}, defects=${defectDelta > 0 ? `+${defectDelta}` : defectDelta}${statusDelta ? ", status_changed" : ""}${findingsDelta ? ", findings_changed" : ""}.`;

  return {
    isZeroDelta,
    backlogDelta,
    defectDelta,
    findingsDelta,
    statusDelta,
    signatureChanged,
    suppressed: isZeroDelta,
    summary,
  };
}

export function isZeroDeltaReport(
  current: StagnationAuditResult,
  previous?: StagnationAuditResult | null | undefined,
): boolean {
  return compareReportDelta(current, previous).isZeroDelta;
}

export function suppressZeroDeltaReport(
  current: StagnationAuditResult,
  previous?: StagnationAuditResult | null | undefined,
): StagnationAuditResult {
  const delta = compareReportDelta(current, previous);
  if (delta.isZeroDelta) {
    return {
      ...current,
      zero_delta: true,
      suppressed: true,
      delta_summary: "Suppressed duplicate zero-delta stagnation report.",
    };
  }
  return {
    ...current,
    zero_delta: false,
    suppressed: false,
    delta_summary: delta.summary,
  };
}

export function auditMindPreplanningStagnation(
  options?: StagnationAuditOptions | undefined,
): MindStagnationAuditResult {
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
  const zeroDeltaThreshold =
    options !== undefined && options.zeroDeltaThresholdCycles !== undefined
      ? options.zeroDeltaThresholdCycles
      : DEFAULT_ZERO_DELTA_THRESHOLD_CYCLES;
  const maintenanceThreshold =
    options !== undefined && options.maintenanceLoopThresholdCycles !== undefined
      ? options.maintenanceLoopThresholdCycles
      : DEFAULT_MAINTENANCE_LOOP_THRESHOLD_CYCLES;

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

  // If stagnant under standard pre-planning
  if (candidateResult.is_stagnant) {
    executeStagnationShockRecovery(root, {
      idleDurationSeconds,
      stagnationThresholdSeconds: thresholdSeconds,
      pendingBacklogCount: eligibleBacklog.length,
    });

    const baseResult: MindStagnationAuditResult = {
      ...candidateResult,
      zero_delta: delta.isZeroDelta,
      consecutive_zero_delta_count: consecutiveZeroDelta,
      delta_summary: delta.summary,
      cognitive_challenge_prompt: challengePrompt,
    };

    if (options !== undefined && options.triggerShockRecovery === true) {
      const shockResult = executeStagnationShockRecovery(root, {
        idleDurationSeconds,
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

  // Healthy result with optional zero-delta suppression
  const baseResult: MindStagnationAuditResult = {
    ...candidateResult,
    zero_delta: delta.isZeroDelta,
    suppressed:
      options !== undefined && options.suppressZeroDelta === true ? delta.isZeroDelta : false,
    consecutive_zero_delta_count: consecutiveZeroDelta,
    delta_summary: delta.summary,
    cognitive_challenge_prompt: challengePrompt,
  };

  return baseResult;
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
