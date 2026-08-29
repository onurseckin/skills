import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_TEST_WALL_TIMEOUT_MS,
  DEFAULT_TEST_IDLE_TIMEOUT_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_STALL_PROGRESS_THRESHOLD_MS,
  DEFAULT_GRACE_PERIOD_MS,
  DEFAULT_DIAGNOSTIC_TAIL_BYTES,
  EXIT_STATUS_SIGKILL_TIMEOUT,
  EXIT_STATUS_SIGTERM_TIMEOUT,
  EXIT_STATUS_SIGKILL_MANUAL,
  EXIT_STATUS_EXIT_FAILURE,
  EXIT_STATUS_EXIT_SUCCESS,
  ERROR_CLASS_STALL_TIMEOUT,
  ERROR_CLASS_WALL_TIMEOUT,
  ERROR_CLASS_IDLE_TIMEOUT,
  ERROR_CLASS_PROCESS_HANG,
  ERROR_CLASS_ZOMBIE_PROCESS,
  ProcessTimeoutWatchdog,
  HierarchicalStallProbe,
  createProcessTimeoutWatchdog,
  createHierarchicalStallProbe,
  buildRemediationGuidance,
  type BunSubprocess,
} from "../../../olt/scripts/src/watchdog/process-timeout/index.ts";

function createFakeSubprocess(
  options: {
    pid?: number;
    exited?: Promise<number>;
    stdout?: ReadableStream<Uint8Array>;
    stderr?: ReadableStream<Uint8Array>;
  } = {},
): BunSubprocess {
  return {
    pid: options.pid ?? 4321,
    exited: options.exited ?? new Promise<number>(() => undefined),
    stdout: options.stdout ?? (new ReadableStream() as ReadableStream<Uint8Array>),
    stderr: options.stderr ?? (new ReadableStream() as ReadableStream<Uint8Array>),
  };
}

describe("ProcessTimeoutWatchdog - Constants & Initialization", () => {
  test("exports standard constants with expected values", () => {
    expect(DEFAULT_TEST_WALL_TIMEOUT_MS).toBe(60_000);
    expect(DEFAULT_TEST_IDLE_TIMEOUT_MS).toBe(30_000);
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(1_000);
    expect(DEFAULT_STALL_PROGRESS_THRESHOLD_MS).toBe(60_000);
    expect(DEFAULT_GRACE_PERIOD_MS).toBe(1_000);
    expect(DEFAULT_DIAGNOSTIC_TAIL_BYTES).toBe(64 * 1024);

    expect(EXIT_STATUS_SIGKILL_TIMEOUT).toBe("SIGKILL_TIMEOUT");
    expect(EXIT_STATUS_SIGTERM_TIMEOUT).toBe("SIGTERM_TIMEOUT");
    expect(EXIT_STATUS_SIGKILL_MANUAL).toBe("SIGKILL_MANUAL");
    expect(EXIT_STATUS_EXIT_FAILURE).toBe("EXIT_FAILURE");
    expect(EXIT_STATUS_EXIT_SUCCESS).toBe("EXIT_SUCCESS");

    expect(ERROR_CLASS_STALL_TIMEOUT).toBe("STALL_TIMEOUT");
    expect(ERROR_CLASS_WALL_TIMEOUT).toBe("WALL_TIMEOUT");
    expect(ERROR_CLASS_IDLE_TIMEOUT).toBe("IDLE_TIMEOUT");
    expect(ERROR_CLASS_PROCESS_HANG).toBe("PROCESS_HANG");
    expect(ERROR_CLASS_ZOMBIE_PROCESS).toBe("ZOMBIE_PROCESS");
  });

  test("initializes with default test timeout limits of 60s wall and 30s idle", () => {
    const watchdog = createProcessTimeoutWatchdog();
    expect(watchdog.wallTimeoutMs).toBe(60_000);
    expect(watchdog.idleTimeoutMs).toBe(30_000);
    expect(watchdog.stallProgressThresholdMs).toBe(60_000);
    expect(watchdog.heartbeatIntervalMs).toBe(1_000);
    expect(watchdog.graceMs).toBe(1_000);
    expect(watchdog.maxTailBytes).toBe(64 * 1024);
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
    const now = 1_000_000;
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

describe("ProcessTimeoutWatchdog - SIGKILL Enforcement & Signal Escalation", () => {
  test("sends SIGTERM then escalates to SIGKILL after grace period", async () => {
    const signalsReceived: NodeJS.Signals[] = [];
    const delays: number[] = [];

    const mockKill = (_pid: number, sig: NodeJS.Signals): boolean => {
      signalsReceived.push(sig);
      return true;
    };

    const mockWait = async (ms: number): Promise<unknown> => {
      delays.push(ms);
      return Promise.resolve();
    };

    const watchdog = new ProcessTimeoutWatchdog({
      pid: 7777,
      graceMs: 500,
      killProcessTree: mockKill,
      wait: mockWait,
    });

    const sent = await watchdog.enforceSigkill();
    expect(sent).toEqual(["SIGTERM", "SIGKILL"]);
    expect(signalsReceived).toEqual(["SIGTERM", "SIGKILL"]);
    expect(delays).toEqual([500]);
  });

  test("skips SIGTERM and directly SIGKILLs if graceMs is 0", async () => {
    const signalsReceived: NodeJS.Signals[] = [];

    const mockKill = (_pid: number, sig: NodeJS.Signals): boolean => {
      signalsReceived.push(sig);
      return true;
    };

    const watchdog = new ProcessTimeoutWatchdog({
      pid: 8888,
      graceMs: 0,
      killProcessTree: mockKill,
    });

    const sent = await watchdog.enforceSigkill({ graceMs: 0 });
    expect(sent).toEqual(["SIGKILL"]);
    expect(signalsReceived).toEqual(["SIGKILL"]);
  });

  test("gracefully handles invalid pid <= 1 without sending dangerous signals", async () => {
    const signalsReceived: NodeJS.Signals[] = [];
    const watchdog = new ProcessTimeoutWatchdog({
      pid: 1,
      killProcessTree: (_pid, sig) => {
        signalsReceived.push(sig);
        return true;
      },
    });

    const sent = await watchdog.enforceSigkill();
    expect(sent).toEqual([]);
    expect(signalsReceived).toEqual([]);
  });
});

describe("ProcessTimeoutWatchdog - Structured Failure Payload & Remediation Guidance", () => {
  test("synthesizes structured failure payload with diagnostics and defect reference", () => {
    let now = 1_000_000;
    const watchdog = new ProcessTimeoutWatchdog({
      pid: 5432,
      ppid: 5000,
      taskId: "task-compile-run",
      gateId: "gate-unit-tests",
      agentId: "critic-agent-1",
      supervisorTier: "coordinator",
      childRole: "completeness_critic",
      now: () => now,
    });

    watchdog.recordActivity("stdout", "running test suite...\n");
    watchdog.recordActivity("stderr", "WARNING: possible infinite loop\n");

    now += 65_000;

    const payload = watchdog.synthesizeFailurePayload({
      exitStatus: EXIT_STATUS_SIGKILL_TIMEOUT,
      errorClassification: ERROR_CLASS_STALL_TIMEOUT,
      reason: "Critic test run hung on zombie process (task-107)",
      defectReference: "defect-20260822-24",
    });

    expect(payload.schema).toBe("harness.structured_failure_payload");
    expect(payload.version).toBe(1);
    expect(payload.exitStatus).toBe(EXIT_STATUS_SIGKILL_TIMEOUT);
    expect(payload.errorClassification).toBe(ERROR_CLASS_STALL_TIMEOUT);
    expect(payload.reason).toBe("Critic test run hung on zombie process (task-107)");
    expect(payload.taskId).toBe("task-compile-run");
    expect(payload.gateId).toBe("gate-unit-tests");
    expect(payload.agentId).toBe("critic-agent-1");
    expect(payload.supervisorTier).toBe("coordinator");
    expect(payload.childRole).toBe("completeness_critic");
    expect(payload.childPid).toBe(5432);

    expect(payload.diagnostics.stdoutTail).toContain("running test suite...");
    expect(payload.diagnostics.stderrTail).toContain("WARNING: possible infinite loop");
    expect(payload.diagnostics.durationMs).toBe(65_000);

    expect(payload.remediationGuidance.action).toBe("autonomous_repair_routing");
    expect(payload.remediationGuidance.defectReference).toBe("defect-20260822-24");
    expect(payload.remediationGuidance.supervisorTarget).toBe("coordinator");
    expect(payload.remediationGuidance.prescribedSteps.length).toBeGreaterThan(2);
    expect(payload.remediationGuidance.fallbackDirective).toContain("single-file scoped unit test");
  });

  test("generates appropriate remediation guidance for implementer hang (defect-20260822-28)", () => {
    const guidance = buildRemediationGuidance({
      role: "task_implementer",
      supervisorTier: "coordinator",
      errorClassification: ERROR_CLASS_STALL_TIMEOUT,
      defectReference: "defect-20260822-28",
    });

    expect(guidance.action).toBe("autonomous_repair_routing");
    expect(guidance.defectReference).toBe("defect-20260822-28");
    expect(guidance.supervisorTarget).toBe("coordinator");
    expect(guidance.summary).toContain("Stalled task implementer execution detected");
  });

  test("generates appropriate remediation guidance for coordinator stall", () => {
    const guidance = buildRemediationGuidance({
      role: "coordinator",
      supervisorTier: "orchestrator",
      errorClassification: ERROR_CLASS_STALL_TIMEOUT,
    });

    expect(guidance.action).toBe("escalate_to_supervisor");
    expect(guidance.supervisorTarget).toBe("orchestrator");
    expect(guidance.summary).toContain("Stalled coordinator execution detected");
  });

  test("generates appropriate remediation guidance for orchestrator stall", () => {
    const guidance = buildRemediationGuidance({
      role: "orchestrator",
      supervisorTier: "mind",
      errorClassification: ERROR_CLASS_STALL_TIMEOUT,
    });

    expect(guidance.action).toBe("escalate_to_supervisor");
    expect(guidance.supervisorTarget).toBe("mind");
    expect(guidance.summary).toContain("Stalled orchestrator execution detected");
  });

  test("generates default remediation guidance for generic worker role", () => {
    const guidance = buildRemediationGuidance({
      role: "unknown_worker",
      supervisorTier: "coordinator",
      errorClassification: ERROR_CLASS_STALL_TIMEOUT,
    });

    expect(guidance.action).toBe("autonomous_repair_routing");
    expect(guidance.supervisorTarget).toBe("coordinator");
    expect(guidance.summary).toContain(
      "Mechanical process timeout watchdog detected execution stall / timeout.",
    );
  });
});

describe("ProcessTimeoutWatchdog - Subprocess Monitoring Loop", () => {
  test("monitors process and returns exit code when subprocess finishes normally", async () => {
    const child = createFakeSubprocess({
      exited: Promise.resolve(0),
    });

    const watchdog = new ProcessTimeoutWatchdog();
    const result = await watchdog.monitorSubprocess(child);

    expect(result.outcome).toBe("exit");
    expect(result.exitCode).toBe(0);
  });

  test("detects wall timeout, SIGKILLs process, and returns structured failure payload", async () => {
    const signalsReceived: NodeJS.Signals[] = [];

    const child = createFakeSubprocess({
      pid: 6543,
      exited: new Promise(() => undefined),
    });

    const watchdog = new ProcessTimeoutWatchdog({
      pid: 6543,
      startedAt: Date.now() - 1_000,
      wallTimeoutMs: 10,
      idleTimeoutMs: 10_000,
      graceMs: 0,
      killProcessTree: (_pid, sig) => {
        signalsReceived.push(sig);
        return true;
      },
    });

    const result = await watchdog.monitorSubprocess(child);

    expect(result.outcome).toBe("timeout");
    expect(result.exitCode).toBeNull();
    expect(signalsReceived).toContain("SIGKILL");
    expect(result.failurePayload).toBeDefined();
    expect(result.failurePayload?.exitStatus).toBe(EXIT_STATUS_SIGKILL_TIMEOUT);
    expect(result.failurePayload?.errorClassification).toBe(ERROR_CLASS_WALL_TIMEOUT);
  });

  test("resolves as interrupted immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const signalsReceived: NodeJS.Signals[] = [];

    const child = createFakeSubprocess({
      pid: 4444,
      exited: new Promise(() => undefined),
    });

    const watchdog = new ProcessTimeoutWatchdog({
      pid: 4444,
      graceMs: 0,
      killProcessTree: (_pid, sig) => {
        signalsReceived.push(sig);
        return true;
      },
    });

    const result = await watchdog.monitorSubprocess(child, undefined, controller.signal);

    expect(result.outcome).toBe("interrupted");
    expect(result.exitCode).toBeNull();
    expect(signalsReceived).toContain("SIGKILL");
    expect(result.failurePayload?.errorClassification).toBe(ERROR_CLASS_PROCESS_HANG);
  });

  test("detects mid-flight abort signal interruption, SIGKILLs process, and synthesizes payload", async () => {
    const controller = new AbortController();
    const signalsReceived: NodeJS.Signals[] = [];

    const child = createFakeSubprocess({
      pid: 4445,
      exited: new Promise(() => undefined),
    });

    const watchdog = new ProcessTimeoutWatchdog({
      pid: 4445,
      graceMs: 0,
      wallTimeoutMs: 10_000,
      idleTimeoutMs: 10_000,
      killProcessTree: (_pid, sig) => {
        signalsReceived.push(sig);
        return true;
      },
    });

    setTimeout(() => controller.abort(), 5);
    const result = await watchdog.monitorSubprocess(child, undefined, controller.signal);

    expect(result.outcome).toBe("interrupted");
    expect(result.exitCode).toBeNull();
    expect(signalsReceived).toContain("SIGKILL");
    expect(result.failurePayload?.errorClassification).toBe(ERROR_CLASS_PROCESS_HANG);
  });
});

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
    expect(probe.getChildWatchdog("child-critic-1")).toBe(wd);
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

  test("records child heartbeat and progress updates child state", () => {
    const probe = new HierarchicalStallProbe({
      supervisorTier: "coordinator",
    });

    probe.registerChild({
      childId: "child-worker-active",
      role: "task_implementer",
      supervisorTier: "coordinator",
      pid: 8080,
    });

    probe.recordChildHeartbeat("child-worker-active", { phase: "running" });
    probe.recordChildProgress("child-worker-active", "completed parsing");

    const wd = probe.getChildWatchdog("child-worker-active");
    expect(wd).toBeDefined();
    const diag = wd?.getDiagnostics();
    expect(diag?.lastHeartbeatAt).not.toBeNull();
    expect(diag?.lastProgressAt).not.toBeNull();
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

describe("Invariants & Cleanliness Audit - Mechanical Process Timeout Watchdog", () => {
  test("zero TypeScript any and zero suppressions across process-timeout watchdog files", () => {
    const ptDir = join(__dirname, "../../../olt/scripts/src/watchdog/process-timeout");
    const sourceFiles = [
      join(ptDir, "constants.ts"),
      join(ptDir, "types.ts"),
      join(ptDir, "remediation.ts"),
      join(ptDir, "diagnostics.ts"),
      join(ptDir, "kill-tree.ts"),
      join(ptDir, "liveness.ts"),
      join(ptDir, "monitor.ts"),
      join(ptDir, "runner.ts"),
      join(ptDir, "probe.ts"),
      join(ptDir, "index.ts"),
      __filename,
    ];

    const anyAnnotation = new RegExp(":\\s*any\\b");
    const anyCast = new RegExp("as\\s+any\\b");
    const anyGeneric = new RegExp("<\\s*any\\s*>");
    const tsIgnore = "@" + "ts-ignore";
    const tsExpectError = "@" + "ts-expect-error";
    const tsNoCheck = "@" + "ts-nocheck";
    const suppressionDirectiveA = "eslint" + "-disable";
    const suppressionDirectiveB = "oxlint" + "-disable";

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, "utf8");

      expect(content).not.toMatch(anyAnnotation);
      expect(content).not.toMatch(anyCast);
      expect(content).not.toMatch(anyGeneric);
      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNoCheck)).toBe(false);
      expect(content.includes(suppressionDirectiveA)).toBe(false);
      expect(content.includes(suppressionDirectiveB)).toBe(false);
    }
  });
});
