import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AutonomicWatchdog,
  type ReactiveEvent,
  type WatchdogFinding,
  type WatchdogHealthAuditReport,
} from "../../olt/scripts/src/watchdog/index.ts";
import { cleanupVirtualWatchdogFS, setupVirtualWatchdogFS } from "./watchdog-fixture.ts";

describe("AutonomicWatchdog Uncovered Functions & Edge Paths", () => {
  beforeEach(() => {
    setupVirtualWatchdogFS();
  });

  afterEach(() => {
    cleanupVirtualWatchdogFS();
  });

  it("handles CLI proof recording, process health checks, and boot gate assertions", async () => {
    const watchdog = new AutonomicWatchdog({
      processLivenessChecker: (pid: number) => pid === 100,
    });

    watchdog.registerSubagent({ agentId: "sub-1", role: "implementer", pid: 100 });
    const proofRecord = watchdog.recordCliProof({
      gate: "whoami",
      actor: "sub-1",
      argv: ["whoami"],
      verified: true,
      executedAt: "2026-08-20T12:00:00.000Z",
    });
    expect(proofRecord?.whoamiExecuted).toBe(true);

    const singleHealth = watchdog.checkProcessHealth(100, "sub-1");
    expect(singleHealth.alive).toBe(true);

    const auditHealth = watchdog.auditProcessHealth();
    expect(auditHealth.length).toBeGreaterThan(0);
    expect(auditHealth[0]?.pid).toBe(100);

    watchdog.recordWhoami("sub-1", undefined, { verified: true });
    watchdog.recordDoctor("sub-1", undefined, { verified: true });
    watchdog.recordCommand("sub-1", ["echo", "ok"], undefined, 0, 100, "ok");
    watchdog.recordHeartbeat("sub-1", "task-1");
    watchdog.assertBootGatesPassed("sub-1", "custom verification", true);

    const report = await watchdog.renderCliStatusReport();
    expect(report).toContain("sub-1");
    expect(watchdog.getBootGateEnforcer()).toBeDefined();

    watchdog.dispose();
  });

  it("manages adaptive controller configuration, getters, bounds, and resetInterval", () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 30_000,
      minIntervalMs: 1200,
      maxIntervalMs: 45_000,
      backoffFactor: 1.8,
      activityBoost: 0.6,
      adaptive: { minIntervalMs: 2000, maxIntervalMs: 40000 },
    });

    expect(watchdog.currentIntervalMs).toBe(30_000);
    expect(watchdog.minIntervalMs).toBe(2000);
    expect(watchdog.maxIntervalMs).toBe(40000);
    expect(watchdog.backoffFactor).toBe(1.8);
    expect(watchdog.activityBoost).toBe(0.6);
    expect(watchdog.isAdaptive()).toBe(true);
    expect(watchdog.getCurrentIntervalMs()).toBe(30_000);

    const state = watchdog.getAdaptiveState();
    expect(state.currentIntervalMs).toBe(30_000);

    watchdog.configureAdaptiveTimers({ minIntervalMs: 1500, maxIntervalMs: 50000 });
    expect(watchdog.minIntervalMs).toBe(1500);
    expect(watchdog.maxIntervalMs).toBe(50000);

    watchdog.setAdaptiveBounds({ minIntervalMs: 1000, maxIntervalMs: 60000 });
    expect(watchdog.minIntervalMs).toBe(1000);

    watchdog.resetInterval(10000);
    expect(watchdog.getCurrentIntervalMs()).toBe(10000);

    watchdog.boostActivity(0.5);
    watchdog.decayIdle(3.0, undefined, "idle_backoff");
    expect(watchdog.getCurrentIntervalMs()).toBeGreaterThan(10000);
  });

  it("registers, handles, and removes event listeners including custom events", () => {
    const watchdog = new AutonomicWatchdog();
    const captured: ReactiveEvent[] = [];
    const listener = (event: ReactiveEvent) => {
      captured.push(event);
    };

    const unsubscribe = watchdog.addEventListener("custom_event", listener);
    watchdog.emitCustomEvent({ type: "custom_event", timestamp: "2026-08-20T12:00:00.000Z" });
    expect(captured.length).toBe(1);

    unsubscribe();
    watchdog.emitCustomEvent({ type: "custom_event", timestamp: "2026-08-20T12:00:01.000Z" });
    expect(captured.length).toBe(1);

    watchdog.on("test_off", listener);
    watchdog.off("test_off", listener);
    watchdog.removeEventListener("test_off", listener);
  });

  it("emits stall_detected and process_failure_detected during health audit", async () => {
    let stallEventFound = false;
    let procFailureFound = false;
    let criticalViolationCount = 0;
    let violationCallbackCount = 0;

    const watchdog = new AutonomicWatchdog({
      timeoutMs: 1000,
      processLivenessChecker: (pid: number) => pid !== 999,
      onViolation: (_f: WatchdogFinding) => {
        violationCallbackCount++;
      },
    });

    watchdog.on("stall_detected", () => {
      stallEventFound = true;
    });
    watchdog.on("process_failure_detected", () => {
      procFailureFound = true;
    });
    watchdog.on("critical_violation", () => {
      criticalViolationCount++;
    });

    watchdog.registerSubagent({ agentId: "dead-agent", role: "implementer", pid: 999 });
    watchdog.recordActivity("stalled-agent", "task-x", 1000);

    const report: WatchdogHealthAuditReport = await watchdog.runHealthAudit(5000);
    expect(report.healthy).toBe(false);
    expect(stallEventFound).toBe(true);
    expect(procFailureFound).toBe(true);
    expect(criticalViolationCount).toBeGreaterThan(0);
    expect(violationCallbackCount).toBeGreaterThan(0);
  });

  it("executes timer lifecycle, notifyEvent, and reactive wakeup during running state", async () => {
    let wakeups = 0;
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 10,
      minIntervalMs: 10,
      maxIntervalMs: 50,
      adaptive: false,
      onReactiveWakeup: () => {
        wakeups++;
      },
    });

    watchdog.start();
    expect(watchdog.isRunning()).toBe(true);

    const report = await watchdog.notifyEvent(
      { type: "worker_idle", agentId: "agent-live", taskId: "task-live" },
      Date.now(),
    );
    expect(report.tickCount).toBe(1);
    expect(wakeups).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(watchdog.getTickCount()).toBeGreaterThanOrEqual(2);

    watchdog.stop();
    expect(watchdog.isRunning()).toBe(false);
  });
});
