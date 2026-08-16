import { describe, expect, it } from "bun:test";
import { OrchestratorWatchdog } from "../../../orchestrating-long-tasks/scripts/src/orchestrator/watchdog.ts";
import type { WatchdogEvent } from "../../../orchestrating-long-tasks/scripts/src/orchestrator/types.ts";

describe("OrchestratorWatchdog Unit Tests", () => {
  it("registers and unregisters monitors correctly", () => {
    const watchdog = new OrchestratorWatchdog();
    const monitor = watchdog.registerMonitor("mon-1", {
      agentId: "agent-coord",
      taskId: "task-01",
      runId: "run-alpha",
    });

    expect(monitor.id).toBe("mon-1");
    expect(monitor.agentId).toBe("agent-coord");
    expect(monitor.taskId).toBe("task-01");
    expect(monitor.runId).toBe("run-alpha");
    expect(monitor.status).toBe("active");
    expect(monitor.wakeAttempts).toBe(0);

    expect(watchdog.getMonitor("mon-1")).toBeDefined();
    expect(watchdog.getAllMonitors().length).toBe(1);

    const unregistered = watchdog.unregisterMonitor("mon-1");
    expect(unregistered).toBe(true);
    expect(watchdog.getMonitor("mon-1")).toBeUndefined();
    expect(watchdog.getAllMonitors().length).toBe(0);
    expect(watchdog.unregisterMonitor("non-existent")).toBe(false);
  });

  it("records heartbeat and activity accurately", () => {
    const watchdog = new OrchestratorWatchdog();
    const mon = watchdog.registerMonitor("mon-1", {
      agentId: "agent-w1",
      taskId: "task-01",
      runId: "run-1",
    });

    const initialHeartbeat = mon.lastHeartbeatAt;
    const initialActivity = mon.lastActivityAt;

    const updatedHeartbeat = watchdog.recordHeartbeat("agent-w1", "task-01", "run-1");
    expect(updatedHeartbeat).toBe(true);
    expect(mon.lastHeartbeatAt).toBeGreaterThanOrEqual(initialHeartbeat);

    const updatedActivity = watchdog.recordActivity("agent-w1", "task-01", "run-1");
    expect(updatedActivity).toBe(true);
    expect(mon.lastActivityAt).toBeGreaterThanOrEqual(initialActivity);

    expect(watchdog.recordHeartbeat("unknown-agent")).toBe(false);
    expect(watchdog.recordActivity("unknown-agent")).toBe(false);
  });

  it("detects missed heartbeats and idle stalls in health check", () => {
    const watchdog = new OrchestratorWatchdog({
      heartbeatTimeoutMs: 500,
      idleTimeoutMs: 1000,
      wallClockTimeoutMs: 10000,
    });

    const startTime = Date.now();
    watchdog.registerMonitor("mon-1", {
      agentId: "agent-1",
      initialStartedAt: startTime,
    });

    const events: WatchdogEvent[] = [];
    watchdog.on("stall_detected", (e) => events.push(e));

    // Initially healthy
    let health = watchdog.checkHealth(startTime + 100);
    expect(health.healthy).toBe(true);
    expect(health.activeCount).toBe(1);
    expect(health.stalledCount).toBe(0);

    // Heartbeat expired at +600ms
    health = watchdog.checkHealth(startTime + 600);
    expect(health.healthy).toBe(false);
    expect(health.activeCount).toBe(0);
    expect(health.stalledCount).toBe(1);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe("stall_detected");
    expect(events[0]?.monitorId).toBe("mon-1");
  });

  it("detects wall-clock timeouts", () => {
    const watchdog = new OrchestratorWatchdog({
      heartbeatTimeoutMs: 10000,
      idleTimeoutMs: 10000,
      wallClockTimeoutMs: 2000,
    });

    const startTime = Date.now();
    const mon = watchdog.registerMonitor("mon-wall", {
      agentId: "agent-1",
      initialStartedAt: startTime,
    });

    const events: WatchdogEvent[] = [];
    watchdog.on("timeout", (e) => events.push(e));

    const health = watchdog.checkHealth(startTime + 2500);
    expect(health.healthy).toBe(false);
    expect(health.timedOutCount).toBe(1);
    expect(mon.status).toBe("timed_out");
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe("timeout");
  });

  it("recovers from stall when fresh heartbeat is received", () => {
    const watchdog = new OrchestratorWatchdog({
      heartbeatTimeoutMs: 100,
    });

    const startTime = Date.now();
    const mon = watchdog.registerMonitor("mon-rec", {
      agentId: "agent-rec",
      initialStartedAt: startTime,
    });

    const events: WatchdogEvent[] = [];
    watchdog.on("recovered", (e) => events.push(e));

    // Force stall
    watchdog.checkHealth(startTime + 200);
    expect(mon.status).toBe("stalled");

    // Receive heartbeat
    const recovered = watchdog.recordHeartbeat("agent-rec");
    expect(recovered).toBe(true);
    expect(mon.status).toBe("active");
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe("recovered");
  });

  it("triggers auto-wake and bounds retries before escalation", () => {
    const watchdog = new OrchestratorWatchdog({
      maxWakeRetries: 2,
      autoWakeAction: "nudge",
    });

    watchdog.registerMonitor("mon-wake", { agentId: "agent-wake" });

    const wakeEvents: WatchdogEvent[] = [];
    const escalateEvents: WatchdogEvent[] = [];
    watchdog.on("auto_wake", (e) => wakeEvents.push(e));
    watchdog.on("escalated", (e) => escalateEvents.push(e));

    // Attempt 1
    const res1 = watchdog.triggerAutoWake("mon-wake", "Stall 1");
    expect(res1.succeeded).toBe(true);
    expect(res1.attempt).toBe(1);
    expect(res1.actionTaken).toBe("nudge");

    // Attempt 2
    const res2 = watchdog.triggerAutoWake("mon-wake", "Stall 2");
    expect(res2.succeeded).toBe(true);
    expect(res2.attempt).toBe(2);

    // Attempt 3 (exceeds maxWakeRetries = 2 -> escalates)
    const res3 = watchdog.triggerAutoWake("mon-wake", "Stall 3");
    expect(res3.succeeded).toBe(false);
    expect(res3.attempt).toBe(3);
    expect(res3.actionTaken).toBe("escalate");

    expect(wakeEvents.length).toBe(2);
    expect(escalateEvents.length).toBe(1);
    expect(watchdog.getMonitor("mon-wake")?.status).toBe("escalated");

    // Non-existent monitor
    const unknownRes = watchdog.triggerAutoWake("unknown-id");
    expect(unknownRes.succeeded).toBe(false);
  });

  it("escalates via background polling interval when maxWakeRetries is reached", async () => {
    const watchdog = new OrchestratorWatchdog({
      pollIntervalMs: 10,
      heartbeatTimeoutMs: 5,
      idleTimeoutMs: 5,
      maxWakeRetries: 1,
    });

    const escalatedEvents: WatchdogEvent[] = [];
    watchdog.on("escalated", (e) => escalatedEvents.push(e));

    const mon = watchdog.registerMonitor("mon-poll-esc", {
      agentId: "agent-poll",
      initialStartedAt: Date.now() - 50,
    });
    mon.lastHeartbeatAt = Date.now() - 50;
    mon.lastActivityAt = Date.now() - 50;

    watchdog.start();

    // Wait for polling cycles
    await new Promise((resolve) => setTimeout(resolve, 60));

    watchdog.stop();

    expect(escalatedEvents.length).toBeGreaterThanOrEqual(1);
    expect(mon.status).toBe("escalated");
    expect(mon.wakeAttempts).toBeGreaterThan(1);
  });

  it("supports starting, stopping, and disposing polling timer cleanly", () => {
    const watchdog = new OrchestratorWatchdog({
      pollIntervalMs: 50,
      heartbeatTimeoutMs: 100,
    });

    expect(watchdog.isMonitoring()).toBe(false);
    watchdog.start();
    expect(watchdog.isMonitoring()).toBe(true);

    // Redundant start is a no-op
    watchdog.start();
    expect(watchdog.isMonitoring()).toBe(true);

    watchdog.stop();
    expect(watchdog.isMonitoring()).toBe(false);

    // Redundant stop is a no-op
    watchdog.stop();
    expect(watchdog.isMonitoring()).toBe(false);

    watchdog.dispose();
    expect(watchdog.getAllMonitors().length).toBe(0);
  });

  it("supports wildcard event listeners and unsubscription", () => {
    const watchdog = new OrchestratorWatchdog();
    watchdog.registerMonitor("mon-wild", { agentId: "agent-wild" });

    const allEvents: WatchdogEvent[] = [];
    const unsubscribe = watchdog.on("*", (e) => allEvents.push(e));

    watchdog.triggerAutoWake("mon-wild", "Testing wildcard");
    expect(allEvents.length).toBe(1);

    unsubscribe();
    watchdog.triggerAutoWake("mon-wild", "Testing unsubscribe");
    expect(allEvents.length).toBe(1);
  });
});
