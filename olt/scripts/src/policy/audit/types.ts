export type AuditSeverity = "info" | "warning" | "high" | "critical";

export type AuditEventCategory =
  | "rbac"
  | "worktree"
  | "commit"
  | "file_density"
  | "planning"
  | "drift"
  | "hook"
  | "permission_health"
  | "configuration"
  | "system";

export type AuditOutcome = "allowed" | "denied" | "flagged" | "remediated";

export interface AuditActor {
  readonly id: string;
  readonly role?: string | undefined;
  readonly host?: string | undefined;
  readonly session?: string | undefined;
}

export interface AuditEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly sequenceNumber: number;
  readonly category: AuditEventCategory;
  readonly action: string;
  readonly actor: AuditActor;
  readonly severity: AuditSeverity;
  readonly outcome: AuditOutcome;
  readonly target?: string | undefined;
  readonly details: Record<string, unknown>;
  readonly previousHash?: string | undefined;
  readonly hash: string;
}

export interface ViolationAlert {
  readonly id: string;
  readonly timestamp: string;
  readonly category: AuditEventCategory;
  readonly severity: AuditSeverity;
  readonly ruleId: string;
  readonly actor: AuditActor;
  readonly message: string;
  readonly violations: readonly string[];
  readonly context: Record<string, unknown>;
  readonly acknowledged: boolean;
}

export interface PolicyEngineTelemetrySnapshot {
  readonly collectedAt: string;
  readonly totalEvaluations: number;
  readonly allowedCount: number;
  readonly deniedCount: number;
  readonly violationCount: number;
  readonly violationRate: number;
  readonly severityCounts: Record<AuditSeverity, number>;
  readonly categoryCounts: Record<AuditEventCategory, number>;
  readonly averageLatencyMs: number;
  readonly driftDetections: number;
  readonly recentAlerts: readonly ViolationAlert[];
}

export interface AuditQueryFilter {
  readonly startTime?: string | undefined;
  readonly endTime?: string | undefined;
  readonly category?: AuditEventCategory | undefined;
  readonly severity?: AuditSeverity | undefined;
  readonly outcome?: AuditOutcome | undefined;
  readonly actorId?: string | undefined;
  readonly actorRole?: string | undefined;
  readonly ruleId?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface AuditTrailWriterOptions {
  readonly logFilePath?: string | undefined;
  readonly enableFilePersistence?: boolean | undefined;
  readonly maxInMemoryEvents?: number | undefined;
  readonly enableTamperEvidentHashing?: boolean | undefined;
}

export type AlertSubscriber = (alert: ViolationAlert) => void | Promise<void>;

export interface AlertThresholdConfig {
  readonly maxViolationsPerWindow?: number | undefined;
  readonly windowMs?: number | undefined;
  readonly escalateToSeverity?: AuditSeverity | undefined;
}

export interface IntegrityCheckResult {
  readonly valid: boolean;
  readonly totalEventsChecked: number;
  readonly brokenAtIndex?: number | undefined;
  readonly expectedHash?: string | undefined;
  readonly actualHash?: string | undefined;
  readonly error?: string | undefined;
}
