import { existsSync } from "node:fs";
import { loadRun } from "../store/index.ts";
import { isJsonObject, type JsonObject } from "../contracts/json.ts";
import {
  auditTierConfinement,
  type TierConfinementFinding,
} from "../doctor/tier-confinement.ts";
import { BootGateEnforcer } from "./boot-gate-enforcer.ts";
import {
  DEFAULT_HEALTH_AUDIT_INTERVAL_MS,
  DEFAULT_PROCESS_HEALTH_CHECK_INTERVAL_MS,
  DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS,
  DEFAULT_WATCHDOG_TIMEOUT_MS,
} from "./constants.ts";
import type {
  AutonomicWatchdogConfig,
  LiveCliProof,
  ProcessHealthStatus,
  SubagentBootGateRecord,
  SubagentRegistrationOptions,
  WatchdogEvent,
  WatchdogEventListener,
  WatchdogFinding,
  WatchdogHealthAuditReport,
  WatchdogTickReport,
} from "./types.ts";

export interface AgentActivityState {
  readonly agentId: string;
  readonly taskId: string | null;
  readonly pid?: number | undefined;
  readonly lastHeartbeatAt: number;
  readonly lastActivityAt: number;
  readonly status: "active" | "stalled";
  readonly lastProcessHealth?: ProcessHealthStatus | undefined;
}

function defaultProcessLivenessChecker(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class AutonomicWatchdog {
  public readonly heartbeatIntervalMs: number;
  public readonly timeoutMs: number;
  public readonly healthAuditIntervalMs: number;
  public readonly processHealthCheckIntervalMs: number;
  public readonly capsuleRoot: string | null;
  public readonly generation: number;
  public readonly pulseId: string | null;
  public readonly enforcePreFlightGates: boolean;

  private readonly bootGateEnforcer: BootGateEnforcer;
  private readonly processLivenessChecker: (pid: number) => boolean;
  private readonly activities = new Map<string, AgentActivityState>();
  private readonly listeners = new Map<string, Set<WatchdogEventListener>>();
  private readonly onHeartbeatCallback:
    | ((tick: WatchdogTickReport) => void | Promise<void>)
    | undefined;
  private readonly onHealthAuditCallback:
    | ((audit: WatchdogHealthAuditReport) => void | Promise<void>)
    | undefined;
  private readonly onViolationCallback:
    | ((finding: WatchdogFinding) => void | Promise<void>)
    | undefined;

  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunningState = false;
  private tickCount = 0;
  private startedAtMs: number;
  private readonly hasExplicitInitialStartedAt: boolean;

  public constructor(config: AutonomicWatchdogConfig = {}) {
    this.heartbeatIntervalMs =
      config.heartbeatIntervalMs ?? DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_WATCHDOG_TIMEOUT_MS;
    this.healthAuditIntervalMs =
      config.healthAuditIntervalMs ?? DEFAULT_HEALTH_AUDIT_INTERVAL_MS;
    this.processHealthCheckIntervalMs =
      config.processHealthCheckIntervalMs ?? DEFAULT_PROCESS_HEALTH_CHECK_INTERVAL_MS;
    this.capsuleRoot = config.capsuleRoot ?? null;
    this.generation = config.generation ?? 1;
    this.pulseId = config.pulseId ?? null;
    this.enforcePreFlightGates = config.enforcePreFlightGates !== false;
    this.processLivenessChecker =
      config.processLivenessChecker ?? defaultProcessLivenessChecker;

    this.bootGateEnforcer = new BootGateEnforcer();
    this.onHeartbeatCallback = config.onHeartbeat;
    this.onHealthAuditCallback = config.onHealthAudit;
    this.onViolationCallback = config.onViolation;

    this.hasExplicitInitialStartedAt = config.initialStartedAt !== undefined;
    const parsedInitial =
      typeof config.initialStartedAt === "number"
        ? config.initialStartedAt
        : config.initialStartedAt instanceof Date
          ? config.initialStartedAt.getTime()
          : typeof config.initialStartedAt === "string"
            ? Date.parse(config.initialStartedAt)
            : NaN;
    this.startedAtMs = Number.isFinite(parsedInitial) ? parsedInitial : Date.now();
  }

  public getBootGateEnforcer(): BootGateEnforcer {
    return this.bootGateEnforcer;
  }

  public registerSubagent(
    options: SubagentRegistrationOptions,
    now?: string | number | Date,
  ): SubagentBootGateRecord {
    const timestamp =
      now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    const timeMs =
      typeof now === "number"
        ? now
        : now instanceof Date
          ? now.getTime()
          : typeof now === "string"
            ? Date.parse(now)
            : Date.now();

    const record = this.bootGateEnforcer.registerSpawnedSubagent(options, timestamp);

    if (!this.activities.has(options.agentId)) {
      this.activities.set(options.agentId, {
        agentId: options.agentId,
        taskId: options.taskId ?? null,
        ...(options.pid !== undefined ? { pid: options.pid } : {}),
        lastHeartbeatAt: Number.isFinite(timeMs) ? timeMs : Date.now(),
        lastActivityAt: Number.isFinite(timeMs) ? timeMs : Date.now(),
        status: "active",
      });
    }

    return record;
  }

  public recordWhoami(
    agentId: string,
    now?: string | number | Date,
    proof?: Partial<LiveCliProof>,
  ): SubagentBootGateRecord {
    const timestamp =
      now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    this.recordActivity(agentId, undefined, now);
    return this.bootGateEnforcer.recordWhoamiExecution(agentId, timestamp, proof);
  }

  public recordDoctor(
    agentId: string,
    now?: string | number | Date,
    proof?: Partial<LiveCliProof>,
  ): SubagentBootGateRecord {
    const timestamp =
      now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    this.recordActivity(agentId, undefined, now);
    return this.bootGateEnforcer.recordDoctorExecution(agentId, timestamp, proof);
  }

  public recordCliProof(
    proof: LiveCliProof,
    now?: string | number | Date,
  ): SubagentBootGateRecord | undefined {
    const timestamp =
      now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    this.recordActivity(proof.actor, undefined, now);
    return this.bootGateEnforcer.recordCliProof(proof, timestamp);
  }

  public recordCommand(
    agentId: string,
    argv: readonly string[],
    now?: string | number | Date,
    exitCode?: number,
    pid?: number,
    outputSnippet?: string,
  ): void {
    const timestamp =
      now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    this.recordActivity(agentId, undefined, now);
    this.bootGateEnforcer.recordCommandExecution(
      agentId,
      argv,
      timestamp,
      exitCode,
      pid,
      outputSnippet,
    );
  }

  public recordHeartbeat(
    agentId: string,
    taskId?: string,
    now?: string | number | Date,
  ): void {
    const timeMs =
      typeof now === "number"
        ? now
        : now instanceof Date
          ? now.getTime()
          : typeof now === "string"
            ? Date.parse(now)
            : Date.now();
    const resolvedMs = Number.isFinite(timeMs) ? timeMs : Date.now();

    const existing = this.activities.get(agentId);
    this.activities.set(agentId, {
      agentId,
      taskId: taskId ?? existing?.taskId ?? null,
      ...(existing?.pid !== undefined ? { pid: existing.pid } : {}),
      lastHeartbeatAt: resolvedMs,
      lastActivityAt: resolvedMs,
      status: "active",
      ...(existing?.lastProcessHealth !== undefined
        ? { lastProcessHealth: existing.lastProcessHealth }
        : {}),
    });
  }

  public recordActivity(
    agentId: string,
    taskId?: string,
    now?: string | number | Date,
  ): void {
    const timeMs =
      typeof now === "number"
        ? now
        : now instanceof Date
          ? now.getTime()
          : typeof now === "string"
            ? Date.parse(now)
            : Date.now();
    const resolvedMs = Number.isFinite(timeMs) ? timeMs : Date.now();

    const existing = this.activities.get(agentId);
    this.activities.set(agentId, {
      agentId,
      taskId: taskId ?? existing?.taskId ?? null,
      ...(existing?.pid !== undefined ? { pid: existing.pid } : {}),
      lastHeartbeatAt: existing?.lastHeartbeatAt ?? resolvedMs,
      lastActivityAt: resolvedMs,
      status: "active",
      ...(existing?.lastProcessHealth !== undefined
        ? { lastProcessHealth: existing.lastProcessHealth }
        : {}),
    });
  }

  public checkProcessHealth(
    pid: number,
    agentId?: string,
    now?: string | number | Date,
  ): ProcessHealthStatus {
    const timestamp =
      now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    const alive = this.processLivenessChecker(pid);

    const status: ProcessHealthStatus = {
      pid,
      alive,
      ...(agentId !== undefined ? { agentId } : {}),
      checkedAt: timestamp,
      ...(alive ? {} : { error: `Process ${pid} is not running or has terminated` }),
    };

    if (agentId) {
      this.bootGateEnforcer.updateProcessHealth(agentId, status);
      const existing = this.activities.get(agentId);
      if (existing) {
        this.activities.set(agentId, {
          ...existing,
          pid,
          lastProcessHealth: status,
        });
      }
    }

    return status;
  }

  public auditProcessHealth(
    now?: string | number | Date,
  ): readonly ProcessHealthStatus[] {
    const results: ProcessHealthStatus[] = [];
    const allRecords = this.bootGateEnforcer.getAllRecords();

    for (const rec of allRecords) {
      if (rec.pid !== undefined) {
        const health = this.checkProcessHealth(rec.pid, rec.agentId, now);
        results.push(health);
      }
    }

    for (const act of this.activities.values()) {
      if (act.pid !== undefined && !allRecords.some((r) => r.agentId === act.agentId)) {
        const health = this.checkProcessHealth(act.pid, act.agentId, now);
        results.push(health);
      }
    }

    return results;
  }

  public assertBootGatesPassed(
    agentId: string,
    operationDescription = "performing task operations",
    requireValidProof = false,
  ): void {
    this.bootGateEnforcer.assertBootGatesPassed(
      agentId,
      operationDescription,
      requireValidProof,
    );
  }

  public async runHealthAudit(
    currentTime?: string | number | Date,
  ): Promise<WatchdogHealthAuditReport> {
    const timeMs =
      typeof currentTime === "number"
        ? currentTime
        : currentTime instanceof Date
          ? currentTime.getTime()
          : typeof currentTime === "string"
            ? Date.parse(currentTime)
            : Date.now();
    const resolvedMs = Number.isFinite(timeMs) ? timeMs : Date.now();
    const timestamp = new Date(resolvedMs).toISOString();

    const findings: WatchdogFinding[] = [];

    // 1. Audit Subagents in state if capsuleRoot is present
    let rawState: JsonObject | null = null;
    if (this.capsuleRoot && existsSync(this.capsuleRoot)) {
      try {
        const loaded = loadRun(this.capsuleRoot, false);
        rawState = isJsonObject(loaded.state) ? (loaded.state as JsonObject) : null;
      } catch {
        // Fallback in memory
      }
    }

    if (rawState) {
      this.bootGateEnforcer.auditSubagentBootGatesFromState(rawState, timestamp);
    }

    // 2. Audit Boot Gate compliance
    const allRecords = this.bootGateEnforcer.getAllRecords();
    const bootGateFindings = this.bootGateEnforcer.auditFindings(allRecords, timestamp);
    findings.push(...bootGateFindings);

    const bootGateCompliantCount = allRecords.filter((r) => r.bootGatePassed).length;
    const bootGateViolationsCount = allRecords.length - bootGateCompliantCount;

    // 3. Audit Stalled / Inactive Agents
    let stalledAgentsCount = 0;
    let activeLeasesCount = 0;

    for (const act of this.activities.values()) {
      const elapsedHeartbeat = resolvedMs - act.lastHeartbeatAt;
      const elapsedActivity = resolvedMs - act.lastActivityAt;

      if (elapsedHeartbeat > this.timeoutMs || elapsedActivity > this.timeoutMs) {
        stalledAgentsCount++;
        const finding: WatchdogFinding = {
          id: `finding-stalled-${act.agentId}`,
          agentId: act.agentId,
          taskId: act.taskId ?? undefined,
          violationType: "stalled_agent",
          severity: "critical",
          observation: `Agent "${act.agentId}" has exceeded watchdog heartbeat timeout: ${elapsedHeartbeat}ms without heartbeat (timeout: ${this.timeoutMs}ms)`,
          remediation:
            "Agent appears stalled or unresponsive. Issue an immediate auto-wake pulse or release task lease.",
          timestamp,
          evidence: {
            agentId: act.agentId,
            taskId: act.taskId,
            lastHeartbeatAt: new Date(act.lastHeartbeatAt).toISOString(),
            lastActivityAt: new Date(act.lastActivityAt).toISOString(),
            elapsedHeartbeatMs: elapsedHeartbeat,
            timeoutMs: this.timeoutMs,
          },
        };
        findings.push(finding);
        this.emit({
          type: "stall_detected",
          agentId: act.agentId,
          finding,
        });
      } else {
        activeLeasesCount++;
      }
    }

    // 4. Audit Live Process Health
    let deadProcessesCount = 0;
    for (const rec of allRecords) {
      if (rec.pid !== undefined) {
        const isAlive = this.processLivenessChecker(rec.pid);
        const healthStatus: ProcessHealthStatus = {
          pid: rec.pid,
          alive: isAlive,
          agentId: rec.agentId,
          checkedAt: timestamp,
          ...(isAlive ? {} : { error: `Process PID ${rec.pid} has exited or is unreachable` }),
        };
        this.bootGateEnforcer.updateProcessHealth(rec.agentId, healthStatus);

        if (!isAlive) {
          deadProcessesCount++;
          const finding: WatchdogFinding = {
            id: `finding-proc-health-${rec.agentId}-${rec.pid}`,
            agentId: rec.agentId,
            role: rec.role,
            taskId: rec.taskId ?? undefined,
            violationType: "process_health_failure",
            severity: "critical",
            observation: `Subagent process "${rec.agentId}" (PID ${rec.pid}) has terminated unexpectedly or is dead while task lease / monitoring is active.`,
            remediation:
              "Clean up zombie task lease, reclaim task or dispatch fresh subagent worker.",
            timestamp,
            evidence: {
              agentId: rec.agentId,
              role: rec.role,
              pid: rec.pid,
              alive: false,
              checkedAt: timestamp,
            },
          };
          findings.push(finding);
          this.emit({
            type: "process_failure_detected",
            agentId: rec.agentId,
            pid: rec.pid,
            finding,
          });
        }
      }
    }

    // 5. Audit Tier Confinement if capsuleRoot is available
    let tierViolationsCount = 0;
    if (this.capsuleRoot && existsSync(this.capsuleRoot)) {
      try {
        const tierFindings: TierConfinementFinding[] = auditTierConfinement(
          this.capsuleRoot,
          rawState,
        );
        tierViolationsCount = tierFindings.length;
        for (const tf of tierFindings) {
          findings.push({
            id: `finding-tier-${tf.agent_id}-${tf.violation_type}`,
            agentId: tf.agent_id,
            role: tf.role,
            violationType:
              tf.violation_type === "supervisor_code_contamination"
                ? "supervisor_code_contamination"
                : "tier_confinement_breach",
            severity: tf.severity === "critical" ? "critical" : "important",
            observation: tf.observation,
            remediation: tf.remediation,
            timestamp,
            ...(tf.evidence ? { evidence: tf.evidence } : {}),
          });
        }
      } catch {
        // Continue with local audit
      }
    }

    const healthy =
      bootGateViolationsCount === 0 &&
      stalledAgentsCount === 0 &&
      deadProcessesCount === 0 &&
      tierViolationsCount === 0;

    const summary = healthy
      ? `Autonomic watchdog healthy: ${allRecords.length} subagents compliant, ${activeLeasesCount} active monitors.`
      : `Autonomic watchdog detected issues: ${bootGateViolationsCount} boot-gate violations, ${stalledAgentsCount} stalled agents, ${deadProcessesCount} dead processes, ${tierViolationsCount} tier violations.`;

    const report: WatchdogHealthAuditReport = {
      healthy,
      timestamp,
      activeLeasesCount,
      stalledAgentsCount,
      deadProcessesCount,
      subagentCount: allRecords.length,
      bootGateCompliantCount,
      bootGateViolationsCount,
      tierViolationsCount,
      findings,
      summary,
    };

    this.emit({ type: "health_audit", report });

    if (this.onHealthAuditCallback) {
      await this.onHealthAuditCallback(report);
    }

    for (const finding of findings) {
      if (finding.severity === "critical") {
        this.emit({ type: "critical_violation", finding });
      }
      if (this.onViolationCallback) {
        await this.onViolationCallback(finding);
      }
    }

    return report;
  }

  public async tick(
    currentTime?: string | number | Date,
  ): Promise<WatchdogTickReport> {
    this.tickCount++;
    const timeMs =
      typeof currentTime === "number"
        ? currentTime
        : currentTime instanceof Date
          ? currentTime.getTime()
          : typeof currentTime === "string"
            ? Date.parse(currentTime)
            : Date.now();
    const resolvedMs = Number.isFinite(timeMs) ? timeMs : Date.now();
    if (this.tickCount === 1 && !this.hasExplicitInitialStartedAt && currentTime !== undefined) {
      this.startedAtMs = resolvedMs;
    }
    const timestamp = new Date(resolvedMs).toISOString();
    const elapsedMs = resolvedMs - this.startedAtMs;

    const health = await this.runHealthAudit(resolvedMs);

    const report: WatchdogTickReport = {
      tickCount: this.tickCount,
      timestamp,
      elapsedMs,
      intervalMs: this.heartbeatIntervalMs,
      health,
    };

    this.emit({ type: "tick", report });

    if (this.onHeartbeatCallback) {
      await this.onHeartbeatCallback(report);
    }

    return report;
  }

  public async renderCliStatusReport(
    currentTime?: string | number | Date,
  ): Promise<string> {
    const health = await this.runHealthAudit(currentTime);
    const bootGateTable = this.bootGateEnforcer.renderAsciiBootGateTable();

    const lines: string[] = [
      "### Autonomic Watchdog Status & Boot-Gate Enforcer",
      `- **Overall Health**: ${health.healthy ? "HEALTHY ✅" : "UNHEALTHY ❌"}`,
      `- **Active Leases / Monitors**: ${health.activeLeasesCount}`,
      `- **Stalled Agents**: ${health.stalledAgentsCount}`,
      `- **Dead / Terminated Processes**: ${health.deadProcessesCount}`,
      `- **Subagent Count**: ${health.subagentCount}`,
      `- **Boot-Gate Compliant**: ${health.bootGateCompliantCount}/${health.subagentCount}`,
      `- **Tier Violations**: ${health.tierViolationsCount}`,
      `- **Summary**: ${health.summary}`,
      "",
      "#### Subagent Pre-Flight Boot-Gate Status",
      bootGateTable,
    ];

    if (health.findings.length > 0) {
      lines.push("");
      lines.push("#### Active Watchdog Findings");
      for (const f of health.findings) {
        lines.push(`- [${f.severity.toUpperCase()}] **${f.violationType}**: ${f.observation}`);
      }
    }

    return lines.join("\n");
  }

  public start(): void {
    if (this.isRunningState) return;
    this.isRunningState = true;
    this.startedAtMs = Date.now();

    this.timer = setInterval(() => {
      void this.tick();
    }, this.heartbeatIntervalMs);

    if (
      typeof this.timer === "object" &&
      this.timer !== null &&
      "unref" in this.timer
    ) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  public stop(): void {
    if (!this.isRunningState) return;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunningState = false;
  }

  public dispose(): void {
    this.stop();
    this.activities.clear();
    this.listeners.clear();
    this.bootGateEnforcer.reset();
  }

  public isRunning(): boolean {
    return this.isRunningState;
  }

  public getTickCount(): number {
    return this.tickCount;
  }

  public on(event: string, listener: WatchdogEventListener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  private emit(event: WatchdogEvent): void {
    const specific = this.listeners.get(event.type);
    if (specific) {
      for (const listener of specific) {
        try {
          listener(event);
        } catch {}
      }
    }
    const wildcard = this.listeners.get("*");
    if (wildcard) {
      for (const listener of wildcard) {
        try {
          listener(event);
        } catch {}
      }
    }
  }
}
