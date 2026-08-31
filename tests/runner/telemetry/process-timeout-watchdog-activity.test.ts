import { describe, expect, test } from "bun:test";
import {
  ERROR_CLASS_IDLE_TIMEOUT,
  ERROR_CLASS_STALL_TIMEOUT,
  ERROR_CLASS_WALL_TIMEOUT,
  ProcessTimeoutWatchdog,
  createProcessTimeoutWatchdog,
} from "../../../../olt/scripts/src/engine/runner/process/process-timeout-watchdog.ts";

describe("ProcessTimeoutWatchdog - Initialization & Defaults", () => {
  test("initializes with default test timeout limits of 60s wall and 30s idle", () => {
    const watchdog = createProcessTimeoutWatchdog();
    expect(watchdog.wallTimeoutMs).toBe(60_000);
    expect(watchdog.idleTimeoutMs).toBe(30_000);
    expect(watchdog.stallProgressThresholdMs).toBe(60_000);
    expect(watchdog.heartbeatIntervalMs).toBe(1_000);
    expect(watchdog.supervisorTier).toBe("coordinator");
    expect(watchdog.childRole).toBe("task_implementer");
  });

  test("accepts custom configurable wall, idle, and stall limits", () => {
    const watchdog = new ProcessTimeoutWatchdog({
      pid: 9999,
      ppid: 1000,
      taskId: "task-test-1",
      gateId: "gate-test-1",
      agentId: "agent-sub-1",
      supervisorTier: "orchestrator",
      childRole: "coordinator",
      wallTimeoutMs: 15_000,
      idleTimeoutMs: 5_000,
      stallProgressThresholdMs: 10_000,
      heartbeatIntervalMs: 500,
      graceMs: 200,
    });

    expect(watchdog.pid).toBe(9999);
    expect(watchdog.ppid).toBe(1000);
    expect(watchdog.taskId).toBe("task-test-1");
    expect(watchdog.gateId).toBe("gate-test-1");
    expect(watchdog.agentId).toBe("agent-sub-1");
    expect(watchdog.supervisorTier).toBe("orchestrator");
    expect(watchdog.childRole).toBe("coordinator");
    expect(watchdog.wallTimeoutMs).toBe(15_000);
    expect(watchdog.idleTimeoutMs).toBe(5_000);
    expect(watchdog.stallProgressThresholdMs).toBe(10_000);
    expect(watchdog.heartbeatIntervalMs).toBe(500);
    expect(watchdog.graceMs).toBe(200);
  });
});

describe("ProcessTimeoutWatchdog - Activity, Buffers, & Diagnostics", () => {
  test("records stdout/stderr text and byte counts, maintaining tail buffer", () => {
    let now = 1_000_000;
    const watchdog = new ProcessTimeoutWatchdog({
      now: () => now,
      maxTailBytes: 100,
    });

    watchdog.recordActivity("stdout", "line 1\n");
    watchdog.recordActivity("stdout", "line 2\n");
    watchdog.recordActivity("stderr", "error log 1\n");

    const diag = watchdog.getDiagnostics();
    expect(diag.stdoutTail).toContain("line 1\nline 2\n");
    expect(diag.stderrTail).toContain("error log 1\n");
    expect(diag.stdoutBytes).toBe(14);
    expect(diag.stderrBytes).toBe(12);
  });

  test("records Uint8Array binary output and decodes properly", () => {
    const watchdog = new ProcessTimeoutWatchdog();
    const encoder = new TextEncoder();
    watchdog.recordActivity("stdout", encoder.encode("binary chunks"));

    const diag = watchdog.getDiagnostics();
    expect(diag.stdoutTail).toBe("binary chunks");
    expect(diag.stdoutBytes).toBe(13);
  });

  test("trims stdout/stderr buffers when exceeding maxTailBytes", () => {
    const watchdog = new ProcessTimeoutWatchdog({
      maxTailBytes: 20,
    });

    watchdog.recordActivity("stdout", "first chunk 1234567890\n");
    watchdog.recordActivity("stdout", "second chunk 1234567890\n");

    const diag = watchdog.getDiagnostics();
    expect(diag.stdoutTail.length).toBe(20);
    expect(diag.stdoutTail).toBe("nd chunk 1234567890\n");
  });

  test("emits periodic heartbeats and updates heartbeat timestamp and count", () => {
    let now = 1_000_000;
    const watchdog = new ProcessTimeoutWatchdog({
      now: () => now,
    });

    now = 1_005_000;
    const hb1 = watchdog.emitHeartbeat({ step: 1 });
    expect(hb1.heartbeatCount).toBe(1);
    expect(hb1.timestamp).toBe(new Date(1_005_000).toISOString());

    now = 1_010_000;
    const hb2 = watchdog.emitHeartbeat({ step: 2 });
    expect(hb2.heartbeatCount).toBe(2);
    expect(hb2.timestamp).toBe(new Date(1_010_000).toISOString());

    const diag = watchdog.getDiagnostics();
    expect(diag.lastHeartbeatAt).toBe(new Date(1_010_000).toISOString());
  });
});

describe("ProcessTimeoutWatchdog - Liveness Checks & Stall Detection", () => {
  test("reports alive when well within wall and idle timeouts", () => {
    let now = 1_000_000;
    const watchdog = new ProcessTimeoutWatchdog({
      wallTimeoutMs: 60_000,
      idleTimeoutMs: 30_000,
      stallProgressThresholdMs: 60_000,
      now: () => now,
    });

    now += 10_000;
    const liveness = watchdog.checkLiveness();
    expect(liveness.alive).toBe(true);
    expect(liveness.timedOut).toBe(false);
    expect(liveness.stalled).toBe(false);
    expect(liveness.timeoutKind).toBeNull();
  });

  test("detects wall timeout when execution duration exceeds limit", () => {
    let now = 1_000_000;
    const watchdog = new ProcessTimeoutWatchdog({
      wallTimeoutMs: 60_000,
      idleTimeoutMs: 30_000,
      now: () => now,
    });

    now += 20_000;
    watchdog.recordActivity("stdout", "chunk 1");
    now += 25_000;
    watchdog.recordActivity("stdout", "chunk 2");
    now += 20_000;

    const liveness = watchdog.checkLiveness();
    expect(liveness.alive).toBe(false);
    expect(liveness.timedOut).toBe(true);
    expect(liveness.timeoutKind).toBe("wall");
    expect(liveness.errorClassification).toBe(ERROR_CLASS_WALL_TIMEOUT);
    expect(liveness.reason).toContain("Process wall timeout exceeded");
  });

  test("detects idle timeout when no activity occurs for > idle limit", () => {
    let now = 1_000_000;
    const watchdog = new ProcessTimeoutWatchdog({
      wallTimeoutMs: 60_000,
      idleTimeoutMs: 30_000,
      now: () => now,
    });

    now += 31_000;

    const liveness = watchdog.checkLiveness();
    expect(liveness.alive).toBe(false);
    expect(liveness.timedOut).toBe(true);
    expect(liveness.timeoutKind).toBe("idle");
    expect(liveness.errorClassification).toBe(ERROR_CLASS_IDLE_TIMEOUT);
    expect(liveness.reason).toContain("Process idle timeout exceeded");
  });

  test("detects progress stall when 0 progress recorded for > stall threshold", () => {
    let now = 1_000_000;
    const watchdog = new ProcessTimeoutWatchdog({
      wallTimeoutMs: 300_000,
      idleTimeoutMs: 120_000,
      stallProgressThresholdMs: 60_000,
      now: () => now,
    });

    now += 15_000;
    watchdog.recordActivity("stdout", "still waiting...\n");
    now += 20_000;
    watchdog.recordActivity("stdout", "still waiting...\n");
    now += 30_000;

    const liveness = watchdog.checkLiveness();
    expect(liveness.alive).toBe(false);
    expect(liveness.stalled).toBe(true);
    expect(liveness.timeoutKind).toBe("stall");
    expect(liveness.errorClassification).toBe(ERROR_CLASS_STALL_TIMEOUT);
    expect(liveness.reason).toContain("Process stall detected: 0 progress recorded");
  });

  test("progress recording resets the stall timer", () => {
    let now = 1_000_000;
    const watchdog = new ProcessTimeoutWatchdog({
      wallTimeoutMs: 300_000,
      idleTimeoutMs: 120_000,
      stallProgressThresholdMs: 60_000,
      now: () => now,
    });

    now += 40_000;
    watchdog.recordProgress("completed parsing AST");
    now += 30_000;

    const liveness = watchdog.checkLiveness();
    expect(liveness.alive).toBe(true);
    expect(liveness.stalled).toBe(false);
  });
});
