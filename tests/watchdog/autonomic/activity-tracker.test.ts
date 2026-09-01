import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { BootGateEnforcer } from "../../../olt/scripts/src/watchdog/boot-gate-enforcer/index.ts";
import { ActivityTracker } from "../../../olt/scripts/src/watchdog/autonomic-watchdog/activity-tracker.ts";
import type { LiveCliProof } from "../../../olt/scripts/src/watchdog/autonomic-watchdog/types.ts";
import { cleanupVirtualWatchdogFS, setupVirtualWatchdogFS } from "../watchdog-fixture.ts";

beforeEach(() => {
  setupVirtualWatchdogFS();
});

afterEach(() => {
  cleanupVirtualWatchdogFS();
});

describe("ActivityTracker Subagent State & Heartbeat Tracking", () => {
  it("registers subagents and records initial activity state across timestamp formats", () => {
    const enforcer = new BootGateEnforcer();
    const tracker = new ActivityTracker(enforcer);

    // Number timestamp
    tracker.registerSubagent({ agentId: "agent-1", role: "implementer", pid: 1234 }, 1700000000000);
    const act1 = tracker.activities.get("agent-1");
    expect(act1).not.toBeUndefined();
    expect(act1?.agentId).toBe("agent-1");
    expect(act1?.pid).toBe(1234);
    expect(act1?.lastHeartbeatAt).toBe(1700000000000);
    expect(act1?.lastActivityAt).toBe(1700000000000);
    expect(act1?.status).toBe("active");

    // Date object timestamp
    const dateObj = new Date("2026-08-20T12:00:00.000Z");
    tracker.registerSubagent({ agentId: "agent-2", role: "validator" }, dateObj);
    const act2 = tracker.activities.get("agent-2");
    expect(act2?.lastHeartbeatAt).toBe(dateObj.getTime());

    // ISO string timestamp
    tracker.registerSubagent({ agentId: "agent-3", role: "auditor" }, "2026-08-20T13:00:00.000Z");
    const act3 = tracker.activities.get("agent-3");
    expect(act3?.lastHeartbeatAt).toBe(Date.parse("2026-08-20T13:00:00.000Z"));

    // Undefined / fallback timestamp
    tracker.registerSubagent({ agentId: "agent-4", role: "repairer" });
    const act4 = tracker.activities.get("agent-4");
    expect(act4?.lastHeartbeatAt).toBeGreaterThan(0);
  });

  it("records whoami, doctor, cli proofs and commands updating activity timestamps", () => {
    const enforcer = new BootGateEnforcer();
    const tracker = new ActivityTracker(enforcer);

    tracker.registerSubagent({ agentId: "agent-live", role: "implementer" }, 1700000000000);

    tracker.recordWhoami("agent-live", 1700000001000);
    expect(tracker.activities.get("agent-live")?.lastActivityAt).toBe(1700000001000);

    tracker.recordDoctor("agent-live", 1700000002000);
    expect(tracker.activities.get("agent-live")?.lastActivityAt).toBe(1700000002000);

    const proof: LiveCliProof = {
      gate: "whoami",
      actor: "agent-live",
      argv: ["bun", "whoami"],
      exitCode: 0,
      executedAt: "2026-08-20T12:00:00.000Z",
      verified: true,
    };
    tracker.recordCliProof(proof, 1700000003000);
    expect(tracker.activities.get("agent-live")?.lastActivityAt).toBe(1700000003000);

    tracker.recordCommand("agent-live", ["git", "status"], 1700000004000, 0, 9999, "clean");
    expect(tracker.activities.get("agent-live")?.lastActivityAt).toBe(1700000004000);
  });

  it("updates heartbeats and activity independently with taskId preservation", () => {
    const enforcer = new BootGateEnforcer();
    const tracker = new ActivityTracker(enforcer);

    tracker.registerSubagent(
      { agentId: "worker-1", role: "implementer", taskId: "task-orig", pid: 5000 },
      1700000000000,
    );

    // Record activity updates lastActivityAt without altering lastHeartbeatAt
    tracker.recordActivity("worker-1", undefined, 1700000005000);
    let act = tracker.activities.get("worker-1");
    expect(act?.lastHeartbeatAt).toBe(1700000000000);
    expect(act?.lastActivityAt).toBe(1700000005000);
    expect(act?.taskId).toBe("task-orig");
    expect(act?.pid).toBe(5000);

    // Record heartbeat updates both lastHeartbeatAt and lastActivityAt
    tracker.recordHeartbeat("worker-1", "task-updated", 1700000010000);
    act = tracker.activities.get("worker-1");
    expect(act?.lastHeartbeatAt).toBe(1700000010000);
    expect(act?.lastActivityAt).toBe(1700000010000);
    expect(act?.taskId).toBe("task-updated");

    tracker.clear();
    expect(tracker.activities.size).toBe(0);
  });
});
