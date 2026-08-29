import type {
  AuditEventCategory,
  AuditOutcome,
  AuditSeverity,
  PolicyEngineTelemetrySnapshot,
  ViolationAlert,
} from "./types.ts";

export class PolicyEngineTelemetryCollector {
  private totalEvaluations = 0;
  private allowedCount = 0;
  private deniedCount = 0;
  private violationCount = 0;
  private totalDurationMs = 0;
  private driftDetections = 0;

  private severityCounts: Record<AuditSeverity, number> = {
    info: 0,
    warning: 0,
    high: 0,
    critical: 0,
  };

  private categoryCounts: Record<AuditEventCategory, number> = {
    rbac: 0,
    worktree: 0,
    commit: 0,
    file_density: 0,
    planning: 0,
    drift: 0,
    hook: 0,
    permission_health: 0,
    configuration: 0,
    system: 0,
  };

  public recordEvaluation(
    durationMs: number,
    outcome: AuditOutcome,
    category: AuditEventCategory,
    severity: AuditSeverity,
  ): void {
    this.totalEvaluations += 1;
    this.totalDurationMs += Math.max(0, durationMs);

    if (outcome === "allowed") {
      this.allowedCount += 1;
    } else {
      this.deniedCount += 1;
      this.violationCount += 1;
    }

    this.severityCounts[severity] = (this.severityCounts[severity] ?? 0) + 1;
    this.categoryCounts[category] = (this.categoryCounts[category] ?? 0) + 1;
  }

  public recordDriftEvent(): void {
    this.driftDetections += 1;
  }

  public getSnapshot(recentAlerts: readonly ViolationAlert[] = []): PolicyEngineTelemetrySnapshot {
    const violationRate =
      this.totalEvaluations > 0 ? this.violationCount / this.totalEvaluations : 0;
    const averageLatencyMs =
      this.totalEvaluations > 0 ? this.totalDurationMs / this.totalEvaluations : 0;

    return {
      collectedAt: new Date().toISOString(),
      totalEvaluations: this.totalEvaluations,
      allowedCount: this.allowedCount,
      deniedCount: this.deniedCount,
      violationCount: this.violationCount,
      violationRate,
      severityCounts: { ...this.severityCounts },
      categoryCounts: { ...this.categoryCounts },
      averageLatencyMs,
      driftDetections: this.driftDetections,
      recentAlerts: [...recentAlerts],
    };
  }

  public reset(): void {
    this.totalEvaluations = 0;
    this.allowedCount = 0;
    this.deniedCount = 0;
    this.violationCount = 0;
    this.totalDurationMs = 0;
    this.driftDetections = 0;

    this.severityCounts = {
      info: 0,
      warning: 0,
      high: 0,
      critical: 0,
    };

    this.categoryCounts = {
      rbac: 0,
      worktree: 0,
      commit: 0,
      file_density: 0,
      planning: 0,
      drift: 0,
      hook: 0,
      permission_health: 0,
      configuration: 0,
      system: 0,
    };
  }
}
