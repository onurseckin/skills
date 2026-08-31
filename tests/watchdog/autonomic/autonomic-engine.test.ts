import { describe, expect, it } from "bun:test";
import {
  AutonomicWatchdog,
  DEFAULT_ADAPTIVE_ACTIVITY_BOOST,
  DEFAULT_ADAPTIVE_BACKOFF_FACTOR,
  DEFAULT_ADAPTIVE_MAX_INTERVAL_MS,
  DEFAULT_ADAPTIVE_MIN_INTERVAL_MS,
  DEFAULT_HEALTH_AUDIT_INTERVAL_MS,
  DEFAULT_PROCESS_HEALTH_CHECK_INTERVAL_MS,
  DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS,
  DEFAULT_WATCHDOG_TIMEOUT_MS,
  type WatchdogFinding,
  type WatchdogHealthAuditReport,
  type WatchdogTickReport,
} from "../../../olt/scripts/src/watchdog/index.ts";

describe("AutonomicWatchdog Core Lifecycle & Configuration", () => {
  it("initializes with complete default configuration values", () => {
    const watchdog = new AutonomicWatchdog();
    expect(watchdog.heartbeatIntervalMs).toBe(DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS);
    expect(watchdog.timeoutMs).toBe(DEFAULT_WATCHDOG_TIMEOUT_MS);
    expect(watchdog.healthAuditIntervalMs).toBe(DEFAULT_HEALTH_AUDIT_INTERVAL_MS);
    expect(watchdog.processHealthCheckIntervalMs).toBe(DEFAULT_PROCESS_HEALTH_CHECK_INTERVAL_MS);
    expect(watchdog.capsuleRoot).toBeNull();
    expect(watchdog.generation).toBe(1);
    expect(watchdog.pulseId).toBeNull();
    expect(watchdog.enforcePreFlightGates).toBe(true);
    expect(watchdog.minIntervalMs).toBe(DEFAULT_ADAPTIVE_MIN_INTERVAL_MS);
    expect(watchdog.maxIntervalMs).toBe(DEFAULT_ADAPTIVE_MAX_INTERVAL_MS);
    expect(watchdog.backoffFactor).toBe(DEFAULT_ADAPTIVE_BACKOFF_FACTOR);
    expect(watchdog.activityBoost).toBe(DEFAULT_ADAPTIVE_ACTIVITY_BOOST);
    expect(watchdog.isAdaptive()).toBe(true);
    expect(watchdog.isRunning()).toBe(false);
    expect(watchdog.getTickCount()).toBe(0);
  });

  it("initializes with custom parameters, callbacks and initial timestamp", async () => {
    let tickReportReceived: WatchdogTickReport | null = null;
    let auditReceived: WatchdogHealthAuditReport | null = null;
    let findingReceived: WatchdogFinding | null = null;
    let wakeupReceived: WatchdogTickReport | null = null;
    let adjustedCount = 0;

    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 60_000,
      timeoutMs: 120_000,
      generation: 3,
      pulseId: "pulse-xyz",
      capsuleRoot: "/tmp/capsule-test",
      enforcePreFlightGates: false,
      initialStartedAt: 1700000000000,
      onHeartbeat: (t) => {
        tickReportReceived = t;
      },
      onHealthAudit: (a) => {
        auditReceived = a;
      },
      onViolation: (f) => {
        findingReceived = f;
      },
      onReactiveWakeup: (_, t) => {
        wakeupReceived = t;
      },
      onIntervalAdjusted: () => {
        adjustedCount++;
      },
    });

    expect(watchdog.heartbeatIntervalMs).toBe(60_000);
    expect(watchdog.timeoutMs).toBe(120_000);
    expect(watchdog.generation).toBe(3);
    expect(watchdog.pulseId).toBe("pulse-xyz");
    expect(watchdog.capsuleRoot).toBe("/tmp/capsule-test");
    expect(watchdog.enforcePreFlightGates).toBe(false);

    const report = await watchdog.tick(1700000000000);
    expect(report.tickCount).toBe(1);
    expect(tickReportReceived).not.toBeNull();
    expect(auditReceived).not.toBeNull();

    await watchdog.triggerReactiveWakeup("manual_event", 1700000001000);
    expect(wakeupReceived).not.toBeNull();
    expect(findingReceived).toBeNull();

    watchdog.boostActivity(0.5, 1700000002000);
    expect(adjustedCount).toBeGreaterThan(0);
  });

  it("manages start, stop, and dispose lifecycle cleanly with redundant calls", () => {
    const watchdog = new AutonomicWatchdog({ heartbeatIntervalMs: 50 });
    expect(watchdog.isRunning()).toBe(false);

    watchdog.start();
    expect(watchdog.isRunning()).toBe(true);

    watchdog.start();
    expect(watchdog.isRunning()).toBe(true);

    watchdog.stop();
    expect(watchdog.isRunning()).toBe(false);

    watchdog.stop();
    expect(watchdog.isRunning()).toBe(false);

    watchdog.start();
    watchdog.dispose();
    expect(watchdog.isRunning()).toBe(false);
    expect(watchdog.getBootGateEnforcer().getAllRecords().length).toBe(0);
  });

  it("registers subagents, records proofs, commands, and formats CLI status reports", async () => {
    const watchdog = new AutonomicWatchdog({ heartbeatIntervalMs: 180_000 });
    watchdog.registerSubagent({
      agentId: "subagent-alpha",
      role: "implementer",
      taskId: "task-alpha",
    });
    watchdog.recordWhoami("subagent-alpha");
    watchdog.recordDoctor("subagent-alpha");
    watchdog.recordCommand("subagent-alpha", ["whoami"], undefined, 0, 1234, "whoami");
    watchdog.recordHeartbeat("subagent-alpha", "task-alpha");
    watchdog.recordActivity("subagent-alpha", "task-alpha");
    watchdog.assertBootGatesPassed("subagent-alpha");

    const reportText = await watchdog.renderCliStatusReport();
    expect(reportText).toContain("Autonomic Watchdog Status & Boot-Gate Enforcer");
    expect(reportText).toContain("subagent-alpha");
  });

  it("handles event notification, process health updates, and state auditing", async () => {
    const watchdog = new AutonomicWatchdog({ heartbeatIntervalMs: 10_000 });
    const events: unknown[] = [];
    watchdog.on("task_done", (e) => events.push(e));

    watchdog.notifyEvent({ type: "task_done", agentId: "agent-1", taskId: "t-1" });
    expect(events.length).toBe(1);

    watchdog.registerSubagent({ agentId: "agent-1", role: "implementer", pid: 9999 });
    const updated = watchdog.getBootGateEnforcer().updateProcessHealth("agent-1", {
      pid: 9999,
      alive: true,
      checkedAt: "2026-08-20T12:00:00.000Z",
    });
    expect(updated?.lastProcessHealth?.alive).toBe(true);

    const findings = watchdog.getBootGateEnforcer().auditFindings();
    expect(findings.length).toBe(1);

    const auditedRecords = watchdog.getBootGateEnforcer().auditSubagentBootGatesFromState({
      agents: [{ id: "agent-state", role: "implementer" }],
    });
    expect(auditedRecords.length).toBe(2);
    expect(watchdog.getBootGateEnforcer().getRecord("agent-1")?.pid).toBe(9999);
  });
});
