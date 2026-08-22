import { HarnessError } from "../errors/harness-error.ts";
import { roleToTier } from "../authority/thread-identifier.ts";
import type { JsonObject } from "../contracts/json.ts";
import type { MandatoryBootGate } from "./constants.ts";
import type {
  BootGateVerificationResult,
  SubagentBootGateRecord,
  SubagentRegistrationOptions,
  WatchdogFinding,
} from "./types.ts";

export class BootGateEnforcer {
  private readonly records = new Map<string, SubagentBootGateRecord>();

  public registerSpawnedSubagent(
    options: SubagentRegistrationOptions,
    now?: string | number | Date,
  ): SubagentBootGateRecord {
    const timestamp =
      now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    const existing = this.records.get(options.agentId);
    if (existing) {
      return existing;
    }

    const tier =
      options.tier !== undefined ? options.tier : roleToTier(options.role);

    const record: SubagentBootGateRecord = {
      agentId: options.agentId,
      role: options.role,
      tier,
      parentAgentId: options.parentAgentId ?? null,
      taskId: options.taskId ?? null,
      spawnedAt: options.spawnedAt ?? timestamp,
      whoamiExecuted: false,
      whoamiExecutedAt: null,
      doctorExecuted: false,
      doctorExecutedAt: null,
      bootGatePassed: false,
      gateViolations: [
        "Pre-flight boot gate 'whoami' not yet executed",
        "Pre-flight boot gate 'doctor' not yet executed",
      ],
      lastActivityAt: timestamp,
      ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
    };

    this.records.set(options.agentId, record);
    return record;
  }

  public recordWhoamiExecution(
    agentId: string,
    now?: string | number | Date,
  ): SubagentBootGateRecord {
    const timestamp =
      now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    const existing = this.records.get(agentId) ?? this.registerSpawnedSubagent({
      agentId,
      role: "unknown",
    }, timestamp);

    const doctorPassed = existing.doctorExecuted;
    const gateViolations = doctorPassed
      ? []
      : ["Pre-flight boot gate 'doctor' not yet executed"];

    const updated: SubagentBootGateRecord = {
      ...existing,
      whoamiExecuted: true,
      whoamiExecutedAt: timestamp,
      bootGatePassed: doctorPassed,
      gateViolations,
      lastActivityAt: timestamp,
    };

    this.records.set(agentId, updated);
    return updated;
  }

  public recordDoctorExecution(
    agentId: string,
    now?: string | number | Date,
  ): SubagentBootGateRecord {
    const timestamp =
      now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    const existing = this.records.get(agentId) ?? this.registerSpawnedSubagent({
      agentId,
      role: "unknown",
    }, timestamp);

    const whoamiPassed = existing.whoamiExecuted;
    const gateViolations = whoamiPassed
      ? []
      : ["Pre-flight boot gate 'whoami' not yet executed"];

    const updated: SubagentBootGateRecord = {
      ...existing,
      doctorExecuted: true,
      doctorExecutedAt: timestamp,
      bootGatePassed: whoamiPassed,
      gateViolations,
      lastActivityAt: timestamp,
    };

    this.records.set(agentId, updated);
    return updated;
  }

  public recordCommandExecution(
    agentId: string,
    argv: readonly string[],
    now?: string | number | Date,
  ): SubagentBootGateRecord | undefined {
    const timestamp =
      now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    const cmdLine = argv.join(" ").toLowerCase();

    let updatedRecord: SubagentBootGateRecord | undefined;

    if (cmdLine.includes("whoami")) {
      updatedRecord = this.recordWhoamiExecution(agentId, timestamp);
    }
    if (cmdLine.includes("doctor")) {
      updatedRecord = this.recordDoctorExecution(agentId, timestamp);
    }

    if (!updatedRecord && this.records.has(agentId)) {
      const existing = this.records.get(agentId)!;
      const refreshed: SubagentBootGateRecord = {
        ...existing,
        lastActivityAt: timestamp,
      };
      this.records.set(agentId, refreshed);
      updatedRecord = refreshed;
    }

    return updatedRecord;
  }

  public verifyBootGates(agentId: string): BootGateVerificationResult {
    const record = this.records.get(agentId);
    if (!record) {
      return {
        passed: false,
        missingGates: ["whoami", "doctor"],
        violations: [`Subagent "${agentId}" has no recorded pre-flight boot gates.`],
        record: undefined,
      };
    }

    const missingGates: MandatoryBootGate[] = [];
    if (!record.whoamiExecuted) missingGates.push("whoami");
    if (!record.doctorExecuted) missingGates.push("doctor");

    const passed = missingGates.length === 0;
    const violations: string[] = [];
    if (!record.whoamiExecuted) {
      violations.push(`Subagent "${agentId}" has not executed mandatory pre-flight 'whoami'`);
    }
    if (!record.doctorExecuted) {
      violations.push(`Subagent "${agentId}" has not executed mandatory pre-flight 'doctor'`);
    }

    return {
      passed,
      missingGates,
      violations,
      record,
    };
  }

  public assertBootGatesPassed(
    agentId: string,
    operationDescription = "performing task operations",
  ): void {
    const verification = this.verifyBootGates(agentId);
    if (!verification.passed) {
      const missing = verification.missingGates.join(", ");
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        `Pre-flight boot gate violation: Subagent "${agentId}" attempted ${operationDescription} without completing mandatory pre-flight boot gates: [${missing}]. Every spawned subagent must execute 'whoami' and 'doctor' before claiming tasks or modifying files.`,
      );
    }
  }

  public auditSubagentBootGatesFromState(
    state?: JsonObject | null,
    now?: string | number | Date,
  ): readonly SubagentBootGateRecord[] {
    if (!state) return this.getAllRecords();

    const timestamp =
      now !== undefined ? new Date(now).toISOString() : new Date().toISOString();

    const agentsRaw = state.agents;
    if (Array.isArray(agentsRaw)) {
      for (const ag of agentsRaw) {
        if (typeof ag === "object" && ag !== null) {
          const entry = ag as Record<string, unknown>;
          const id = typeof entry.id === "string" ? entry.id : undefined;
          const role = typeof entry.role === "string" ? entry.role : "subagent";
          const parentId =
            typeof entry.parent_agent_id === "string" ? entry.parent_agent_id : null;
          const taskId =
            typeof entry.parent_task_id === "string" ? entry.parent_task_id : null;
          const grantedAt =
            typeof entry.granted_at === "string" ? entry.granted_at : timestamp;

          if (id && !this.records.has(id)) {
            this.registerSpawnedSubagent(
              {
                agentId: id,
                role,
                parentAgentId: parentId,
                taskId,
                spawnedAt: grantedAt,
              },
              timestamp,
            );
          }
        }
      }
    }

    const commandsRaw = state.commands;
    if (typeof commandsRaw === "object" && commandsRaw !== null) {
      for (const cmd of Object.values(commandsRaw)) {
        if (typeof cmd === "object" && cmd !== null) {
          const entry = cmd as Record<string, unknown>;
          const actor = typeof entry.actor === "string" ? entry.actor : undefined;
          const argv = Array.isArray(entry.argv)
            ? entry.argv.map(String)
            : [];
          const startedAt =
            typeof entry.started_at === "string" ? entry.started_at : timestamp;

          if (actor && argv.length > 0) {
            this.recordCommandExecution(actor, argv, startedAt);
          }
        }
      }
    }

    return this.getAllRecords();
  }

  public auditFindings(
    records?: readonly SubagentBootGateRecord[],
    now?: string | number | Date,
  ): readonly WatchdogFinding[] {
    const targetRecords = records ?? this.getAllRecords();
    const timestamp =
      now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    const findings: WatchdogFinding[] = [];

    for (const rec of targetRecords) {
      if (!rec.bootGatePassed) {
        const missing: string[] = [];
        if (!rec.whoamiExecuted) missing.push("whoami");
        if (!rec.doctorExecuted) missing.push("doctor");

        findings.push({
          id: `finding-bootgate-${rec.agentId}`,
          agentId: rec.agentId,
          role: rec.role,
          taskId: rec.taskId ?? undefined,
          violationType: "boot_gate_missing",
          severity: "critical",
          observation: `Spawned subagent "${rec.agentId}" (Tier ${rec.tier} ${rec.role}) failed mandatory pre-flight boot gates: missing [${missing.join(", ")}]`,
          remediation:
            "Enforce immediate pre-flight execution of `whoami` and `doctor` commands prior to performing any task operations or file modifications.",
          timestamp,
          evidence: {
            agentId: rec.agentId,
            role: rec.role,
            tier: rec.tier,
            whoamiExecuted: rec.whoamiExecuted,
            whoamiExecutedAt: rec.whoamiExecutedAt,
            doctorExecuted: rec.doctorExecuted,
            doctorExecutedAt: rec.doctorExecutedAt,
            missingGates: missing,
          },
        });
      }
    }

    return findings;
  }

  public getRecord(agentId: string): SubagentBootGateRecord | undefined {
    return this.records.get(agentId);
  }

  public getAllRecords(): readonly SubagentBootGateRecord[] {
    return Array.from(this.records.values());
  }

  public reset(): void {
    this.records.clear();
  }
}
