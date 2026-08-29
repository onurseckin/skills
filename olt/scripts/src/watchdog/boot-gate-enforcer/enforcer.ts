import type { JsonObject } from "../../core/contracts/index.ts";
import { renderAsciiBootGateTable } from "./formatter.ts";
import {
  applyDoctorExecution,
  applyWhoamiExecution,
  createSpawnedSubagentRecord,
} from "./recorder.ts";
import { auditBootGatesFromState } from "./state-auditor.ts";
import type {
  BootGateVerificationResult,
  LiveCliProof,
  ProcessHealthStatus,
  SubagentBootGateRecord,
  SubagentRegistrationOptions,
  WatchdogFinding,
} from "./types.ts";
import { assertBootGatesPassed, auditFindings, verifyBootGates } from "./verifier.ts";

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

    const record = createSpawnedSubagentRecord(options, timestamp);
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
      this.registerSpawnedSubagent({ agentId, role: "unknown" }, timestamp);

    const updated = applyWhoamiExecution(existing, timestamp, proof);
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
      this.registerSpawnedSubagent({ agentId, role: "unknown" }, timestamp);

    const updated = applyDoctorExecution(existing, timestamp, proof);
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
    return verifyBootGates(this.records.get(agentId), agentId, requireValidProof);
  }

  public assertBootGatesPassed(
    agentId: string,
    operationDescription = "performing task operations",
    requireValidProof = false,
  ): void {
    assertBootGatesPassed(
      this.records.get(agentId),
      agentId,
      operationDescription,
      requireValidProof,
    );
  }

  public auditSubagentBootGatesFromState(
    state?: JsonObject | null,
    now?: string | number | Date,
  ): readonly SubagentBootGateRecord[] {
    return auditBootGatesFromState(
      state,
      this.records,
      (opt, n) => this.registerSpawnedSubagent(opt, n),
      (actor, argv, startedAt, exitCode, pid, snippet) =>
        this.recordCommandExecution(actor, argv, startedAt, exitCode, pid, snippet),
      now,
    );
  }

  public auditFindings(
    records?: readonly SubagentBootGateRecord[],
    now?: string | number | Date,
  ): readonly WatchdogFinding[] {
    const targetRecords = records ?? this.getAllRecords();
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    return auditFindings(targetRecords, timestamp);
  }

  public renderAsciiBootGateTable(records?: readonly SubagentBootGateRecord[]): string {
    return renderAsciiBootGateTable(records ?? this.getAllRecords());
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
