import type { MandatoryBootGate, WatchdogSeverity, WatchdogViolationType } from "./constants.ts";

export interface SubagentRegistrationOptions {
  readonly agentId: string;
  readonly role: string;
  readonly tier?: number | undefined;
  readonly parentAgentId?: string | null | undefined;
  readonly taskId?: string | null | undefined;
  readonly spawnedAt?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface SubagentBootGateRecord {
  readonly agentId: string;
  readonly role: string;
  readonly tier: number;
  readonly parentAgentId: string | null;
  readonly taskId: string | null;
  readonly spawnedAt: string;
  readonly whoamiExecuted: boolean;
  readonly whoamiExecutedAt: string | null;
  readonly doctorExecuted: boolean;
  readonly doctorExecutedAt: string | null;
  readonly bootGatePassed: boolean;
  readonly gateViolations: readonly string[];
  readonly lastActivityAt: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface BootGateVerificationResult {
  readonly passed: boolean;
  readonly missingGates: readonly MandatoryBootGate[];
  readonly violations: readonly string[];
  readonly record?: SubagentBootGateRecord | undefined;
}

export interface WatchdogFinding {
  readonly id: string;
  readonly agentId?: string | undefined;
  readonly role?: string | undefined;
  readonly taskId?: string | undefined;
  readonly violationType: WatchdogViolationType;
  readonly severity: WatchdogSeverity;
  readonly observation: string;
  readonly remediation: string;
  readonly timestamp: string;
  readonly evidence?: Readonly<Record<string, unknown>> | undefined;
}

export interface WatchdogHealthAuditReport {
  readonly healthy: boolean;
  readonly timestamp: string;
  readonly activeLeasesCount: number;
  readonly stalledAgentsCount: number;
  readonly subagentCount: number;
  readonly bootGateCompliantCount: number;
  readonly bootGateViolationsCount: number;
  readonly tierViolationsCount: number;
  readonly findings: readonly WatchdogFinding[];
  readonly summary: string;
}

export interface WatchdogTickReport {
  readonly tickCount: number;
  readonly timestamp: string;
  readonly elapsedMs: number;
  readonly intervalMs: number;
  readonly health: WatchdogHealthAuditReport;
}

export type WatchdogEvent =
  | { readonly type: "tick"; readonly report: WatchdogTickReport }
  | { readonly type: "health_audit"; readonly report: WatchdogHealthAuditReport }
  | {
      readonly type: "boot_gate_violation";
      readonly record: SubagentBootGateRecord;
      readonly finding: WatchdogFinding;
    }
  | {
      readonly type: "stall_detected";
      readonly agentId: string;
      readonly finding: WatchdogFinding;
    }
  | {
      readonly type: "critical_violation";
      readonly finding: WatchdogFinding;
    };

export type WatchdogEventListener = (event: WatchdogEvent) => void;

export interface AutonomicWatchdogConfig {
  readonly heartbeatIntervalMs?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly healthAuditIntervalMs?: number | undefined;
  readonly initialStartedAt?: number | string | Date | undefined;
  readonly capsuleRoot?: string | undefined;
  readonly generation?: number | undefined;
  readonly pulseId?: string | null | undefined;
  readonly enforcePreFlightGates?: boolean | undefined;
  readonly onHeartbeat?: ((tick: WatchdogTickReport) => void | Promise<void>) | undefined;
  readonly onHealthAudit?: ((audit: WatchdogHealthAuditReport) => void | Promise<void>) | undefined;
  readonly onViolation?: ((finding: WatchdogFinding) => void | Promise<void>) | undefined;
}
