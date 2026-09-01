import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  createHierarchicalStallProbe,
  HierarchicalStallProbe,
} from "../../../olt/scripts/src/watchdog/process-timeout/index.ts";
import { cleanupVirtualWatchdogFS, setupVirtualWatchdogFS } from "../watchdog-fixture.ts";

beforeEach(() => {
  setupVirtualWatchdogFS();
});

afterEach(() => {
  cleanupVirtualWatchdogFS();
});

describe("HierarchicalStallProbe Supervisory Probing", () => {
  it("registers, retrieves, unregisters, and lists child nodes", () => {
    const probe = createHierarchicalStallProbe("coordinator", { supervisorId: "coord-01" });
    expect(probe.supervisorTier).toBe("coordinator");
    expect(probe.supervisorId).toBe("coord-01");

    const wd = probe.registerChild({
      childId: "child-1",
      role: "task_implementer",
      taskId: "task-1",
      pid: 1111,
    });
    expect(wd).not.toBeUndefined();
    expect(probe.getChild("child-1")?.childId).toBe("child-1");
    expect(probe.getChildWatchdog("child-1")).toBe(wd);
    expect(probe.listChildren().length).toBe(1);

    probe.recordChildHeartbeat("child-1", { step: 1 });
    probe.recordChildProgress("child-1", "Processed files");
    probe.recordChildOutput("child-1", "stdout", "Log line\n");

    expect(probe.unregisterChild("child-1")).toBe(true);
    expect(probe.getChild("child-1")).toBeUndefined();
    expect(probe.listChildren().length).toBe(0);
  });

  it("probes individual children and detects healthy vs stalled execution", () => {
    let now = 1700000000000;
    const probe = new HierarchicalStallProbe({
      supervisorTier: "coordinator",
      defaultWallTimeoutMs: 60_000,
      defaultIdleTimeoutMs: 30_000,
      defaultStallThresholdMs: 5_000,
      now: () => now,
    });

    probe.registerChild({
      childId: "child-healthy",
      role: "task_implementer",
      startedAt: now,
    });

    const resHealthy = probe.probeChild("child-healthy", now + 1000);
    expect(resHealthy.alive).toBe(true);
    expect(resHealthy.stalled).toBe(false);

    // Keep activity alive but do not send progress past stall threshold
    probe.recordChildOutput("child-healthy", "stdout", "Working...\n");
    const resStalled = probe.probeChild("child-healthy", now + 7000);
    expect(resStalled.alive).toBe(false);
    expect(resStalled.stalled).toBe(true);
    expect(resStalled.failurePayload).not.toBeUndefined();
    expect(resStalled.failurePayload?.errorClassification).toBe("STALL_TIMEOUT");

    // Probe unregistered child returns zombie failure
    const resUnknown = probe.probeChild("child-unknown", now);
    expect(resUnknown.alive).toBe(false);
    expect(resUnknown.errorClassification).toBe("ZOMBIE_PROCESS");
  });

  it("detects and handles all stalled children across supervisor probe registry", async () => {
    let now = 1700000000000;
    const signalsSent: NodeJS.Signals[] = [];

    const probe = new HierarchicalStallProbe({
      supervisorTier: "orchestrator",
      defaultWallTimeoutMs: 10_000,
      now: () => now,
      killProcessTree: (_, sig) => {
        signalsSent.push(sig);
        return true;
      },
      wait: async () => {},
    });

    probe.registerChild({ childId: "c1", role: "coordinator", pid: 2001, startedAt: now });
    probe.registerChild({ childId: "c2", role: "coordinator", pid: 2002, startedAt: now });

    expect(probe.detectStalledChildren(now).length).toBe(0);

    now += 15_000;
    const stalledList = probe.detectStalledChildren(now);
    expect(stalledList.length).toBe(2);

    const failurePayload = await probe.handleChildStall("c1", { enforceSigkill: true, graceMs: 0 });
    expect(failurePayload.childPid).toBe(2001);
    expect(probe.getChild("c1")).toBeUndefined();
    expect(signalsSent).toEqual(["SIGKILL"]);
  });
});
