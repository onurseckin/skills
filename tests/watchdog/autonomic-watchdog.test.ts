import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  type ReactiveEvent,
  type WatchdogEvent,
  type WatchdogFinding,
  type WatchdogHealthAuditReport,
  type WatchdogTickReport,
} from "../../olt/scripts/src/watchdog/index.ts";

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

  it("initializes with custom parameters and callbacks", async () => {
    let tickReportReceived: WatchdogTickReport | null = null;
    let auditReceived: WatchdogHealthAuditReport | null = null;
    let findingReceived: WatchdogFinding | null = null;
    let wakeupReceived: WatchdogTickReport | null = null;

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
  });

  it("manages start, stop, and dispose lifecycle cleanly", () => {
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
  });
});

describe("AutonomicWatchdog Adaptive Timers & Event Dispatching", () => {
  it("tracks event listeners and custom event emissions", () => {
    const watchdog = new AutonomicWatchdog();
    const events: WatchdogEvent[] = [];
    const unsubscribe = watchdog.on("tick", (e) => {
      events.push(e);
    });

    const remove = watchdog.addEventListener("stall_detected", (e) => {
      events.push(e);
    });
    expect(typeof unsubscribe).toBe("function");
    expect(typeof remove).toBe("function");

    const customEvent: ReactiveEvent = { type: "task_completed", agentId: "agent-1" };
    watchdog.emitCustomEvent(customEvent);

    watchdog.removeEventListener("stall_detected", () => {});
    watchdog.off("tick", () => {});
  });

  it("modifies intervals dynamically via boost, decay, and reset", () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 100_000,
      minIntervalMs: 10_000,
      maxIntervalMs: 100_000,
      activityBoost: 0.5,
      backoffFactor: 1.5,
    });

    const boosted = watchdog.boostActivity(0.5, 1700000000000);
    expect(boosted).toBe(50_000);
    expect(watchdog.currentIntervalMs).toBe(50_000);

    const decayed = watchdog.decayIdle(1.5, 1700000001000);
    expect(decayed).toBe(75_000);
    expect(watchdog.currentIntervalMs).toBe(75_000);

    watchdog.resetInterval(100_000, 1700000002000);
    expect(watchdog.currentIntervalMs).toBe(100_000);

    watchdog.configureAdaptiveTimers({ minIntervalMs: 5_000, maxIntervalMs: 60_000 });
    expect(watchdog.minIntervalMs).toBe(5_000);
    expect(watchdog.maxIntervalMs).toBe(60_000);

    const state = watchdog.getAdaptiveState();
    expect(state.enabled).toBe(true);
    expect(state.minIntervalMs).toBe(5_000);
    expect(state.maxIntervalMs).toBe(60_000);
  });

  it("notifies events and records agent activities during reactive wakeups", async () => {
    const watchdog = new AutonomicWatchdog({ heartbeatIntervalMs: 100_000 });
    watchdog.registerSubagent(
      { agentId: "impl-node-01", role: "implementer", taskId: "task-01" },
      1700000000000,
    );
    watchdog.recordWhoami("impl-node-01", 1700000000000);
    watchdog.recordDoctor("impl-node-01", 1700000000000);

    const tickReport = await watchdog.notifyEvent(
      { type: "task_progress", agentId: "impl-node-01", taskId: "task-01" },
      1700000001000,
    );

    expect(tickReport.tickCount).toBe(1);
    expect(tickReport.health.healthy).toBe(true);
  });
});

describe("AutonomicWatchdog Subagent Verification & CLI Status Report", () => {
  it("records command, heartbeat, proof, and generates status report", async () => {
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
});

describe("AutonomicWatchdog Invariants & Cleanliness", () => {
  it("enforces zero any and zero suppression directives in test and target files", () => {
    const enginePath = join(
      __dirname,
      "../../../olt/scripts/src/watchdog/autonomic-watchdog/watchdog-engine.ts",
    );
    const content = readFileSync(enginePath, "utf8");

    expect(content).not.toMatch(new RegExp(":\\s*any\\b"));
    expect(content).not.toMatch(new RegExp("as\\s+any\\b"));
    expect(content).not.toMatch(new RegExp("<\\s*any\\s*>"));
    expect(content.includes("@ts-ignore")).toBe(false);
    expect(content.includes("@ts-expect-error")).toBe(false);
    expect(content.includes("@ts-nocheck")).toBe(false);
    expect(content.includes("eslint-disable")).toBe(false);
    expect(content.includes("oxlint-disable")).toBe(false);
  });
});
