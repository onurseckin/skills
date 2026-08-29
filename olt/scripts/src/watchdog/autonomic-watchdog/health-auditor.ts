import { existsSync } from "node:fs";
import { isJsonObject, type JsonObject } from "../../core/contracts/index.ts";
import type { TierConfinementFinding } from "../../reporting/doctor/tier-confinement.ts";
import type { BootGateEnforcer } from "../boot-gate-enforcer.ts";
import type {
  AgentActivityState,
  ProcessHealthStatus,
  WatchdogFinding,
  WatchdogHealthAuditReport,
} from "./types.ts";

export function defaultProcessLivenessChecker(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface HealthAuditorOptions {
  readonly timeoutMs: number;
  readonly capsuleRoot: string | null;
  readonly bootGateEnforcer: BootGateEnforcer;
  readonly activities: Map<string, AgentActivityState>;
  readonly processLivenessChecker: (pid: number) => boolean;
  readonly onStallDetected?: (agentId: string, finding: WatchdogFinding) => void;
  readonly onProcessFailureDetected?: (
    agentId: string,
    pid: number,
    finding: WatchdogFinding,
  ) => void;
}

export class HealthAuditor {
  public constructor(private readonly options: HealthAuditorOptions) {}

  public checkProcessHealth(
    pid: number,
    agentId?: string,
    now?: string | number | Date,
  ): ProcessHealthStatus {
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    const alive = this.options.processLivenessChecker(pid);

    const status: ProcessHealthStatus = {
      pid,
      alive,
      ...(agentId !== undefined ? { agentId } : {}),
      checkedAt: timestamp,
      ...(alive ? {} : { error: `Process ${pid} is not running or has terminated` }),
    };

    if (agentId) {
      this.options.bootGateEnforcer.updateProcessHealth(agentId, status);
      const existing = this.options.activities.get(agentId);
      if (existing) {
        this.options.activities.set(agentId, {
          ...existing,
          pid,
          lastProcessHealth: status,
        });
      }
    }

    return status;
  }

  public auditProcessHealth(now?: string | number | Date): readonly ProcessHealthStatus[] {
    const results: ProcessHealthStatus[] = [];
    const allRecords = this.options.bootGateEnforcer.getAllRecords();

    for (const rec of allRecords) {
      if (rec.pid !== undefined) {
        const health = this.checkProcessHealth(rec.pid, rec.agentId, now);
        results.push(health);
      }
    }

    for (const act of this.options.activities.values()) {
      if (act.pid !== undefined && !allRecords.some((r) => r.agentId === act.agentId)) {
        const health = this.checkProcessHealth(act.pid, act.agentId, now);
        results.push(health);
      }
    }

    return results;
  }

  public async auditHealth(
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
    if (this.options.capsuleRoot && existsSync(this.options.capsuleRoot)) {
      try {
        const storeModule = await import("../../engine/store/load.ts").catch(() => null);
        if (storeModule && typeof storeModule.loadRun === "function") {
          const loaded = storeModule.loadRun(this.options.capsuleRoot, false);
          rawState = isJsonObject(loaded.state) ? (loaded.state as JsonObject) : null;
        }
      } catch {
        // Fallback in memory
      }
    }

    if (rawState) {
      this.options.bootGateEnforcer.auditSubagentBootGatesFromState(rawState, timestamp);
    }

    // 2. Audit Boot Gate compliance
    const allRecords = this.options.bootGateEnforcer.getAllRecords();
    const bootGateFindings = this.options.bootGateEnforcer.auditFindings(allRecords, timestamp);
    findings.push(...bootGateFindings);

    const bootGateCompliantCount = allRecords.filter((r) => r.bootGatePassed).length;
    const bootGateViolationsCount = allRecords.length - bootGateCompliantCount;

    // 3. Audit Stalled / Inactive Agents
    let stalledAgentsCount = 0;
    let activeLeasesCount = 0;

    for (const act of this.options.activities.values()) {
      const elapsedHeartbeat = resolvedMs - act.lastHeartbeatAt;
      const elapsedActivity = resolvedMs - act.lastActivityAt;

      if (elapsedHeartbeat > this.options.timeoutMs || elapsedActivity > this.options.timeoutMs) {
        stalledAgentsCount++;
        const finding: WatchdogFinding = {
          id: `finding-stalled-${act.agentId}`,
          agentId: act.agentId,
          taskId: act.taskId ?? undefined,
          violationType: "stalled_agent",
          severity: "critical",
          observation: `Agent "${act.agentId}" has exceeded watchdog heartbeat timeout: ${elapsedHeartbeat}ms without heartbeat (timeout: ${this.options.timeoutMs}ms)`,
          remediation:
            "Agent appears stalled or unresponsive. Issue an immediate auto-wake pulse or release task lease.",
          timestamp,
          evidence: {
            agentId: act.agentId,
            taskId: act.taskId,
            lastHeartbeatAt: new Date(act.lastHeartbeatAt).toISOString(),
            lastActivityAt: new Date(act.lastActivityAt).toISOString(),
            elapsedHeartbeatMs: elapsedHeartbeat,
            timeoutMs: this.options.timeoutMs,
          },
        };
        findings.push(finding);
        this.options.onStallDetected?.(act.agentId, finding);
      } else {
        activeLeasesCount++;
      }
    }

    // 4. Audit Live Process Health
    let deadProcessesCount = 0;
    for (const rec of allRecords) {
      if (rec.pid !== undefined) {
        const isAlive = this.options.processLivenessChecker(rec.pid);
        const healthStatus: ProcessHealthStatus = {
          pid: rec.pid,
          alive: isAlive,
          agentId: rec.agentId,
          checkedAt: timestamp,
          ...(isAlive ? {} : { error: `Process PID ${rec.pid} has exited or is unreachable` }),
        };
        this.options.bootGateEnforcer.updateProcessHealth(rec.agentId, healthStatus);

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
          this.options.onProcessFailureDetected?.(rec.agentId, rec.pid, finding);
        }
      }
    }

    // 5. Audit Tier Confinement if capsuleRoot is available
    let tierViolationsCount = 0;
    if (this.options.capsuleRoot && existsSync(this.options.capsuleRoot)) {
      try {
        const tierModule = await import("../../reporting/doctor/tier-confinement.ts").catch(
          () => null,
        );
        if (tierModule && typeof tierModule.auditTierConfinement === "function") {
          const tierFindings: TierConfinementFinding[] = tierModule.auditTierConfinement(
            this.options.capsuleRoot,
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

    return {
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
  }
}
