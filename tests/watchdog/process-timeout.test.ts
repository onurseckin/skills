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
} from "../../olt/scripts/src/watchdog/process-timeout/index.ts";

function createFakeSubprocess(
  opts: { pid?: number; exited?: Promise<number> } = {},
): BunSubprocess {
  return {
    pid: opts.pid ?? 4321,
    exited: opts.exited ?? new Promise<number>(() => undefined),
    stdout: new ReadableStream() as ReadableStream<Uint8Array>,
    stderr: new ReadableStream() as ReadableStream<Uint8Array>,
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

  test("initializes with default and custom configurable limits", () => {
    const d = createProcessTimeoutWatchdog();
    expect(d.wallTimeoutMs).toBe(60_000);
    expect(d.idleTimeoutMs).toBe(30_000);
    expect(d.stallProgressThresholdMs).toBe(60_000);
    expect(d.heartbeatIntervalMs).toBe(1_000);
    expect(d.graceMs).toBe(1_000);
    expect(d.maxTailBytes).toBe(64 * 1024);
    expect(d.supervisorTier).toBe("coordinator");
    expect(d.childRole).toBe("task_implementer");

    const c = new ProcessTimeoutWatchdog({
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
    expect(c.pid).toBe(9999);
    expect(c.ppid).toBe(1000);
    expect(c.taskId).toBe("task-test-1");
    expect(c.gateId).toBe("gate-test-1");
    expect(c.agentId).toBe("agent-sub-1");
    expect(c.supervisorTier).toBe("orchestrator");
    expect(c.childRole).toBe("coordinator");
    expect(c.wallTimeoutMs).toBe(15_000);
    expect(c.idleTimeoutMs).toBe(5_000);
    expect(c.stallProgressThresholdMs).toBe(10_000);
    expect(c.heartbeatIntervalMs).toBe(500);
    expect(c.graceMs).toBe(200);
  });
});

describe("ProcessTimeoutWatchdog - Activity, Buffers, & Diagnostics", () => {
  test("records stdout/stderr text, binary output, and maintains tail buffer", () => {
    const watchdog = new ProcessTimeoutWatchdog({ now: () => 1_000_000, maxTailBytes: 100 });
    watchdog.recordActivity("stdout", "line 1\n");
    watchdog.recordActivity("stdout", "line 2\n");
    watchdog.recordActivity("stderr", "error log 1\n");
    const diag = watchdog.getDiagnostics();
    expect(diag.stdoutTail).toContain("line 1\nline 2\n");
    expect(diag.stderrTail).toContain("error log 1\n");
    expect(diag.stdoutBytes).toBe(14);
    expect(diag.stderrBytes).toBe(12);

    const binWatchdog = new ProcessTimeoutWatchdog({ maxTailBytes: 20 });
    binWatchdog.recordActivity("stdout", new TextEncoder().encode("first chunk 1234567890\n"));
    binWatchdog.recordActivity("stdout", "second chunk 1234567890\n");
    expect(binWatchdog.getDiagnostics().stdoutTail).toBe("nd chunk 1234567890\n");
  });

  test("emits periodic heartbeats and updates heartbeat timestamp and count", () => {
    let now = 1_000_000;
    const watchdog = new ProcessTimeoutWatchdog({ now: () => now });
    now = 1_005_000;
    const hb1 = watchdog.emitHeartbeat({ step: 1 });
    expect(hb1.heartbeatCount).toBe(1);
    expect(hb1.timestamp).toBe(new Date(1_005_000).toISOString());
    now = 1_010_000;
    const hb2 = watchdog.emitHeartbeat({ step: 2 });
    expect(hb2.heartbeatCount).toBe(2);
    expect(hb2.timestamp).toBe(new Date(1_010_000).toISOString());
    expect(watchdog.getDiagnostics().lastHeartbeatAt).toBe(new Date(1_010_000).toISOString());
  });
});

describe("ProcessTimeoutWatchdog - Liveness Checks & Stall Detection", () => {
  test("reports alive when within limits, detects wall/idle/stall timeouts accurately", () => {
    let now = 1_000_000;
    const wd = new ProcessTimeoutWatchdog({
      wallTimeoutMs: 60_000,
      idleTimeoutMs: 30_000,
      stallProgressThresholdMs: 40_000,
      now: () => now,
    });
    now += 10_000;
    expect(wd.checkLiveness().alive).toBe(true);
    now += 55_000;
    const wallCheck = wd.checkLiveness();
    expect(wallCheck.alive).toBe(false);
    expect(wallCheck.timeoutKind).toBe("wall");
    expect(wallCheck.errorClassification).toBe(ERROR_CLASS_WALL_TIMEOUT);

    now = 2_000_000;
    const idleWd = new ProcessTimeoutWatchdog({
      wallTimeoutMs: 100_000,
      idleTimeoutMs: 30_000,
      now: () => now,
    });
    now += 31_000;
    const idleCheck = idleWd.checkLiveness();
    expect(idleCheck.alive).toBe(false);
    expect(idleCheck.timeoutKind).toBe("idle");
    expect(idleCheck.errorClassification).toBe(ERROR_CLASS_IDLE_TIMEOUT);

    now = 3_000_000;
    const stallWd = new ProcessTimeoutWatchdog({
      wallTimeoutMs: 300_000,
      idleTimeoutMs: 120_000,
      stallProgressThresholdMs: 60_000,
      now: () => now,
    });
    now += 15_000;
    stallWd.recordActivity("stdout", "waiting\n");
    now += 50_000;
    expect(stallWd.checkLiveness().stalled).toBe(true);
    stallWd.recordProgress("completed AST parsing");
    now += 30_000;
    expect(stallWd.checkLiveness().alive).toBe(true);
  });
});

describe("ProcessTimeoutWatchdog - SIGKILL Enforcement & Signal Escalation", () => {
  test("sends SIGTERM then escalates to SIGKILL, supports graceMs 0, ignores invalid pid <= 1", async () => {
    const signals: NodeJS.Signals[] = [];
    const delays: number[] = [];
    const wdEscalate = new ProcessTimeoutWatchdog({
      pid: 7777,
      graceMs: 500,
      killProcessTree: (_p, s) => {
        signals.push(s);
        return true;
      },
      wait: async (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });
    expect(await wdEscalate.enforceSigkill()).toEqual(["SIGTERM", "SIGKILL"]);
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(delays).toEqual([500]);

    signals.length = 0;
    const wdZero = new ProcessTimeoutWatchdog({
      pid: 8888,
      graceMs: 0,
      killProcessTree: (_p, s) => {
        signals.push(s);
        return true;
      },
    });
    expect(await wdZero.enforceSigkill({ graceMs: 0 })).toEqual(["SIGKILL"]);
    expect(signals).toEqual(["SIGKILL"]);

    signals.length = 0;
    const wdInvalid = new ProcessTimeoutWatchdog({
      pid: 1,
      killProcessTree: (_p, s) => {
        signals.push(s);
        return true;
      },
    });
    expect(await wdInvalid.enforceSigkill()).toEqual([]);
    expect(signals).toEqual([]);
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
    expect(payload.diagnostics.stdoutTail).toContain("running test suite...");
    expect(payload.diagnostics.stderrTail).toContain("WARNING: possible infinite loop");
    expect(payload.diagnostics.durationMs).toBe(65_000);
    expect(payload.remediationGuidance.action).toBe("autonomous_repair_routing");
    expect(payload.remediationGuidance.defectReference).toBe("defect-20260822-24");
    expect(payload.remediationGuidance.supervisorTarget).toBe("coordinator");
  });

  test("generates appropriate remediation guidance across all supervisory roles", () => {
    const cases = [
      {
        role: "task_implementer",
        tier: "coordinator" as const,
        err: ERROR_CLASS_STALL_TIMEOUT,
        defect: "defect-20260822-28",
        action: "autonomous_repair_routing",
        target: "coordinator",
        text: "Stalled task implementer",
      },
      {
        role: "coordinator",
        tier: "orchestrator" as const,
        err: ERROR_CLASS_STALL_TIMEOUT,
        action: "escalate_to_supervisor",
        target: "orchestrator",
        text: "Stalled coordinator",
      },
      {
        role: "orchestrator",
        tier: "mind" as const,
        err: ERROR_CLASS_STALL_TIMEOUT,
        action: "escalate_to_supervisor",
        target: "mind",
        text: "Stalled orchestrator",
      },
      {
        role: "unknown_worker",
        tier: "coordinator" as const,
        err: ERROR_CLASS_STALL_TIMEOUT,
        action: "autonomous_repair_routing",
        target: "coordinator",
        text: "Mechanical process timeout watchdog",
      },
    ];
    for (const c of cases) {
      const g = buildRemediationGuidance({
        role: c.role,
        supervisorTier: c.tier,
        errorClassification: c.err,
        defectReference: "defect" in c ? c.defect : undefined,
      });
      expect(g.action).toBe(c.action);
      expect(g.supervisorTarget).toBe(c.target);
      expect(g.summary).toContain(c.text);
      if ("defect" in c && c.defect) expect(g.defectReference).toBe(c.defect);
    }
  });
});

describe("ProcessTimeoutWatchdog - Subprocess Monitoring Loop", () => {
  test("monitors process exit, wall timeout with fake clock, and mid-flight abort with microtask tick flusher", async () => {
    const wdNormal = new ProcessTimeoutWatchdog();
    const resNormal = await wdNormal.monitorSubprocess(
      createFakeSubprocess({ exited: Promise.resolve(0) }),
    );
    expect(resNormal.outcome).toBe("exit");
    expect(resNormal.exitCode).toBe(0);

    const signalsTimeout: NodeJS.Signals[] = [];
    const wdTimeout = new ProcessTimeoutWatchdog({
      pid: 6543,
      startedAt: 1_000_000,
      now: () => 1_001_000,
      wallTimeoutMs: 10,
      idleTimeoutMs: 10_000,
      graceMs: 0,
      killProcessTree: (_p, s) => {
        signalsTimeout.push(s);
        return true;
      },
    });
    const resTimeout = await wdTimeout.monitorSubprocess(createFakeSubprocess({ pid: 6543 }));
    expect(resTimeout.outcome).toBe("timeout");
    expect(signalsTimeout).toContain("SIGKILL");
    expect(resTimeout.failurePayload?.exitStatus).toBe(EXIT_STATUS_SIGKILL_TIMEOUT);
    expect(resTimeout.failurePayload?.errorClassification).toBe(ERROR_CLASS_WALL_TIMEOUT);

    const preAborted = new AbortController();
    preAborted.abort();
    const signalsAbort1: NodeJS.Signals[] = [];
    const wdAbort1 = new ProcessTimeoutWatchdog({
      pid: 4444,
      graceMs: 0,
      killProcessTree: (_p, s) => {
        signalsAbort1.push(s);
        return true;
      },
    });
    const resAbort1 = await wdAbort1.monitorSubprocess(
      createFakeSubprocess({ pid: 4444 }),
      undefined,
      preAborted.signal,
    );
    expect(resAbort1.outcome).toBe("interrupted");
    expect(signalsAbort1).toContain("SIGKILL");

    const midFlight = new AbortController();
    const signalsAbort2: NodeJS.Signals[] = [];
    const wdAbort2 = new ProcessTimeoutWatchdog({
      pid: 4445,
      graceMs: 0,
      wallTimeoutMs: 10_000,
      idleTimeoutMs: 10_000,
      killProcessTree: (_p, s) => {
        signalsAbort2.push(s);
        return true;
      },
    });
    queueMicrotask(() => midFlight.abort());
    const resAbort2 = await wdAbort2.monitorSubprocess(
      createFakeSubprocess({ pid: 4445 }),
      undefined,
      midFlight.signal,
    );
    expect(resAbort2.outcome).toBe("interrupted");
    expect(signalsAbort2).toContain("SIGKILL");
    expect(resAbort2.failurePayload?.errorClassification).toBe(ERROR_CLASS_PROCESS_HANG);
  });
});

describe("HierarchicalStallProbe - Supervisor-to-Child Health Probing", () => {
  test("registers and probes children, handles stall with SIGKILL, flags ghost zombie processes", async () => {
    let now = 1_000_000;
    const signals: NodeJS.Signals[] = [];
    const probe = createHierarchicalStallProbe("coordinator", {
      supervisorId: "coord-lead-1",
      defaultWallTimeoutMs: 300_000,
      defaultIdleTimeoutMs: 300_000,
      defaultStallThresholdMs: 60_000,
      now: () => now,
      killProcessTree: (_p, s) => {
        signals.push(s);
        return true;
      },
    });
    expect(probe.supervisorTier).toBe("coordinator");
    const wd = probe.registerChild({
      childId: "child-critic-1",
      role: "completeness_critic",
      supervisorTier: "coordinator",
      pid: 8001,
      taskId: "task-test-gate",
    });
    expect(wd).toBeInstanceOf(ProcessTimeoutWatchdog);
    expect(probe.listChildren().length).toBe(1);

    now += 5_000;
    expect(probe.probeChild("child-critic-1").alive).toBe(true);

    probe.recordChildOutput("child-critic-1", "stdout", "running suite...\n");
    now += 65_000;
    const stalledList = probe.detectStalledChildren();
    expect(stalledList.length).toBe(1);
    expect(stalledList[0]?.failurePayload?.errorClassification).toBe(ERROR_CLASS_STALL_TIMEOUT);

    const payload = await probe.handleChildStall("child-critic-1", { graceMs: 0 });
    expect(payload.exitStatus).toBe(EXIT_STATUS_SIGKILL_TIMEOUT);
    expect(signals).toContain("SIGKILL");
    expect(probe.getChild("child-critic-1")).toBeUndefined();

    probe.registerChild({
      childId: "worker-active",
      role: "task_implementer",
      supervisorTier: "coordinator",
      pid: 8080,
    });
    probe.recordChildHeartbeat("worker-active", { phase: "running" });
    probe.recordChildProgress("worker-active", "completed parsing");
    const activeWd = probe.getChildWatchdog("worker-active");
    expect(activeWd?.getDiagnostics().lastHeartbeatAt).not.toBeNull();
    expect(activeWd?.getDiagnostics().lastProgressAt).not.toBeNull();

    const ghostProbe = new HierarchicalStallProbe({ supervisorTier: "orchestrator" });
    expect(ghostProbe.probeChild("unknown-ghost").errorClassification).toBe(
      ERROR_CLASS_ZOMBIE_PROCESS,
    );
  });
});

describe("Invariants & Cleanliness Audit - Mechanical Process Timeout Watchdog", () => {
  test("zero TypeScript any and zero suppressions across process-timeout watchdog files", () => {
    const ptDir = join(__dirname, "../../../olt/scripts/src/watchdog/process-timeout");
    const sourceFiles = [
      "constants.ts",
      "types.ts",
      "remediation.ts",
      "diagnostics.ts",
      "kill-tree.ts",
      "liveness.ts",
      "monitor.ts",
      "runner.ts",
      "probe.ts",
      "index.ts",
    ]
      .map((f) => join(ptDir, f))
      .concat([__filename]);
    for (const filePath of sourceFiles) {
      const c = readFileSync(filePath, "utf8");
      expect(c).not.toMatch(new RegExp(":\\s*any\\b|as\\s+any\\b|<\\s*any\\s*>"));
      expect(
        c.includes("@" + "ts-ignore") ||
          c.includes("@" + "ts-expect-error") ||
          c.includes("@" + "ts-nocheck"),
      ).toBe(false);
      expect(c.includes("eslint" + "-disable") || c.includes("oxlint" + "-disable")).toBe(false);
    }
  });
});
