export const DEFAULT_TEST_WALL_TIMEOUT_MS = 60_000;
export const DEFAULT_TEST_IDLE_TIMEOUT_MS = 30_000;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000;
export const DEFAULT_STALL_PROGRESS_THRESHOLD_MS = 60_000;
export const DEFAULT_GRACE_PERIOD_MS = 1_000;
export const DEFAULT_DIAGNOSTIC_TAIL_BYTES = 64 * 1024;

export const EXIT_STATUS_SIGKILL_TIMEOUT = "SIGKILL_TIMEOUT";
export const EXIT_STATUS_SIGTERM_TIMEOUT = "SIGTERM_TIMEOUT";
export const EXIT_STATUS_SIGKILL_MANUAL = "SIGKILL_MANUAL";
export const EXIT_STATUS_EXIT_FAILURE = "EXIT_FAILURE";
export const EXIT_STATUS_EXIT_SUCCESS = "EXIT_SUCCESS";

export const ERROR_CLASS_STALL_TIMEOUT = "STALL_TIMEOUT";
export const ERROR_CLASS_WALL_TIMEOUT = "WALL_TIMEOUT";
export const ERROR_CLASS_IDLE_TIMEOUT = "IDLE_TIMEOUT";
export const ERROR_CLASS_PROCESS_HANG = "PROCESS_HANG";
export const ERROR_CLASS_ZOMBIE_PROCESS = "ZOMBIE_PROCESS";

export type SupervisorTier = "mind" | "orchestrator" | "coordinator" | "implementer" | "critic";

export type HierarchicalRole =
  | "mind"
  | "orchestrator"
  | "coordinator"
  | "task_implementer"
  | "completeness_critic"
  | "implementer"
  | "critic"
  | "worker";

export type WatchdogTimeoutKind = "idle" | "wall" | "stall" | "zombie";

export type ErrorClassification =
  | "STALL_TIMEOUT"
  | "WALL_TIMEOUT"
  | "IDLE_TIMEOUT"
  | "PROCESS_HANG"
  | "ZOMBIE_PROCESS";

export type ExitStatus =
  | "SIGKILL_TIMEOUT"
  | "SIGTERM_TIMEOUT"
  | "SIGKILL_MANUAL"
  | "EXIT_FAILURE"
  | "EXIT_SUCCESS";

export interface BunSubprocess {
  readonly pid: number;
  readonly exited: Promise<number>;
  readonly stdout?: ReadableStream<Uint8Array> | null;
  readonly stderr?: ReadableStream<Uint8Array> | null;
}

export interface ProcessDiagnostics {
  readonly stdoutTail: string;
  readonly stderrTail: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly lastActivityAt: string | null;
  readonly lastProgressAt: string | null;
  readonly lastHeartbeatAt: string | null;
  readonly durationMs: number;
  readonly idleDurationMs: number;
  readonly progressStallDurationMs: number;
  readonly pid?: number;
  readonly ppid?: number;
  readonly signalsSent: readonly NodeJS.Signals[];
}

export interface RemediationGuidance {
  readonly action:
    | "autonomous_repair_routing"
    | "retry_with_backoff"
    | "escalate_to_supervisor"
    | "reassign_scope";
  readonly summary: string;
  readonly prescribedSteps: readonly string[];
  readonly blunderReference: "blunder-20260822-24" | "blunder-20260822-28" | string;
  readonly supervisorTarget?: string;
  readonly fallbackDirective?: string;
}

export interface StructuredFailurePayload {
  readonly schema: "harness.structured_failure_payload";
  readonly version: 1;
  readonly exitStatus: ExitStatus | string;
  readonly errorClassification: ErrorClassification | string;
  readonly reason: string;
  readonly taskId?: string | null;
  readonly gateId?: string | null;
  readonly agentId?: string | null;
  readonly supervisorTier?: SupervisorTier | string;
  readonly childRole?: HierarchicalRole | string;
  readonly childPid?: number;
  readonly diagnostics: ProcessDiagnostics;
  readonly remediationGuidance: RemediationGuidance;
  readonly timestamp: string;
}

export interface ProcessWatchdogOptions {
  readonly pid?: number | undefined;
  readonly ppid?: number | undefined;
  readonly taskId?: string | undefined;
  readonly gateId?: string | undefined;
  readonly agentId?: string | undefined;
  readonly supervisorTier?: SupervisorTier | undefined;
  readonly childRole?: HierarchicalRole | undefined;
  readonly wallTimeoutMs?: number | undefined;
  readonly idleTimeoutMs?: number | undefined;
  readonly stallProgressThresholdMs?: number | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly graceMs?: number | undefined;
  readonly maxTailBytes?: number | undefined;
  readonly startedAt?: number | undefined;
  readonly killProcessTree?: (pid: number, signal: NodeJS.Signals) => boolean;
  readonly wait?: (milliseconds: number) => Promise<unknown>;
  readonly now?: () => number;
}

export interface WatchdogLivenessReport {
  readonly alive: boolean;
  readonly timedOut: boolean;
  readonly stalled: boolean;
  readonly timeoutKind: WatchdogTimeoutKind | null;
  readonly errorClassification?: ErrorClassification;
  readonly reason?: string;
}

export interface WatchdogMonitorResult {
  readonly outcome: "exit" | "timeout" | "stall" | "interrupted";
  readonly exitCode: number | null;
  readonly failurePayload?: StructuredFailurePayload;
  readonly signalsSent: readonly NodeJS.Signals[];
}

export interface ChildNodeInfo {
  readonly childId: string;
  readonly role: HierarchicalRole | string;
  readonly supervisorTier: SupervisorTier | string;
  readonly pid?: number;
  readonly ppid?: number;
  readonly taskId?: string;
  readonly gateId?: string;
  readonly agentId?: string;
  readonly wallTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly stallProgressThresholdMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly graceMs?: number;
  readonly startedAt?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ProbeResult {
  readonly childId: string;
  readonly role: HierarchicalRole | string;
  readonly supervisorTier: SupervisorTier | string;
  readonly pid?: number | undefined;
  readonly alive: boolean;
  readonly stalled: boolean;
  readonly timedOut: boolean;
  readonly reason?: string | undefined;
  readonly errorClassification?: ErrorClassification | undefined;
  readonly lastHeartbeatAgeMs: number;
  readonly lastProgressAgeMs: number;
  readonly durationMs: number;
  readonly failurePayload?: StructuredFailurePayload | undefined;
}

export interface HierarchicalStallProbeOptions {
  readonly supervisorTier: SupervisorTier;
  readonly supervisorId?: string;
  readonly defaultWallTimeoutMs?: number;
  readonly defaultIdleTimeoutMs?: number;
  readonly defaultStallThresholdMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly graceMs?: number;
  readonly maxTailBytes?: number;
  readonly now?: () => number;
  readonly killProcessTree?: (pid: number, signal: NodeJS.Signals) => boolean;
  readonly wait?: (milliseconds: number) => Promise<unknown>;
}

export function buildRemediationGuidance(params: {
  role?: HierarchicalRole | string | undefined;
  supervisorTier?: SupervisorTier | string | undefined;
  errorClassification: ErrorClassification | string;
  blunderReference?: "blunder-20260822-24" | "blunder-20260822-28" | string | undefined;
  taskId?: string | null | undefined;
}): RemediationGuidance {
  const role = typeof params.role === "string" ? params.role : "worker";
  const isCritic = role === "completeness_critic" || role === "critic";
  const isImplementer = role === "task_implementer" || role === "implementer" || role === "worker";
  const isCoordinator = role === "coordinator";
  const isOrchestrator = role === "orchestrator";

  if (isCritic) {
    return {
      action: "autonomous_repair_routing",
      summary:
        "Stalled completeness critic / test gate execution detected. SIGKILL enforced on zombie process tree; route failure payload to supervising Coordinator for scoped remediation.",
      prescribedSteps: [
        "Enforce SIGKILL on stalled test runner / critic subprocess tree immediately.",
        "Synthesize structured execution failure payload with exit status SIGKILL_TIMEOUT and error classification STALL_TIMEOUT.",
        "Capture pre-termination stdout/stderr diagnostics to isolate the hanging test or infinite loop.",
        "Notify supervising Coordinator with structured failure payload to trigger autonomous repair loop.",
        "Enforce strict scoped single-file test re-execution (bun test tests/unit/<path>.test.ts) without full test suite runs.",
      ],
      blunderReference:
        typeof params.blunderReference === "string"
          ? params.blunderReference
          : "blunder-20260822-24",
      supervisorTarget: "coordinator",
      fallbackDirective: "Re-run only single-file scoped unit test; ban full test suite execution.",
    };
  }

  if (isImplementer) {
    return {
      action: "autonomous_repair_routing",
      summary:
        "Stalled task implementer execution detected. Terminate hung process tree via SIGKILL and route diagnostic payload to Coordinator for autonomous repair dispatch.",
      prescribedSteps: [
        "Terminate hung subagent subprocess tree via SIGKILL.",
        "Synthesize execution failure payload with exit status SIGKILL_TIMEOUT and error classification STALL_TIMEOUT.",
        "Extract pre-termination stdout/stderr diagnostic tail leading up to hang.",
        "Route structured diagnostic payload to supervising Coordinator to trigger autonomous repair/retry loop.",
        "Re-dispatch implementer with bounded timeout limits and verified leased file scopes.",
      ],
      blunderReference:
        typeof params.blunderReference === "string"
          ? params.blunderReference
          : "blunder-20260822-28",
      supervisorTarget: "coordinator",
      fallbackDirective: "Reassign task with tightened scope or fresh subagent worker.",
    };
  }

  if (isCoordinator) {
    return {
      action: "escalate_to_supervisor",
      summary: "Stalled coordinator execution detected by Orchestrator supervisory health probe.",
      prescribedSteps: [
        "Terminate stalled coordinator execution context.",
        "Synthesize execution failure payload with classification STALL_TIMEOUT.",
        "Orchestrator evaluates active wave lane state and rebalances pending task assignments.",
        "Re-dispatch coordinator with refreshed domain context packet.",
      ],
      blunderReference:
        typeof params.blunderReference === "string"
          ? params.blunderReference
          : "blunder-20260822-24",
      supervisorTarget: "orchestrator",
      fallbackDirective: "Orchestrator assumes direct lane coordination or splits domain tasks.",
    };
  }

  if (isOrchestrator) {
    return {
      action: "escalate_to_supervisor",
      summary: "Stalled orchestrator execution detected by Mind supervisory health probe.",
      prescribedSteps: [
        "Terminate stalled orchestrator execution context.",
        "Synthesize execution failure payload with classification STALL_TIMEOUT.",
        "Mind re-plans domain wave partitioning and dispatches fresh orchestrator track.",
      ],
      blunderReference:
        typeof params.blunderReference === "string"
          ? params.blunderReference
          : "blunder-20260822-24",
      supervisorTarget: "mind",
      fallbackDirective: "Mind initiates autonomous wave replanning and lane repartitioning.",
    };
  }

  return {
    action: "autonomous_repair_routing",
    summary: "Mechanical process timeout watchdog detected execution stall / timeout.",
    prescribedSteps: [
      "Terminate zombie process tree via SIGKILL.",
      "Capture stdout/stderr diagnostics up to moment of termination.",
      "Synthesize structured failure payload with exit status SIGKILL_TIMEOUT.",
      "Notify supervising tier to initiate autonomous recovery.",
    ],
    blunderReference:
      typeof params.blunderReference === "string" ? params.blunderReference : "blunder-20260822-28",
    supervisorTarget:
      typeof params.supervisorTier === "string" ? params.supervisorTier : "coordinator",
  };
}

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
        reason: `Process idle timeout exceeded: no activity for ${idleDuration}ms >= ${this.idleTimeoutMs}ms limit`,
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
    options: {
      graceMs?: number | undefined;
      pid?: number | undefined;
    } = {},
  ): Promise<readonly NodeJS.Signals[]> {
    const targetPid = options.pid ?? this.pid;
    if (targetPid === undefined || !Number.isSafeInteger(targetPid) || targetPid <= 1) {
      return [...this.recordedSignals];
    }

    const grace = options.graceMs ?? this.graceMs;

    if (grace > 0) {
      try {
        const termDelivered = this.killFn(targetPid, "SIGTERM");
        if (termDelivered) {
          this.recordedSignals.push("SIGTERM");
        }
      } catch {
        // ESRCH or other error ignored
      }
      await this.waitFn(grace);
    }

    try {
      const killDelivered = this.killFn(targetPid, "SIGKILL");
      if (killDelivered) {
        this.recordedSignals.push("SIGKILL");
      }
    } catch {
      // ESRCH or other error ignored
    }

    return [...this.recordedSignals];
  }

  public synthesizeFailurePayload(params: {
    exitStatus?: ExitStatus | string;
    errorClassification?: ErrorClassification | string;
    reason: string;
    blunderReference?: "blunder-20260822-24" | "blunder-20260822-28" | string;
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
      blunderReference: params.blunderReference,
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
}

export class HierarchicalStallProbe {
  public readonly supervisorTier: SupervisorTier;
  public readonly supervisorId?: string | undefined;
  public readonly defaultWallTimeoutMs: number;
  public readonly defaultIdleTimeoutMs: number;
  public readonly defaultStallThresholdMs: number;
  public readonly heartbeatIntervalMs: number;
  public readonly graceMs: number;
  public readonly maxTailBytes: number;

  private readonly clock: () => number;
  private readonly killFn: (pid: number, signal: NodeJS.Signals) => boolean;
  private readonly waitFn: (milliseconds: number) => Promise<unknown>;

  private readonly children = new Map<string, ChildNodeInfo>();
  private readonly watchdogs = new Map<string, ProcessTimeoutWatchdog>();

  public constructor(options: HierarchicalStallProbeOptions) {
    this.supervisorTier = options.supervisorTier;
    this.supervisorId = options.supervisorId;
    this.defaultWallTimeoutMs = options.defaultWallTimeoutMs ?? DEFAULT_TEST_WALL_TIMEOUT_MS;
    this.defaultIdleTimeoutMs = options.defaultIdleTimeoutMs ?? DEFAULT_TEST_IDLE_TIMEOUT_MS;
    this.defaultStallThresholdMs =
      options.defaultStallThresholdMs ?? DEFAULT_STALL_PROGRESS_THRESHOLD_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.graceMs = options.graceMs ?? DEFAULT_GRACE_PERIOD_MS;
    this.maxTailBytes = options.maxTailBytes ?? DEFAULT_DIAGNOSTIC_TAIL_BYTES;

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
  }

  public registerChild(child: ChildNodeInfo): ProcessTimeoutWatchdog {
    this.children.set(child.childId, child);

    const watchdog = new ProcessTimeoutWatchdog({
      pid: child.pid,
      ppid: child.ppid,
      taskId: child.taskId,
      gateId: child.gateId,
      agentId: child.agentId,
      supervisorTier: this.supervisorTier,
      childRole: child.role as HierarchicalRole,
      wallTimeoutMs: child.wallTimeoutMs ?? this.defaultWallTimeoutMs,
      idleTimeoutMs: child.idleTimeoutMs ?? this.defaultIdleTimeoutMs,
      stallProgressThresholdMs: child.stallProgressThresholdMs ?? this.defaultStallThresholdMs,
      heartbeatIntervalMs: child.heartbeatIntervalMs ?? this.heartbeatIntervalMs,
      graceMs: child.graceMs ?? this.graceMs,
      maxTailBytes: this.maxTailBytes,
      startedAt: child.startedAt ?? this.clock(),
      killProcessTree: this.killFn,
      wait: this.waitFn,
      now: this.clock,
    });

    this.watchdogs.set(child.childId, watchdog);
    return watchdog;
  }

  public unregisterChild(childId: string): boolean {
    const deletedChild = this.children.delete(childId);
    this.watchdogs.delete(childId);
    return deletedChild;
  }

  public getChild(childId: string): ChildNodeInfo | undefined {
    return this.children.get(childId);
  }

  public getChildWatchdog(childId: string): ProcessTimeoutWatchdog | undefined {
    return this.watchdogs.get(childId);
  }

  public listChildren(): readonly ChildNodeInfo[] {
    return Array.from(this.children.values());
  }

  public recordChildHeartbeat(childId: string, metadata?: Readonly<Record<string, unknown>>): void {
    const wd = this.watchdogs.get(childId);
    if (wd) {
      wd.emitHeartbeat(metadata);
    }
  }

  public recordChildProgress(childId: string, description?: string): void {
    const wd = this.watchdogs.get(childId);
    if (wd) {
      wd.recordProgress(description);
    }
  }

  public recordChildOutput(
    childId: string,
    channel: "stdout" | "stderr",
    chunk: string | Uint8Array,
    bytes?: number,
  ): void {
    const wd = this.watchdogs.get(childId);
    if (wd) {
      wd.recordActivity(channel, chunk, bytes);
    }
  }

  public probeChild(childId: string, nowMs?: number): ProbeResult {
    const now = nowMs ?? this.clock();
    const child = this.children.get(childId);
    const wd = this.watchdogs.get(childId);

    if (!child || !wd) {
      return {
        childId,
        role: "worker",
        supervisorTier: this.supervisorTier,
        alive: false,
        stalled: true,
        timedOut: false,
        reason: `Child ${childId} is not registered in stall probe registry`,
        errorClassification: ERROR_CLASS_ZOMBIE_PROCESS,
        lastHeartbeatAgeMs: 0,
        lastProgressAgeMs: 0,
        durationMs: 0,
      };
    }

    const diag = wd.getDiagnostics(now);
    const liveness = wd.checkLiveness(now);

    let failurePayload: StructuredFailurePayload | undefined;
    if (!liveness.alive) {
      failurePayload = wd.synthesizeFailurePayload({
        exitStatus: EXIT_STATUS_SIGKILL_TIMEOUT,
        errorClassification: liveness.errorClassification ?? ERROR_CLASS_STALL_TIMEOUT,
        reason: liveness.reason ?? `Child ${childId} stalled / timed out during execution`,
        now,
      });
    }

    return {
      childId,
      role: child.role,
      supervisorTier: this.supervisorTier,
      pid: child.pid,
      alive: liveness.alive,
      stalled: liveness.stalled,
      timedOut: liveness.timedOut,
      reason: liveness.reason,
      errorClassification: liveness.errorClassification,
      lastHeartbeatAgeMs: diag.idleDurationMs,
      lastProgressAgeMs: diag.progressStallDurationMs,
      durationMs: diag.durationMs,
      failurePayload,
    };
  }

  public probeAll(nowMs?: number): readonly ProbeResult[] {
    const now = nowMs ?? this.clock();
    const results: ProbeResult[] = [];
    for (const childId of this.children.keys()) {
      results.push(this.probeChild(childId, now));
    }
    return results;
  }

  public detectStalledChildren(nowMs?: number): readonly ProbeResult[] {
    return this.probeAll(nowMs).filter((p) => p.stalled || p.timedOut || !p.alive);
  }

  public synthesizeStallFailurePayload(
    childId: string,
    reason?: string,
    nowMs?: number,
  ): StructuredFailurePayload {
    const now = nowMs ?? this.clock();
    const child = this.children.get(childId);
    const wd = this.watchdogs.get(childId);

    if (wd) {
      return wd.synthesizeFailurePayload({
        exitStatus: EXIT_STATUS_SIGKILL_TIMEOUT,
        errorClassification: ERROR_CLASS_STALL_TIMEOUT,
        reason: reason ?? `Child ${childId} execution stalled; detected by supervisory probe`,
        now,
      });
    }

    const fallbackGuidance = buildRemediationGuidance({
      role: typeof child?.role === "string" ? child.role : "worker",
      supervisorTier: this.supervisorTier,
      errorClassification: ERROR_CLASS_STALL_TIMEOUT,
      taskId: child?.taskId,
    });

    return {
      schema: "harness.structured_failure_payload",
      version: 1,
      exitStatus: EXIT_STATUS_SIGKILL_TIMEOUT,
      errorClassification: ERROR_CLASS_STALL_TIMEOUT,
      reason: reason ?? `Child ${childId} execution stalled; detected by supervisory probe`,
      taskId: child?.taskId ?? null,
      gateId: child?.gateId ?? null,
      agentId: child?.agentId ?? null,
      supervisorTier: this.supervisorTier,
      childRole: typeof child?.role === "string" ? child.role : "worker",
      ...(child?.pid !== undefined ? { childPid: child.pid } : {}),
      diagnostics: {
        stdoutTail: "",
        stderrTail: "",
        stdoutBytes: 0,
        stderrBytes: 0,
        lastActivityAt: null,
        lastProgressAt: null,
        lastHeartbeatAt: null,
        durationMs: 0,
        idleDurationMs: 0,
        progressStallDurationMs: 0,
        signalsSent: ["SIGKILL"],
      },
      remediationGuidance: fallbackGuidance,
      timestamp: new Date(now).toISOString(),
    };
  }

  public async handleChildStall(
    childId: string,
    options: { enforceSigkill?: boolean | undefined; graceMs?: number | undefined } = {},
  ): Promise<StructuredFailurePayload> {
    const wd = this.watchdogs.get(childId);
    const enforce = options.enforceSigkill !== false;

    if (wd && enforce) {
      await wd.enforceSigkill({ graceMs: options.graceMs });
    }

    const payload = this.synthesizeStallFailurePayload(childId);
    this.unregisterChild(childId);
    return payload;
  }
}

export function createProcessTimeoutWatchdog(
  options: ProcessWatchdogOptions = {},
): ProcessTimeoutWatchdog {
  return new ProcessTimeoutWatchdog(options);
}

export function createHierarchicalStallProbe(
  supervisorTier: SupervisorTier,
  options: Partial<HierarchicalStallProbeOptions> = {},
): HierarchicalStallProbe {
  return new HierarchicalStallProbe({
    supervisorTier,
    ...options,
  });
}
