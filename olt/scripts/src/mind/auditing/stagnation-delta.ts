import type { RawBacklogItem, RawDefectItem, StagnationAuditResult } from "../preplanning/types.ts";
import type { StagnationShockResult } from "./stagnation-recovery-interlock.ts";

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

export function sanitizeFindingForDelta(finding: string): string {
  return finding
    .replace(/\b\d+(\.\d+)?s\b/g, "<duration>")
    .replace(/\b\d+ cycles?\b/gi, "<cycles>")
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?\b/g, "<timestamp>");
}

export function computeStateSignature(report: Partial<StagnationAuditResult>): string {
  const isStagnant = report.is_stagnant !== undefined ? report.is_stagnant : false;
  const pending = report.pending_backlog_count !== undefined ? report.pending_backlog_count : 0;
  const defects = report.open_defects_count !== undefined ? report.open_defects_count : 0;
  const errorCode = report.error_code !== undefined ? report.error_code : "NONE";
  const findingsHash = (
    report.findings !== undefined ? report.findings.map(sanitizeFindingForDelta) : []
  ).join("::");
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
  } else {
    const curSanitized = current.findings.map(sanitizeFindingForDelta);
    const prevSanitized = previous.findings.map(sanitizeFindingForDelta);
    if (curSanitized.some((f, idx) => f !== prevSanitized[idx])) {
      findingsDelta = true;
    }
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
