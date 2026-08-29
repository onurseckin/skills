import type { BootGateEnforcer } from "../boot-gate-enforcer.ts";
import type {
  AgentActivityState,
  LiveCliProof,
  SubagentBootGateRecord,
  SubagentRegistrationOptions,
} from "./types.ts";

function resolveTimestampMs(now?: string | number | Date): number {
  const timeMs =
    typeof now === "number"
      ? now
      : now instanceof Date
        ? now.getTime()
        : typeof now === "string"
          ? Date.parse(now)
          : Date.now();
  return Number.isFinite(timeMs) ? timeMs : Date.now();
}

export class ActivityTracker {
  public readonly activities = new Map<string, AgentActivityState>();

  public constructor(private readonly bootGateEnforcer: BootGateEnforcer) {}

  public registerSubagent(
    options: SubagentRegistrationOptions,
    now?: string | number | Date,
  ): SubagentBootGateRecord {
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    const resolvedMs = resolveTimestampMs(now);

    const record = this.bootGateEnforcer.registerSpawnedSubagent(options, timestamp);

    if (!this.activities.has(options.agentId)) {
      this.activities.set(options.agentId, {
        agentId: options.agentId,
        taskId: options.taskId ?? null,
        ...(options.pid !== undefined ? { pid: options.pid } : {}),
        lastHeartbeatAt: resolvedMs,
        lastActivityAt: resolvedMs,
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
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    this.recordActivity(agentId, undefined, now);
    return this.bootGateEnforcer.recordWhoamiExecution(agentId, timestamp, proof);
  }

  public recordDoctor(
    agentId: string,
    now?: string | number | Date,
    proof?: Partial<LiveCliProof>,
  ): SubagentBootGateRecord {
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    this.recordActivity(agentId, undefined, now);
    return this.bootGateEnforcer.recordDoctorExecution(agentId, timestamp, proof);
  }

  public recordCliProof(
    proof: LiveCliProof,
    now?: string | number | Date,
  ): SubagentBootGateRecord | undefined {
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
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
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
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

  public recordHeartbeat(agentId: string, taskId?: string, now?: string | number | Date): void {
    const resolvedMs = resolveTimestampMs(now);
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

  public recordActivity(agentId: string, taskId?: string, now?: string | number | Date): void {
    const resolvedMs = resolveTimestampMs(now);
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

  public clear(): void {
    this.activities.clear();
  }
}
