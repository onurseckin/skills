import { AuditTrailWriter } from "./audit-trail-writer.ts";
import { PolicyEngineTelemetryCollector } from "./telemetry-collector.ts";
import type {
  AlertSubscriber,
  AlertThresholdConfig,
  AuditActor,
  AuditEvent,
  AuditEventCategory,
  AuditOutcome,
  AuditQueryFilter,
  AuditSeverity,
  AuditTrailWriterOptions,
  IntegrityCheckResult,
  PolicyEngineTelemetrySnapshot,
  ViolationAlert,
} from "./types.ts";
import { ViolationAlertDispatcher } from "./violation-alert.ts";

export interface SecurityAuditLoggerOptions {
  readonly writerOptions?: AuditTrailWriterOptions | undefined;
  readonly alertConfig?: AlertThresholdConfig | undefined;
}

export class SecurityAuditLogger {
  private readonly writer: AuditTrailWriter;
  private readonly alertDispatcher: ViolationAlertDispatcher;
  private readonly telemetryCollector: PolicyEngineTelemetryCollector;

  public constructor(options?: SecurityAuditLoggerOptions) {
    this.writer = new AuditTrailWriter(options?.writerOptions);
    this.alertDispatcher = new ViolationAlertDispatcher(options?.alertConfig);
    this.telemetryCollector = new PolicyEngineTelemetryCollector();
  }

  public async logEvent(
    eventInput: Omit<AuditEvent, "id" | "timestamp" | "sequenceNumber" | "hash" | "previousHash"> & {
      readonly id?: string | undefined;
      readonly timestamp?: string | undefined;
    },
    durationMs = 0,
  ): Promise<AuditEvent> {
    const event = this.writer.record(eventInput);
    this.telemetryCollector.recordEvaluation(durationMs, event.outcome, event.category, event.severity);
    if (event.outcome === "denied" || event.severity === "high" || event.severity === "critical") {
      await this.alertDispatcher.createAlert({
        category: event.category,
        initialSeverity: event.severity,
        ruleId: event.action,
        actor: event.actor,
        message: `Policy violation: ${event.action} resulted in ${event.outcome}`,
        violations: [String(event.details.reason ?? event.action)],
        context: event.details,
      });
    }
    return event;
  }

  public async logRbacDecision(params: {
    readonly actor: AuditActor;
    readonly command: string;
    readonly allowed: boolean;
    readonly reason?: string | undefined;
    readonly violations?: readonly string[] | undefined;
    readonly durationMs?: number | undefined;
  }): Promise<AuditEvent> {
    const outcome: AuditOutcome = params.allowed ? "allowed" : "denied";
    const severity: AuditSeverity = params.allowed ? "info" : "high";
    const event = this.writer.record({
      category: "rbac",
      action: "command_execution_auth",
      actor: params.actor,
      severity,
      outcome,
      target: params.command,
      details: {
        command: params.command,
        allowed: params.allowed,
        reason: params.reason ?? (params.allowed ? "Command authorized" : "Command forbidden by RBAC"),
        violations: params.violations ?? [],
      },
    });
    this.telemetryCollector.recordEvaluation(params.durationMs ?? 0, outcome, "rbac", severity);
    if (!params.allowed) {
      await this.alertDispatcher.createAlert({
        category: "rbac",
        initialSeverity: severity,
        ruleId: "rbac_command_denial",
        actor: params.actor,
        message: `Unauthorized command execution attempt: '${params.command}'`,
        violations: params.violations ?? [params.reason ?? "Command denied by RBAC policy"],
        context: { command: params.command, reason: params.reason },
      });
    }
    return event;
  }

  public async logEnforcementAction(params: {
    readonly actor: AuditActor;
    readonly actionType: string;
    readonly allowed: boolean;
    readonly target?: string | undefined;
    readonly violations?: readonly string[] | undefined;
    readonly warnings?: readonly string[] | undefined;
    readonly durationMs?: number | undefined;
    readonly details?: Record<string, unknown> | undefined;
  }): Promise<AuditEvent> {
    const outcome: AuditOutcome = params.allowed ? "allowed" : "denied";
    const severity: AuditSeverity = params.allowed
      ? (params.warnings && params.warnings.length > 0 ? "warning" : "info")
      : "high";
    const catMap: Record<string, AuditEventCategory> = {
      worktree: "worktree",
      commit: "commit",
      file_density: "file_density",
      planning: "planning",
    };
    const category = catMap[params.actionType] ?? "system";
    const event = this.writer.record({
      category,
      action: `enforce_${params.actionType}`,
      actor: params.actor,
      severity,
      outcome,
      target: params.target,
      details: {
        actionType: params.actionType,
        allowed: params.allowed,
        violations: params.violations ?? [],
        warnings: params.warnings ?? [],
        ...(params.details ?? {}),
      },
    });
    this.telemetryCollector.recordEvaluation(params.durationMs ?? 0, outcome, category, severity);
    if (!params.allowed && params.violations && params.violations.length > 0) {
      await this.alertDispatcher.createAlert({
        category,
        initialSeverity: severity,
        ruleId: `policy_enforce_${params.actionType}`,
        actor: params.actor,
        message: `Policy enforcement failure on ${params.actionType}: ${params.violations[0]}`,
        violations: params.violations,
        context: { target: params.target, ...(params.details ?? {}) },
      });
    }
    return event;
  }

  public async logDriftEvent(params: {
    readonly actor: AuditActor;
    readonly detected: boolean;
    readonly reason?: string | undefined;
    readonly details?: Record<string, unknown> | undefined;
    readonly durationMs?: number | undefined;
  }): Promise<AuditEvent> {
    const outcome: AuditOutcome = params.detected ? "flagged" : "allowed";
    const severity: AuditSeverity = params.detected ? "high" : "info";
    const event = this.writer.record({
      category: "drift",
      action: "policy_drift_detection",
      actor: params.actor,
      severity,
      outcome,
      details: {
        driftDetected: params.detected,
        reason: params.reason ?? (params.detected ? "Policy drift detected" : "Policy clean"),
        ...(params.details ?? {}),
      },
    });
    if (params.detected) {
      this.telemetryCollector.recordDriftEvent();
      await this.alertDispatcher.createAlert({
        category: "drift",
        initialSeverity: "critical",
        ruleId: "policy_drift_detected",
        actor: params.actor,
        message: `Policy drift detected: ${params.reason ?? "Configuration checksum mismatch"}`,
        violations: [params.reason ?? "Policy drift detected"],
        context: params.details ?? {},
      });
    }
    this.telemetryCollector.recordEvaluation(params.durationMs ?? 0, outcome, "drift", severity);
    return event;
  }

  public async logHookExecution(params: {
    readonly actor: AuditActor;
    readonly hookEvent: string;
    readonly command: string;
    readonly success: boolean;
    readonly exitCode?: number | undefined;
    readonly error?: string | undefined;
    readonly durationMs?: number | undefined;
  }): Promise<AuditEvent> {
    const outcome: AuditOutcome = params.success ? "allowed" : "denied";
    const severity: AuditSeverity = params.success ? "info" : "warning";
    const event = this.writer.record({
      category: "hook",
      action: `hook_execution_${params.hookEvent}`,
      actor: params.actor,
      severity,
      outcome,
      target: params.command,
      details: {
        hookEvent: params.hookEvent,
        command: params.command,
        success: params.success,
        exitCode: params.exitCode,
        error: params.error,
      },
    });
    this.telemetryCollector.recordEvaluation(params.durationMs ?? 0, outcome, "hook", severity);
    if (!params.success) {
      await this.alertDispatcher.createAlert({
        category: "hook",
        initialSeverity: "warning",
        ruleId: `hook_failure_${params.hookEvent}`,
        actor: params.actor,
        message: `Lifecycle hook failure on event '${params.hookEvent}': ${params.error ?? "Non-zero exit code"}`,
        violations: [params.error ?? `Exit code: ${params.exitCode}`],
        context: { hookEvent: params.hookEvent, command: params.command },
      });
    }
    return event;
  }

  public async logPermissionHealthAudit(params: {
    readonly actor: AuditActor;
    readonly healthy: boolean;
    readonly issues?: readonly string[] | undefined;
    readonly durationMs?: number | undefined;
  }): Promise<AuditEvent> {
    const outcome: AuditOutcome = params.healthy ? "allowed" : "flagged";
    const severity: AuditSeverity = params.healthy ? "info" : "warning";
    const event = this.writer.record({
      category: "permission_health",
      action: "permission_health_audit",
      actor: params.actor,
      severity,
      outcome,
      details: { healthy: params.healthy, issues: params.issues ?? [] },
    });
    this.telemetryCollector.recordEvaluation(params.durationMs ?? 0, outcome, "permission_health", severity);
    if (!params.healthy && params.issues && params.issues.length > 0) {
      await this.alertDispatcher.createAlert({
        category: "permission_health",
        initialSeverity: "warning",
        ruleId: "permission_health_issues",
        actor: params.actor,
        message: `Permission health issues detected: ${params.issues[0]}`,
        violations: params.issues,
        context: { issues: params.issues },
      });
    }
    return event;
  }

  public getTelemetry(): PolicyEngineTelemetrySnapshot {
    return this.telemetryCollector.getSnapshot(this.alertDispatcher.getRecentAlerts());
  }

  public queryAuditTrail(filter?: AuditQueryFilter): readonly AuditEvent[] {
    return this.writer.query(filter);
  }

  public verifyAuditIntegrity(): IntegrityCheckResult {
    return this.writer.verifyIntegrity();
  }

  public subscribeToAlerts(subscriber: AlertSubscriber): () => void {
    return this.alertDispatcher.subscribe(subscriber);
  }

  public acknowledgeAlert(alertId: string): boolean {
    return this.alertDispatcher.acknowledgeAlert(alertId);
  }

  public getUnacknowledgedAlerts(): readonly ViolationAlert[] {
    return this.alertDispatcher.getUnacknowledgedAlerts();
  }

  public resetTelemetry(): void {
    this.telemetryCollector.reset();
  }

  public clearAuditTrail(): void {
    this.writer.clear();
    this.alertDispatcher.clear();
    this.telemetryCollector.reset();
  }
}

export function createSecurityAuditLogger(
  options?: SecurityAuditLoggerOptions,
): SecurityAuditLogger {
  return new SecurityAuditLogger(options);
}
