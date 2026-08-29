import type { BunSubprocess } from "../types/types.ts";
import { DEFAULT_TEST_WALL_TIMEOUT_MS, DEFAULT_TEST_IDLE_TIMEOUT_MS } from "../core/policy.ts";
import { buildRemediationGuidance } from "./watchdog-remediation.ts";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_STALL_PROGRESS_THRESHOLD_MS,
  DEFAULT_GRACE_PERIOD_MS,
  DEFAULT_DIAGNOSTIC_TAIL_BYTES,
  EXIT_STATUS_SIGKILL_TIMEOUT,
  ERROR_CLASS_STALL_TIMEOUT,
  ERROR_CLASS_WALL_TIMEOUT,
  ERROR_CLASS_IDLE_TIMEOUT,
  ERROR_CLASS_PROCESS_HANG,
  type SupervisorTier,
  type HierarchicalRole,
  type ProcessDiagnostics,
  type StructuredFailurePayload,
  type ProcessWatchdogOptions,
  type WatchdogLivenessReport,
  type WatchdogMonitorResult,
} from "./watchdog-types.ts";

export {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_STALL_PROGRESS_THRESHOLD_MS,
  DEFAULT_GRACE_PERIOD_MS,
  DEFAULT_DIAGNOSTIC_TAIL_BYTES,
  EXIT_STATUS_SIGKILL_TIMEOUT,
  EXIT_STATUS_SIGTERM_TIMEOUT,
  EXIT_STATUS_EXIT_FAILURE,
  EXIT_STATUS_EXIT_SUCCESS,
  ERROR_CLASS_STALL_TIMEOUT,
  ERROR_CLASS_WALL_TIMEOUT,
  ERROR_CLASS_IDLE_TIMEOUT,
  ERROR_CLASS_PROCESS_HANG,
  ERROR_CLASS_ZOMBIE_PROCESS,
  type SupervisorTier,
  type HierarchicalRole,
  type WatchdogTimeoutKind,
  type ErrorClassification,
  type ExitStatus,
  type ProcessDiagnostics,
  type RemediationGuidance,
  type StructuredFailurePayload,
  type ProcessWatchdogOptions,
  type WatchdogLivenessReport,
  type WatchdogMonitorResult,
  type ChildNodeInfo,
  type ProbeResult,
  type HierarchicalStallProbeOptions,
} from "./watchdog-types.ts";

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
  private heartbeatCountValue: number = 0;

  private stdoutChunks: string[] = [];
  private stderrChunks: string[] = [];
  private totalStdoutBytes: number = 0;
  private totalStderrBytes: number = 0;
  private recordedSignals: NodeJS.Signals[] = [];

  public constructor(options: ProcessWatchdogOptions = {}) {
    this.clock = options.now ?? (() => Date.now());
    this.killFn =
      options.killProcessTree ??
      ((pid, sig) => {
        try {
          process.kill(pid, sig);
          return true;
        } catch {
          return false;
        }
      });
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
        this.trimBuffer(this.stderrChunks);
      } else {
        this.totalStdoutBytes += byteLen;
        this.stdoutChunks.push(text);
        this.trimBuffer(this.stdoutChunks);
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

  private trimBuffer(chunks: string[]): void {
    let combinedLength = 0;
    for (let i = chunks.length - 1; i >= 0; i--) {
      const chunk = chunks[i];
      if (chunk !== undefined) {
        combinedLength += chunk.length;
        if (combinedLength > this.maxTailBytes && i > 0) {
          chunks.splice(0, i);
          break;
        }
      }
    }
  }

  public getDiagnostics(nowMs?: number): ProcessDiagnostics {
    const now = nowMs ?? this.clock();
    const stdoutTail = this.stdoutChunks.join("").slice(-this.maxTailBytes);
    const stderrTail = this.stderrChunks.join("").slice(-this.maxTailBytes);

    return {
      stdoutTail,
      stderrTail,
      stdoutBytes: this.totalStdoutBytes,
      stderrBytes: this.totalStderrBytes,
      lastActivityAt: new Date(this.lastActivityAtMs).toISOString(),
      lastProgressAt: new Date(this.lastProgressAtMs).toISOString(),
      lastHeartbeatAt: new Date(this.lastHeartbeatAtMs).toISOString(),
      durationMs: Math.max(0, now - this.startedAtMs),
      idleDurationMs: Math.max(0, now - this.lastActivityAtMs),
      progressStallDurationMs: Math.max(0, now - this.lastProgressAtMs),
      ...(this.pid !== undefined ? { pid: this.pid } : {}),
      ...(this.ppid !== undefined ? { ppid: this.ppid } : {}),
      signalsSent: [...this.recordedSignals],
    };
  }

  public checkLiveness(nowMs?: number): WatchdogLivenessReport {
    const now = nowMs ?? this.clock();
    const duration = now - this.startedAtMs;
    const idleDuration = now - this.lastActivityAtMs;
    const stallDuration = now - this.lastProgressAtMs;

    if (duration >= this.wallTimeoutMs) {
      return {
        alive: false,
        timedOut: true,
        stalled: true,
        timeoutKind: "wall",
        errorClassification: ERROR_CLASS_WALL_TIMEOUT,
        reason: `Process wall timeout exceeded: execution duration ${duration}ms >= ${this.wallTimeoutMs}ms limit`,
      };
    }

    if (idleDuration >= this.idleTimeoutMs) {
      return {
        alive: false,
        timedOut: true,
        stalled: true,
        timeoutKind: "idle",
        errorClassification: ERROR_CLASS_IDLE_TIMEOUT,
        reason: `Process idle timeout exceeded: no output activity for ${idleDuration}ms >= ${this.idleTimeoutMs}ms limit`,
      };
    }

    if (stallDuration >= this.stallProgressThresholdMs) {
      return {
        alive: false,
        timedOut: true,
        stalled: true,
        timeoutKind: "stall",
        errorClassification: ERROR_CLASS_STALL_TIMEOUT,
        reason: `Process stall detected: 0 progress recorded for ${stallDuration}ms >= ${this.stallProgressThresholdMs}ms threshold`,
      };
    }

    return {
      alive: true,
      timedOut: false,
      stalled: false,
      timeoutKind: null,
    };
  }

  public async enforceSigkill(
    options: { graceMs?: number | undefined } = {},
  ): Promise<NodeJS.Signals[]> {
    if (this.pid === undefined || this.pid <= 1) return [];
    const signalsSent: NodeJS.Signals[] = [];
    const grace = options.graceMs !== undefined ? options.graceMs : this.graceMs;

    if (grace > 0) {
      try {
        this.recordedSignals.push("SIGTERM");
        signalsSent.push("SIGTERM");
        this.killFn(this.pid, "SIGTERM");
      } catch {
        // Best effort
      }
      await this.waitFn(grace);
    }

    try {
      this.recordedSignals.push("SIGKILL");
      signalsSent.push("SIGKILL");
      this.killFn(this.pid, "SIGKILL");
    } catch {
      // Best effort
    }
    return signalsSent;
  }

  public synthesizeFailurePayload(
    options: {
      exitStatus?: string;
      errorClassification?: string;
      reason?: string;
      defectReference?: string;
      now?: number;
    } = {},
  ): StructuredFailurePayload {
    const now = options.now ?? this.clock();
    const diag = this.getDiagnostics(now);
    const classification = options.errorClassification ?? ERROR_CLASS_STALL_TIMEOUT;
    const guidance = buildRemediationGuidance({
      supervisorTier: this.supervisorTier,
      childRole: this.childRole,
      errorClassification: classification,
      taskId: this.taskId,
      gateId: this.gateId,
      defectReference: options.defectReference,
    });

    return {
      schema: "harness.structured_failure_payload",
      version: 1,
      exitStatus: options.exitStatus ?? EXIT_STATUS_SIGKILL_TIMEOUT,
      errorClassification: classification,
      reason:
        options.reason ??
        `Process execution terminated by watchdog due to ${classification} constraint violation`,
      taskId: this.taskId ?? null,
      gateId: this.gateId ?? null,
      agentId: this.agentId ?? null,
      supervisorTier: this.supervisorTier,
      childRole: this.childRole,
      childPid: this.pid,
      diagnostics: diag,
      remediationGuidance: guidance,
      timestamp: new Date(now).toISOString(),
    };
  }

  public async monitor(
    subprocess: BunSubprocess,
    signal?: AbortSignal,
    onHeartbeat?: () => void,
  ): Promise<WatchdogMonitorResult> {
    const pollInterval = Math.min(
      50,
      Math.max(
        5,
        Math.floor(
          Math.min(this.wallTimeoutMs, this.idleTimeoutMs, this.stallProgressThresholdMs) / 4,
        ),
      ),
    );

    const exitedPromise = subprocess.exited.then((code) => ({
      kind: "exit" as const,
      code,
    }));

    const interruptedPromise = new Promise<{ kind: "interrupted" }>((resolve) => {
      if (signal?.aborted) {
        resolve({ kind: "interrupted" });
      } else {
        signal?.addEventListener("abort", () => resolve({ kind: "interrupted" }), {
          once: true,
        });
      }
    });

    const sleep = (ms: number) =>
      new Promise<"tick">((resolve) => setTimeout(() => resolve("tick"), ms));

    while (true) {
      const step = await Promise.race([exitedPromise, interruptedPromise, sleep(pollInterval)]);

      if (step !== "tick" && step.kind === "exit") {
        return {
          outcome: "exit",
          exitCode: step.code,
          signalsSent: [...this.recordedSignals],
        };
      }

      if (step !== "tick" && step.kind === "interrupted") {
        await this.enforceSigkill();
        const payload = this.synthesizeFailurePayload({
          exitStatus: EXIT_STATUS_SIGKILL_TIMEOUT,
          errorClassification: ERROR_CLASS_PROCESS_HANG,
          reason: "Subprocess execution interrupted by host abort signal",
        });
        return {
          outcome: "interrupted",
          exitCode: null,
          failurePayload: payload,
          signalsSent: [...this.recordedSignals],
        };
      }

      this.emitHeartbeat();
      onHeartbeat?.();

      const liveness = this.checkLiveness();
      if (!liveness.alive) {
        await this.enforceSigkill();
        const payload = this.synthesizeFailurePayload({
          exitStatus: EXIT_STATUS_SIGKILL_TIMEOUT,
          errorClassification: liveness.errorClassification ?? ERROR_CLASS_STALL_TIMEOUT,
          reason:
            typeof liveness.reason === "string"
              ? liveness.reason
              : "Process execution timeout / stall detected by watchdog",
        });

        return {
          outcome: liveness.timeoutKind === "stall" ? "stall" : "timeout",
          exitCode: null,
          failurePayload: payload,
          signalsSent: [...this.recordedSignals],
        };
      }
    }
  }

  public async monitorSubprocess(
    subprocess: BunSubprocess,
    onHeartbeat?: () => void,
    signal?: AbortSignal,
  ): Promise<WatchdogMonitorResult> {
    return this.monitor(subprocess, signal, onHeartbeat);
  }
}

export function createProcessTimeoutWatchdog(
  options: ProcessWatchdogOptions = {},
): ProcessTimeoutWatchdog {
  return new ProcessTimeoutWatchdog(options);
}

export {
  HierarchicalStallProbe,
  createHierarchicalStallProbe,
} from "./hierarchical-probe.ts";

export { buildRemediationGuidance } from "./watchdog-remediation.ts";
