import {
  DEFAULT_DIAGNOSTIC_TAIL_BYTES,
  DEFAULT_GRACE_PERIOD_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_STALL_PROGRESS_THRESHOLD_MS,
  DEFAULT_TEST_IDLE_TIMEOUT_MS,
  DEFAULT_TEST_WALL_TIMEOUT_MS,
  ERROR_CLASS_STALL_TIMEOUT,
  EXIT_STATUS_SIGKILL_TIMEOUT,
} from "./constants.ts";
import { buildProcessDiagnostics, trimChunks } from "./diagnostics.ts";
import { defaultKillProcessTree, executeSignalEscalation } from "./kill-tree.ts";
import { evaluateProcessLiveness } from "./liveness.ts";
import { monitorSubprocessLoop } from "./monitor.ts";
import { buildRemediationGuidance } from "./remediation.ts";
import type {
  BunSubprocess,
  ErrorClassification,
  ExitStatus,
  HierarchicalRole,
  ProcessDiagnostics,
  ProcessWatchdogOptions,
  StructuredFailurePayload,
  SupervisorTier,
  WatchdogLivenessReport,
  WatchdogMonitorResult,
} from "./types.ts";

export class ProcessTimeoutWatchdog {
  public readonly pid?: number | undefined;
  public readonly ppid?: number | undefined;
  public readonly taskId?: string | undefined;
  public readonly gateId?: string | undefined;
  public readonly agentId?: string | undefined;
  public readonly supervisorTier: SupervisorTier;
  public readonly childRole: HierarchicalRole;
  public readonly wallTimeoutMs: number;
  public readonly idleTimeoutMs: number;
  public readonly stallProgressThresholdMs: number;
  public readonly heartbeatIntervalMs: number;
  public readonly graceMs: number;
  public readonly maxTailBytes: number;

  private readonly clock: () => number;
  private readonly killFn: (pid: number, signal: NodeJS.Signals) => boolean;
  private readonly waitFn: (milliseconds: number) => Promise<unknown>;

  private readonly startedAtMs: number;
  private lastActivityAtMs: number;
  private lastProgressAtMs: number;
  private lastHeartbeatAtMs: number;
  private heartbeatCountValue = 0;

  private readonly stdoutChunks: string[] = [];
  private readonly stderrChunks: string[] = [];
  private totalStdoutBytes = 0;
  private totalStderrBytes = 0;
  private readonly recordedSignals: NodeJS.Signals[] = [];

  public constructor(options: ProcessWatchdogOptions = {}) {
    this.clock = options.now ?? (() => Date.now());
    this.killFn = options.killProcessTree ?? defaultKillProcessTree;
    this.waitFn = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    this.pid = options.pid;
    this.ppid = options.ppid;
    this.taskId = options.taskId;
    this.gateId = options.gateId;
    this.agentId = options.agentId;
    this.supervisorTier =
      typeof options.supervisorTier === "string" ? options.supervisorTier : "coordinator";
    this.childRole = typeof options.childRole === "string" ? options.childRole : "task_implementer";

    this.wallTimeoutMs = options.wallTimeoutMs ?? DEFAULT_TEST_WALL_TIMEOUT_MS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_TEST_IDLE_TIMEOUT_MS;
    this.stallProgressThresholdMs =
      options.stallProgressThresholdMs ?? DEFAULT_STALL_PROGRESS_THRESHOLD_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.graceMs = options.graceMs ?? DEFAULT_GRACE_PERIOD_MS;
    this.maxTailBytes = options.maxTailBytes ?? DEFAULT_DIAGNOSTIC_TAIL_BYTES;

    const initialNow = options.startedAt ?? this.clock();
    this.startedAtMs = initialNow;
    this.lastActivityAtMs = initialNow;
    this.lastProgressAtMs = initialNow;
    this.lastHeartbeatAtMs = initialNow;
  }

  public getSignalsSent(): readonly NodeJS.Signals[] {
    return [...this.recordedSignals];
  }

  public recordActivity(
    channel?: "stdout" | "stderr",
    chunk?: string | Uint8Array,
    bytes?: number,
  ): void {
    const now = this.clock();
    this.lastActivityAtMs = now;

    if (chunk !== undefined) {
      const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      const byteLen =
        bytes ?? (typeof chunk === "string" ? Buffer.byteLength(chunk, "utf8") : chunk.byteLength);

      if (channel === "stderr") {
        this.totalStderrBytes += byteLen;
        this.stderrChunks.push(text);
        trimChunks(this.stderrChunks, this.maxTailBytes);
      } else {
        this.totalStdoutBytes += byteLen;
        this.stdoutChunks.push(text);
        trimChunks(this.stdoutChunks, this.maxTailBytes);
      }
    }
  }

  public recordProgress(_description?: string): void {
    const now = this.clock();
    this.lastProgressAtMs = now;
    this.lastActivityAtMs = now;
  }

  public emitHeartbeat(_metadata?: Readonly<Record<string, unknown>>): {
    timestamp: string;
    heartbeatCount: number;
  } {
    const now = this.clock();
    this.lastHeartbeatAtMs = now;
    this.heartbeatCountValue += 1;
    return {
      timestamp: new Date(now).toISOString(),
      heartbeatCount: this.heartbeatCountValue,
    };
  }

  public getDiagnostics(nowMs?: number): ProcessDiagnostics {
    const now = nowMs ?? this.clock();
    return buildProcessDiagnostics({
      stdoutChunks: this.stdoutChunks,
      stderrChunks: this.stderrChunks,
      totalStdoutBytes: this.totalStdoutBytes,
      totalStderrBytes: this.totalStderrBytes,
      maxTailBytes: this.maxTailBytes,
      startedAtMs: this.startedAtMs,
      lastActivityAtMs: this.lastActivityAtMs,
      lastProgressAtMs: this.lastProgressAtMs,
      lastHeartbeatAtMs: this.lastHeartbeatAtMs,
      signalsSent: this.recordedSignals,
      pid: this.pid,
      ppid: this.ppid,
      nowMs: now,
    });
  }

  public checkLiveness(nowMs?: number): WatchdogLivenessReport {
    const now = nowMs ?? this.clock();
    return evaluateProcessLiveness({
      startedAtMs: this.startedAtMs,
      lastActivityAtMs: this.lastActivityAtMs,
      lastProgressAtMs: this.lastProgressAtMs,
      wallTimeoutMs: this.wallTimeoutMs,
      idleTimeoutMs: this.idleTimeoutMs,
      stallProgressThresholdMs: this.stallProgressThresholdMs,
      nowMs: now,
    });
  }

  public async enforceSigkill(
    options: {
      graceMs?: number | undefined;
      pid?: number | undefined;
    } = {},
  ): Promise<readonly NodeJS.Signals[]> {
    const targetPid = options.pid ?? this.pid;
    const grace = options.graceMs ?? this.graceMs;
    return executeSignalEscalation(
      targetPid,
      grace,
      this.recordedSignals,
      this.killFn,
      this.waitFn,
    );
  }

  public synthesizeFailurePayload(params: {
    exitStatus?: ExitStatus | string;
    errorClassification?: ErrorClassification | string;
    reason: string;
    defectReference?: "defect-20260822-24" | "defect-20260822-28" | string;
    now?: number;
  }): StructuredFailurePayload {
    const now = params.now ?? this.clock();
    const classification = params.errorClassification ?? ERROR_CLASS_STALL_TIMEOUT;
    const exitStatus = params.exitStatus ?? EXIT_STATUS_SIGKILL_TIMEOUT;

    const diagnostics = this.getDiagnostics(now);
    const guidance = buildRemediationGuidance({
      role: this.childRole,
      supervisorTier: this.supervisorTier,
      errorClassification: classification,
      defectReference: params.defectReference,
      taskId: this.taskId,
    });

    return {
      schema: "harness.structured_failure_payload",
      version: 1,
      exitStatus,
      errorClassification: classification,
      reason: params.reason,
      taskId: this.taskId ?? null,
      gateId: this.gateId ?? null,
      agentId: this.agentId ?? null,
      supervisorTier: this.supervisorTier,
      childRole: this.childRole,
      ...(this.pid !== undefined ? { childPid: this.pid } : {}),
      diagnostics,
      remediationGuidance: guidance,
      timestamp: new Date(now).toISOString(),
    };
  }

  public async monitorSubprocess(
    subprocess: BunSubprocess,
    onHeartbeat?: () => void,
    signal?: AbortSignal,
  ): Promise<WatchdogMonitorResult> {
    return monitorSubprocessLoop(this, subprocess, onHeartbeat, signal);
  }
}

export function createProcessTimeoutWatchdog(
  options: ProcessWatchdogOptions = {},
): ProcessTimeoutWatchdog {
  return new ProcessTimeoutWatchdog(options);
}
