import { randomUUID } from "node:crypto";
import type {
  AlertSubscriber,
  AlertThresholdConfig,
  AuditActor,
  AuditEventCategory,
  AuditSeverity,
  ViolationAlert,
} from "./types.ts";

export class ViolationAlertDispatcher {
  private readonly subscribers = new Set<AlertSubscriber>();
  private readonly alerts: ViolationAlert[] = [];
  private readonly violationTimestamps = new Map<string, number[]>();
  private readonly thresholdConfig: AlertThresholdConfig;

  public constructor(thresholdConfig?: AlertThresholdConfig) {
    this.thresholdConfig = {
      maxViolationsPerWindow: thresholdConfig?.maxViolationsPerWindow ?? 3,
      windowMs: thresholdConfig?.windowMs ?? 60000,
      escalateToSeverity: thresholdConfig?.escalateToSeverity ?? "critical",
    };
  }

  public subscribe(subscriber: AlertSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  public async createAlert(params: {
    readonly category: AuditEventCategory;
    readonly initialSeverity: AuditSeverity;
    readonly ruleId: string;
    readonly actor: AuditActor;
    readonly message: string;
    readonly violations: readonly string[];
    readonly context?: Record<string, unknown> | undefined;
  }): Promise<ViolationAlert> {
    const severity = this.evaluateEscalation(params.actor.id, params.initialSeverity);
    const alert: ViolationAlert = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      category: params.category,
      severity,
      ruleId: params.ruleId,
      actor: params.actor,
      message: params.message,
      violations: params.violations,
      context: params.context ?? {},
      acknowledged: false,
    };

    this.alerts.push(alert);
    if (this.alerts.length > 2000) {
      this.alerts.shift();
    }

    await this.notifySubscribers(alert);
    return alert;
  }

  private evaluateEscalation(actorId: string, baseSeverity: AuditSeverity): AuditSeverity {
    const now = Date.now();
    const windowMs = this.thresholdConfig.windowMs ?? 60000;
    const maxViolations = this.thresholdConfig.maxViolationsPerWindow ?? 3;
    const escalateSeverity = this.thresholdConfig.escalateToSeverity ?? "critical";

    let timestamps = this.violationTimestamps.get(actorId);
    if (!timestamps) {
      timestamps = [];
      this.violationTimestamps.set(actorId, timestamps);
    }

    const recentTimestamps = timestamps.filter((t) => now - t <= windowMs);
    recentTimestamps.push(now);
    this.violationTimestamps.set(actorId, recentTimestamps);

    if (recentTimestamps.length >= maxViolations) {
      return escalateSeverity;
    }

    return baseSeverity;
  }

  private async notifySubscribers(alert: ViolationAlert): Promise<void> {
    for (const subscriber of this.subscribers) {
      try {
        await subscriber(alert);
      } catch {
      }
    }
  }

  public acknowledgeAlert(id: string): boolean {
    const alert = this.alerts.find((a) => a.id === id);
    if (alert) {
      (alert as { acknowledged: boolean }).acknowledged = true;
      return true;
    }
    return false;
  }

  public getRecentAlerts(limit = 50): readonly ViolationAlert[] {
    return this.alerts.slice(-limit);
  }

  public getUnacknowledgedAlerts(): readonly ViolationAlert[] {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  public clear(): void {
    this.alerts.length = 0;
    this.violationTimestamps.clear();
  }
}
