import { describe, expect, it } from "bun:test";
import { createSecurityAuditLogger } from "../../../../olt/scripts/src/policy/audit/security-logger.ts";
import type { ViolationAlert } from "../../../../olt/scripts/src/policy/audit/types.ts";

describe("SecurityAuditLogger", () => {
  it("logs RBAC decisions and updates telemetry and alerts accordingly", async () => {
    const logger = createSecurityAuditLogger();
    const alerts: ViolationAlert[] = [];
    logger.subscribeToAlerts((a) => {
      alerts.push(a);
    });

    const allowedEvent = await logger.logRbacDecision({
      actor: { id: "implementer_17", role: "implementer" },
      command: "bun test tests/unit/policy/audit/security-audit-logger.test.ts",
      allowed: true,
      reason: "Allowed targeted test",
      durationMs: 12,
    });

    expect(allowedEvent.outcome).toBe("allowed");
    expect(allowedEvent.severity).toBe("info");
    expect(alerts.length).toBe(0);

    const deniedEvent = await logger.logRbacDecision({
      actor: { id: "validator_09", role: "validator" },
      command: "rm -rf .",
      allowed: false,
      reason: "Validators cannot execute commands",
      violations: ["Role 'validator' has can_execute_shell=false"],
      durationMs: 5,
    });

    expect(deniedEvent.outcome).toBe("denied");
    expect(deniedEvent.severity).toBe("high");
    expect(alerts.length).toBe(1);
    expect(alerts[0]?.actor.id).toBe("validator_09");

    const telemetry = logger.getTelemetry();
    expect(telemetry.totalEvaluations).toBe(2);
    expect(telemetry.allowedCount).toBe(1);
    expect(telemetry.deniedCount).toBe(1);
    expect(telemetry.violationCount).toBe(1);
    expect(telemetry.violationRate).toBe(0.5);
    expect(telemetry.averageLatencyMs).toBe(8.5);
  });

  it("logs enforcement actions and drift events", async () => {
    const logger = createSecurityAuditLogger();

    const enforceEvent = await logger.logEnforcementAction({
      actor: { id: "implementer_17", role: "implementer" },
      actionType: "worktree",
      allowed: false,
      violations: ["Worktree path is outside designated root"],
      durationMs: 10,
    });

    expect(enforceEvent.outcome).toBe("denied");
    expect(enforceEvent.category).toBe("worktree");

    const driftEvent = await logger.logDriftEvent({
      actor: { id: "mind_supervisor", role: "mind_supervisor" },
      detected: true,
      reason: "Hash mismatch detected on policy.json",
      durationMs: 15,
    });

    expect(driftEvent.outcome).toBe("flagged");
    expect(driftEvent.category).toBe("drift");

    const telemetry = logger.getTelemetry();
    expect(telemetry.driftDetections).toBe(1);
    expect(telemetry.categoryCounts.worktree).toBe(1);
    expect(telemetry.categoryCounts.drift).toBe(1);
  });

  it("verifies audit trail integrity across diverse security events", async () => {
    const logger = createSecurityAuditLogger();

    await logger.logRbacDecision({
      actor: { id: "actor1" },
      command: "git status",
      allowed: true,
    });

    await logger.logHookExecution({
      actor: { id: "actor2" },
      hookEvent: "on_task_completion",
      command: "bun run check",
      success: true,
    });

    await logger.logPermissionHealthAudit({
      actor: { id: "mind" },
      healthy: true,
    });

    const integrity = logger.verifyAuditIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.totalEventsChecked).toBe(3);

    const queryResult = logger.queryAuditTrail({ actorId: "actor2" });
    expect(queryResult.length).toBe(1);
    expect(queryResult[0]?.category).toBe("hook");
  });

  it("handles logEvent, alert acknowledgment, and telemetry resets", async () => {
    const logger = createSecurityAuditLogger();

    const event1 = await logger.logEvent({
      category: "rbac",
      action: "check_permission",
      actor: { id: "agent_1" },
      severity: "info",
      outcome: "allowed",
      details: { role: "implementer" },
    }, 5);
    expect(event1.outcome).toBe("allowed");

    const event2 = await logger.logEvent({
      category: "rbac",
      action: "unauthorized_access",
      actor: { id: "agent_2" },
      severity: "critical",
      outcome: "denied",
      details: { reason: "Forbidden access" },
    }, 10);
    expect(event2.outcome).toBe("denied");

    const unacked = logger.getUnacknowledgedAlerts();
    expect(unacked.length).toBe(1);
    const alertId = unacked[0]!.id;

    expect(logger.acknowledgeAlert(alertId)).toBe(true);
    expect(logger.getUnacknowledgedAlerts().length).toBe(0);

    logger.resetTelemetry();
    expect(logger.getTelemetry().totalEvaluations).toBe(0);

    logger.clearAuditTrail();
    expect(logger.queryAuditTrail({}).length).toBe(0);
  });
});

