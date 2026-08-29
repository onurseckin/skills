import { buildRemediationGuidance } from "./watchdog-remediation.ts";
import {
  ERROR_CLASS_STALL_TIMEOUT,
  ERROR_CLASS_WALL_TIMEOUT,
  ERROR_CLASS_IDLE_TIMEOUT,
  EXIT_STATUS_SIGKILL_TIMEOUT,
  type SupervisorTier,
  type HierarchicalRole,
  type ProcessDiagnostics,
  type StructuredFailurePayload,
  type WatchdogLivenessReport,
} from "./watchdog-types.ts";

export interface CheckLivenessOptions {
  now: number;
  startedAtMs: number;
  lastActivityAtMs: number;
  lastProgressAtMs: number;
  wallTimeoutMs: number;
  idleTimeoutMs: number;
  stallProgressThresholdMs: number;
}

export function checkWatchdogLiveness(options: CheckLivenessOptions): WatchdogLivenessReport {
  const {
    now,
    startedAtMs,
    lastActivityAtMs,
    lastProgressAtMs,
    wallTimeoutMs,
    idleTimeoutMs,
    stallProgressThresholdMs,
  } = options;

  const duration = now - startedAtMs;
  const idleDuration = now - lastActivityAtMs;
  const stallDuration = now - lastProgressAtMs;

  if (duration >= wallTimeoutMs) {
    return {
      alive: false,
      timedOut: true,
      stalled: true,
      timeoutKind: "wall",
      errorClassification: ERROR_CLASS_WALL_TIMEOUT,
      reason: `Process wall timeout exceeded: execution duration ${duration}ms >= ${wallTimeoutMs}ms limit`,
    };
  }

  if (idleDuration >= idleTimeoutMs) {
    return {
      alive: false,
      timedOut: true,
      stalled: true,
      timeoutKind: "idle",
      errorClassification: ERROR_CLASS_IDLE_TIMEOUT,
      reason: `Process idle timeout exceeded: no output activity for ${idleDuration}ms >= ${idleTimeoutMs}ms limit`,
    };
  }

  if (stallDuration >= stallProgressThresholdMs) {
    return {
      alive: false,
      timedOut: true,
      stalled: true,
      timeoutKind: "stall",
      errorClassification: ERROR_CLASS_STALL_TIMEOUT,
      reason: `Process stall detected: 0 progress recorded for ${stallDuration}ms >= ${stallProgressThresholdMs}ms threshold`,
    };
  }

  return {
    alive: true,
    timedOut: false,
    stalled: false,
    timeoutKind: null,
  };
}

export interface SynthesizePayloadContext {
  now: number;
  supervisorTier: SupervisorTier;
  childRole: HierarchicalRole;
  taskId?: string | undefined;
  gateId?: string | undefined;
  agentId?: string | undefined;
  pid?: number | undefined;
  diagnostics: ProcessDiagnostics;
  exitStatus?: string | undefined;
  errorClassification?: string | undefined;
  reason?: string | undefined;
  defectReference?: string | undefined;
}

export function synthesizeWatchdogFailurePayload(
  ctx: SynthesizePayloadContext,
): StructuredFailurePayload {
  const classification = ctx.errorClassification ?? ERROR_CLASS_STALL_TIMEOUT;
  const guidance = buildRemediationGuidance({
    supervisorTier: ctx.supervisorTier,
    childRole: ctx.childRole,
    errorClassification: classification,
    taskId: ctx.taskId,
    gateId: ctx.gateId,
    defectReference: ctx.defectReference,
  });

  return {
    schema: "harness.structured_failure_payload",
    version: 1,
    exitStatus: ctx.exitStatus ?? EXIT_STATUS_SIGKILL_TIMEOUT,
    errorClassification: classification,
    reason:
      ctx.reason ??
      `Process execution terminated by watchdog due to ${classification} constraint violation`,
    taskId: ctx.taskId ?? null,
    gateId: ctx.gateId ?? null,
    agentId: ctx.agentId ?? null,
    supervisorTier: ctx.supervisorTier,
    childRole: ctx.childRole,
    childPid: ctx.pid,
    diagnostics: ctx.diagnostics,
    remediationGuidance: guidance,
    timestamp: new Date(ctx.now).toISOString(),
  };
}
