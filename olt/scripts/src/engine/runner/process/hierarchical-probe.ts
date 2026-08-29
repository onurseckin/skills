import { DEFAULT_TEST_WALL_TIMEOUT_MS, DEFAULT_TEST_IDLE_TIMEOUT_MS } from "../core/policy.ts";
import { ProcessTimeoutWatchdog } from "./process-timeout-watchdog.ts";
import { buildRemediationGuidance } from "./watchdog-remediation.ts";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_STALL_PROGRESS_THRESHOLD_MS,
  DEFAULT_GRACE_PERIOD_MS,
  DEFAULT_DIAGNOSTIC_TAIL_BYTES,
  EXIT_STATUS_SIGKILL_TIMEOUT,
  ERROR_CLASS_STALL_TIMEOUT,
  ERROR_CLASS_ZOMBIE_PROCESS,
  type SupervisorTier,
  type HierarchicalRole,
  type StructuredFailurePayload,
  type ChildNodeInfo,
  type ProbeResult,
  type HierarchicalStallProbeOptions,
} from "./watchdog-types.ts";

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
      });
    }

    const fallbackGuidance = buildRemediationGuidance({
      childRole: (typeof child?.role === "string" ? child.role : "worker") as HierarchicalRole,
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
      await wd.enforceSigkill();
    }

    const payload = this.synthesizeStallFailurePayload(childId);
    this.unregisterChild(childId);
    return payload;
  }
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
