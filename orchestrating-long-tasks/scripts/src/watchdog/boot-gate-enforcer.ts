import { HarnessError } from "../errors/harness-error.ts";
import { roleToTier } from "../authority/thread-identifier.ts";
import type { JsonObject } from "../contracts/json.ts";
import type { MandatoryBootGate } from "./constants.ts";
import type {
  BootGateVerificationResult,
  LiveCliProof,
  ProcessHealthStatus,
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
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    const existing = this.records.get(options.agentId);
    if (existing) {
      return existing;
    }

    const tier = options.tier !== undefined ? options.tier : roleToTier(options.role);

    const record: SubagentBootGateRecord = {
      agentId: options.agentId,
      role: options.role,
      tier,
      parentAgentId: options.parentAgentId ?? null,
      taskId: options.taskId ?? null,
      ...(options.pid !== undefined ? { pid: options.pid } : {}),
      ...(options.ppid !== undefined ? { ppid: options.ppid } : {}),
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
    proof?: Partial<LiveCliProof>,
  ): SubagentBootGateRecord {
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    const existing =
      this.records.get(agentId) ??
      this.registerSpawnedSubagent(
        {
          agentId,
          role: "unknown",
        },
        timestamp,
      );

    const isVerified =
      proof?.verified !== false && (proof?.exitCode === undefined || proof.exitCode === 0);

    const constructedProof: LiveCliProof = {
      gate: "whoami",
      actor: agentId,
      argv: proof?.argv ?? ["bun", "scripts/harness.ts", "whoami"],
      exitCode: proof?.exitCode ?? 0,
      executedAt: timestamp,
      ...(proof?.pid !== undefined
        ? { pid: proof.pid }
        : existing.pid !== undefined
          ? { pid: existing.pid }
          : {}),
      ...(proof?.outputSnippet !== undefined ? { outputSnippet: proof.outputSnippet } : {}),
      ...(proof?.fingerprint !== undefined ? { fingerprint: proof.fingerprint } : {}),
      verified: isVerified,
      ...(proof?.failureReason !== undefined
        ? { failureReason: proof.failureReason }
        : isVerified
          ? {}
          : { failureReason: "whoami CLI command failed with non-zero exit" }),
    };

    const doctorPassed = existing.doctorExecuted;
    const gateViolations: string[] = [];
    if (!isVerified) {
      gateViolations.push(
        `Pre-flight boot gate 'whoami' verification failed: ${constructedProof.failureReason ?? "unverified execution"}`,
      );
    }
    if (!doctorPassed) {
      gateViolations.push("Pre-flight boot gate 'doctor' not yet executed");
    }

    const updated: SubagentBootGateRecord = {
      ...existing,
      whoamiExecuted: isVerified,
      whoamiExecutedAt: timestamp,
      whoamiProof: constructedProof,
      bootGatePassed: isVerified && doctorPassed,
      gateViolations,
      lastActivityAt: timestamp,
    };

    this.records.set(agentId, updated);
    return updated;
  }

  public recordDoctorExecution(
    agentId: string,
    now?: string | number | Date,
    proof?: Partial<LiveCliProof>,
  ): SubagentBootGateRecord {
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    const existing =
      this.records.get(agentId) ??
      this.registerSpawnedSubagent(
        {
          agentId,
          role: "unknown",
        },
        timestamp,
      );

    const isVerified =
      proof?.verified !== false && (proof?.exitCode === undefined || proof.exitCode === 0);

    const constructedProof: LiveCliProof = {
      gate: "doctor",
      actor: agentId,
      argv: proof?.argv ?? ["bun", "scripts/harness.ts", "doctor"],
      exitCode: proof?.exitCode ?? 0,
      executedAt: timestamp,
      ...(proof?.pid !== undefined
        ? { pid: proof.pid }
        : existing.pid !== undefined
          ? { pid: existing.pid }
          : {}),
      ...(proof?.outputSnippet !== undefined ? { outputSnippet: proof.outputSnippet } : {}),
      ...(proof?.fingerprint !== undefined ? { fingerprint: proof.fingerprint } : {}),
      verified: isVerified,
      ...(proof?.failureReason !== undefined
        ? { failureReason: proof.failureReason }
        : isVerified
          ? {}
          : { failureReason: "doctor CLI command failed with non-zero exit" }),
    };

    const whoamiPassed = existing.whoamiExecuted;
    const gateViolations: string[] = [];
    if (!whoamiPassed) {
      gateViolations.push("Pre-flight boot gate 'whoami' not yet executed");
    }
    if (!isVerified) {
      gateViolations.push(
        `Pre-flight boot gate 'doctor' verification failed: ${constructedProof.failureReason ?? "unverified execution"}`,
      );
    }

    const updated: SubagentBootGateRecord = {
      ...existing,
      doctorExecuted: isVerified,
      doctorExecutedAt: timestamp,
      doctorProof: constructedProof,
      bootGatePassed: whoamiPassed && isVerified,
      gateViolations,
      lastActivityAt: timestamp,
    };

    this.records.set(agentId, updated);
    return updated;
  }

  public recordCliProof(
    proof: LiveCliProof,
    now?: string | number | Date,
  ): SubagentBootGateRecord | undefined {
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();

    if (proof.gate === "whoami") {
      return this.recordWhoamiExecution(proof.actor, timestamp, proof);
    }
    if (proof.gate === "doctor") {
      return this.recordDoctorExecution(proof.actor, timestamp, proof);
    }
    return undefined;
  }

  public recordCommandExecution(
    agentId: string,
    argv: readonly string[],
    now?: string | number | Date,
    exitCode?: number,
    pid?: number,
    outputSnippet?: string,
  ): SubagentBootGateRecord | undefined {
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    const cmdLine = argv.join(" ").toLowerCase();

    let updatedRecord: SubagentBootGateRecord | undefined;

    if (cmdLine.includes("whoami")) {
      const isVerified = exitCode === undefined || exitCode === 0;
      updatedRecord = this.recordWhoamiExecution(agentId, timestamp, {
        gate: "whoami",
        actor: agentId,
        argv,
        exitCode: exitCode ?? 0,
        executedAt: timestamp,
        pid,
        outputSnippet,
        verified: isVerified,
      });
    }
    if (cmdLine.includes("doctor")) {
      const isVerified = exitCode === undefined || exitCode === 0;
      updatedRecord = this.recordDoctorExecution(agentId, timestamp, {
        gate: "doctor",
        actor: agentId,
        argv,
        exitCode: exitCode ?? 0,
        executedAt: timestamp,
        pid,
        outputSnippet,
        verified: isVerified,
      });
    }

    if (!updatedRecord && this.records.has(agentId)) {
      const existing = this.records.get(agentId)!;
      const refreshed: SubagentBootGateRecord = {
        ...existing,
        ...(pid !== undefined ? { pid } : {}),
        lastActivityAt: timestamp,
      };
      this.records.set(agentId, refreshed);
      updatedRecord = refreshed;
    }

    return updatedRecord;
  }

  public updateProcessHealth(
    agentId: string,
    health: ProcessHealthStatus,
  ): SubagentBootGateRecord | undefined {
    const existing = this.records.get(agentId);
    if (!existing) return undefined;

    const updated: SubagentBootGateRecord = {
      ...existing,
      pid: health.pid,
      lastProcessHealth: health,
      lastActivityAt: health.checkedAt,
    };
    this.records.set(agentId, updated);
    return updated;
  }

  public verifyBootGates(agentId: string, requireValidProof = false): BootGateVerificationResult {
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
    const violations: string[] = [];
    const proofs: Partial<Record<MandatoryBootGate, LiveCliProof>> = {};

    if (record.whoamiProof) {
      proofs.whoami = record.whoamiProof;
    }
    if (record.doctorProof) {
      proofs.doctor = record.doctorProof;
    }

    if (!record.whoamiExecuted) {
      missingGates.push("whoami");
      violations.push(`Subagent "${agentId}" has not executed mandatory pre-flight 'whoami'`);
    } else if (requireValidProof && record.whoamiProof?.verified === false) {
      missingGates.push("whoami");
      violations.push(`Subagent "${agentId}" pre-flight 'whoami' CLI proof failed verification`);
    }

    if (!record.doctorExecuted) {
      missingGates.push("doctor");
      violations.push(`Subagent "${agentId}" has not executed mandatory pre-flight 'doctor'`);
    } else if (requireValidProof && record.doctorProof?.verified === false) {
      missingGates.push("doctor");
      violations.push(`Subagent "${agentId}" pre-flight 'doctor' CLI proof failed verification`);
    }

    const passed = missingGates.length === 0;

    return {
      passed,
      missingGates,
      violations,
      proofs,
      record,
    };
  }

  public assertBootGatesPassed(
    agentId: string,
    operationDescription = "performing task operations",
    requireValidProof = false,
  ): void {
    const verification = this.verifyBootGates(agentId, requireValidProof);
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

    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();

    const agentsRaw = state.agents;
    if (Array.isArray(agentsRaw)) {
      for (const ag of agentsRaw) {
        if (typeof ag === "object" && ag !== null) {
          const entry = ag as Record<string, unknown>;
          const id = typeof entry.id === "string" ? entry.id : undefined;
          const role = typeof entry.role === "string" ? entry.role : "subagent";
          const parentId = typeof entry.parent_agent_id === "string" ? entry.parent_agent_id : null;
          const taskId = typeof entry.parent_task_id === "string" ? entry.parent_task_id : null;
          const pid = typeof entry.pid === "number" ? entry.pid : undefined;
          const ppid = typeof entry.ppid === "number" ? entry.ppid : undefined;
          const grantedAt = typeof entry.granted_at === "string" ? entry.granted_at : timestamp;

          if (id && !this.records.has(id)) {
            this.registerSpawnedSubagent(
              {
                agentId: id,
                role,
                parentAgentId: parentId,
                taskId,
                pid,
                ppid,
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
          const argv = Array.isArray(entry.argv) ? entry.argv.map(String) : [];
          const startedAt = typeof entry.started_at === "string" ? entry.started_at : timestamp;
          const exitCode = typeof entry.exit_code === "number" ? entry.exit_code : undefined;
          const pid = typeof entry.pid === "number" ? entry.pid : undefined;

          if (actor && argv.length > 0) {
            this.recordCommandExecution(actor, argv, startedAt, exitCode, pid);
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
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    const findings: WatchdogFinding[] = [];

    for (const rec of targetRecords) {
      if (!rec.bootGatePassed) {
        const missing: string[] = [];
        if (!rec.whoamiExecuted) missing.push("whoami");
        if (!rec.doctorExecuted) missing.push("doctor");

        const isUnverified =
          (rec.whoamiProof && !rec.whoamiProof.verified) ||
          (rec.doctorProof && !rec.doctorProof.verified);

        const violationType = isUnverified ? "invalid_boot_gate_proof" : "boot_gate_missing";

        findings.push({
          id: `finding-bootgate-${rec.agentId}`,
          agentId: rec.agentId,
          role: rec.role,
          taskId: rec.taskId ?? undefined,
          violationType,
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
            whoamiProof: rec.whoamiProof,
            doctorExecuted: rec.doctorExecuted,
            doctorExecutedAt: rec.doctorExecutedAt,
            doctorProof: rec.doctorProof,
            missingGates: missing,
          },
        });
      }
    }

    return findings;
  }

  public renderAsciiBootGateTable(records?: readonly SubagentBootGateRecord[]): string {
    const targetRecords = records ?? this.getAllRecords();
    if (targetRecords.length === 0) {
      return "No subagents registered in boot gate tracker.";
    }

    const lines: string[] = [];
    lines.push(
      "| Agent ID             | Tier | Role         | PID   | whoami | doctor | Boot Gate | Last Activity       |",
    );
    lines.push(
      "|----------------------|------|--------------|-------|--------|--------|-----------|---------------------|",
    );

    for (const r of targetRecords) {
      const agentCol = r.agentId.padEnd(20).slice(0, 20);
      const tierCol = `T${r.tier}`.padEnd(4);
      const roleCol = r.role.padEnd(12).slice(0, 12);
      const pidCol = (r.pid !== undefined ? String(r.pid) : "-").padEnd(5);
      const whoamiCol = (r.whoamiExecuted ? "PASS ✅" : "FAIL ❌").padEnd(6);
      const doctorCol = (r.doctorExecuted ? "PASS ✅" : "FAIL ❌").padEnd(6);
      const gateCol = (r.bootGatePassed ? "READY ✅" : "BLOCKED ❌").padEnd(9);
      const actCol = r.lastActivityAt.slice(11, 19).padEnd(19);

      lines.push(
        `| ${agentCol} | ${tierCol} | ${roleCol} | ${pidCol} | ${whoamiCol} | ${doctorCol} | ${gateCol} | ${actCol} |`,
      );
    }

    return lines.join("\n");
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
