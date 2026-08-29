import { describe, expect, test } from "bun:test";
import {
  ERROR_CLASS_STALL_TIMEOUT,
  ERROR_CLASS_ZOMBIE_PROCESS,
  EXIT_STATUS_SIGKILL_TIMEOUT,
  HierarchicalStallProbe,
  ProcessTimeoutWatchdog,
  createHierarchicalStallProbe,
  createProcessTimeoutWatchdog,
} from "../../../../olt/scripts/src/engine/runner/process/process-timeout-watchdog.ts";

describe("HierarchicalStallProbe - Supervisor-to-Child Health Probing", () => {
  test("creates probe with supervisor tier and registers child nodes", () => {
    const probe = createHierarchicalStallProbe("coordinator", {
      supervisorId: "coord-lead-1",
      defaultWallTimeoutMs: 60_000,
      defaultIdleTimeoutMs: 30_000,
    });

    expect(probe.supervisorTier).toBe("coordinator");
    expect(probe.supervisorId).toBe("coord-lead-1");

    const wd = probe.registerChild({
      childId: "child-critic-1",
      role: "completeness_critic",
      supervisorTier: "coordinator",
      pid: 8001,
      taskId: "task-test-gate",
    });

    expect(wd).toBeInstanceOf(ProcessTimeoutWatchdog);
    expect(probe.getChild("child-critic-1")?.pid).toBe(8001);
    expect(probe.listChildren().length).toBe(1);
  });

  test("probes active children and reports healthy state when alive", () => {
    let now = 1_000_000;
    const probe = new HierarchicalStallProbe({
      supervisorTier: "coordinator",
      now: () => now,
    });

    probe.registerChild({
      childId: "child-worker-1",
      role: "task_implementer",
      supervisorTier: "coordinator",
      pid: 8002,
    });

    now += 5_000;
    const result = probe.probeChild("child-worker-1");
    expect(result.alive).toBe(true);
    expect(result.stalled).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.failurePayload).toBeUndefined();
  });

  test("detects stalled children and synthesizes failure payload with STALL_TIMEOUT", () => {
    let now = 1_000_000;
    const probe = new HierarchicalStallProbe({
      supervisorTier: "coordinator",
      defaultWallTimeoutMs: 300_000,
      defaultIdleTimeoutMs: 300_000,
      defaultStallThresholdMs: 60_000,
      now: () => now,
    });

    probe.registerChild({
      childId: "stalled-critic",
      role: "completeness_critic",
      supervisorTier: "coordinator",
      pid: 9005,
      taskId: "task-critic-audit",
    });

    probe.recordChildOutput("stalled-critic", "stdout", "running suite...\n");
    now += 65_000;

    const stalledList = probe.detectStalledChildren();
    expect(stalledList.length).toBe(1);
    expect(stalledList[0]?.childId).toBe("stalled-critic");
    expect(stalledList[0]?.stalled).toBe(true);
    expect(stalledList[0]?.failurePayload).toBeDefined();

    const payload = stalledList[0]?.failurePayload;
    expect(payload?.exitStatus).toBe(EXIT_STATUS_SIGKILL_TIMEOUT);
    expect(payload?.errorClassification).toBe(ERROR_CLASS_STALL_TIMEOUT);
    expect(payload?.childRole).toBe("completeness_critic");
    expect(payload?.remediationGuidance.defectReference).toBe("defect-20260822-24");
  });

  test("handles child stall: enforces SIGKILL, returns failure payload, unregisters child", async () => {
    const signalsReceived: NodeJS.Signals[] = [];
    const probe = new HierarchicalStallProbe({
      supervisorTier: "coordinator",
      killProcessTree: (_pid, sig) => {
        signalsReceived.push(sig);
        return true;
      },
    });

    probe.registerChild({
      childId: "hung-implementer",
      role: "task_implementer",
      supervisorTier: "coordinator",
      pid: 9911,
      taskId: "task-hang-recovery",
    });

    probe.recordChildOutput("hung-implementer", "stderr", "hang log...\n");

    const payload = await probe.handleChildStall("hung-implementer", { graceMs: 0 });

    expect(payload.exitStatus).toBe(EXIT_STATUS_SIGKILL_TIMEOUT);
    expect(payload.errorClassification).toBe(ERROR_CLASS_STALL_TIMEOUT);
    expect(payload.diagnostics.stderrTail).toContain("hang log...");
    expect(signalsReceived).toContain("SIGKILL");
    expect(probe.getChild("hung-implementer")).toBeUndefined();
  });

  test("probes non-registered child and flags as zombie process", () => {
    const probe = new HierarchicalStallProbe({
      supervisorTier: "orchestrator",
    });

    const result = probe.probeChild("unknown-ghost-child");
    expect(result.alive).toBe(false);
    expect(result.stalled).toBe(true);
    expect(result.errorClassification).toBe(ERROR_CLASS_ZOMBIE_PROCESS);
  });
});

describe("MultiChildSupervisorWatchdog and Default ProcessTimeoutWatchdog Methods", () => {
  test("exercises MultiChildSupervisorWatchdog methods and defaults", () => {
    const supervisor = createHierarchicalStallProbe("coordinator", {
      defaultWallTimeoutMs: 5000,
      defaultIdleTimeoutMs: 2000,
      defaultStallThresholdMs: 3000,
      graceMs: 100,
    });
    const child = supervisor.registerChild({
      childId: "child-1",
      pid: 12345,
      ppid: process.pid,
      taskId: "task-1",
      role: "task_implementer",
    });
    expect(child).toBeDefined();

    expect(supervisor.getChild("child-1")).toBeDefined();
    expect(supervisor.getChildWatchdog("child-1")).toBe(child);
    expect(supervisor.getChildWatchdog("nonexistent")).toBeUndefined();
    expect(supervisor.listChildren().length).toBe(1);

    supervisor.recordChildHeartbeat("child-1", { step: 1 });
    supervisor.recordChildHeartbeat("nonexistent");

    supervisor.recordChildProgress("child-1", "compiling");
    supervisor.recordChildProgress("nonexistent", "ignored");

    supervisor.recordChildOutput("child-1", "stdout", "output data");
    supervisor.recordChildOutput("nonexistent", "stderr", "ignored");

    const fallbackPayload = supervisor.synthesizeStallFailurePayload(
      "nonexistent-child",
      "probe reason",
    );
    expect(fallbackPayload.reason).toBe("probe reason");
    expect(fallbackPayload.errorClassification).toBe("STALL_TIMEOUT");

    expect(supervisor.unregisterChild("child-1")).toBe(true);
    expect(supervisor.unregisterChild("child-1")).toBe(false);
  });

  test("handleChildStall with enforceSigkill false", async () => {
    const supervisor = createHierarchicalStallProbe("coordinator");
    supervisor.registerChild({
      childId: "child-no-kill",
      pid: 12346,
      role: "worker",
    });
    const payload = await supervisor.handleChildStall("child-no-kill", { enforceSigkill: false });
    expect(payload.errorClassification).toBe("STALL_TIMEOUT");
  });

  test("createProcessTimeoutWatchdog factory with custom options", () => {
    const watchdog = createProcessTimeoutWatchdog({
      pid: 54321,
      wallTimeoutMs: 10000,
      idleTimeoutMs: 5000,
      supervisorTier: "mind",
      childRole: "orchestrator",
    });
    expect(watchdog.pid).toBe(54321);
    expect(watchdog.supervisorTier).toBe("mind");
    expect(watchdog.childRole).toBe("orchestrator");
  });

  test("ProcessTimeoutWatchdog and HierarchicalStallProbe default killFn handles dead processes", () => {
    const watchdog = new ProcessTimeoutWatchdog();
    const killed1 = (
      watchdog as unknown as { killFn: (pid: number, sig: NodeJS.Signals) => boolean }
    ).killFn(999999999, "SIGTERM");
    expect(killed1).toBe(false);

    const supervisor = new HierarchicalStallProbe({ supervisorTier: "coordinator" });
    const killed2 = (
      supervisor as unknown as { killFn: (pid: number, sig: NodeJS.Signals) => boolean }
    ).killFn(999999999, "SIGTERM");
    expect(killed2).toBe(false);
  });
});
