import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  assertDoctorGatePassed,
  auditDoctorGate,
  executePulseTick,
  runPulseLoop,
  SchedulerEngine,
} from "../../../olt/scripts/src/engine/scheduler/index.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  cleanupVirtualBrowserFS,
  setupVirtualBrowserFS,
  tempDir,
} from "../../reporting/browser/browser-virtual-fs.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { TransactionPort, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import { schedulerState } from "../fixtures.ts";

function createMockPort(initialState: Record<string, unknown>): TransactionPort {
  let state = structuredClone(initialState) as unknown as WorkflowState;
  return {
    read: () => structuredClone(state),
    transact: (_actor, _kind, _payload, mutate) => {
      const draft = structuredClone(state);
      mutate(draft);
      state = draft;
      return state;
    },
  };
}

describe("Core Scheduler Engine Suite", () => {
  beforeAll(async () => {
    setupVirtualBrowserFS();
    try {
      const root = tempDir("warmup-doc");
      const runRoot = initRun(
        root,
        "run-warmup-doc",
        Buffer.from("Warmup doctor gate JIT"),
        "argv",
        true,
      );
      await auditDoctorGate(runRoot, { repoRoot: root });
      await assertDoctorGatePassed(runRoot, { repoRoot: root });
      try {
        await assertDoctorGatePassed("/virtual/nonexistent", { repoRoot: "/virtual/empty" });
      } catch {}
      const dummyEngine = new SchedulerEngine({ watchdogTarget: runRoot });
      const st = schedulerState();
      dummyEngine.registerSupervisoryHeartbeat("warmup-leader");
      dummyEngine.auditSupervisory5Point(st);
      await dummyEngine.auditDoctor(runRoot, { repoRoot: root });
      await dummyEngine.runDoctorGate(runRoot, { repoRoot: root });
      await dummyEngine.auditScriptBackedDiagnostics({ state: st });
      await dummyEngine.runScriptBackedDiagnostics({ state: st });
    } catch {}
    cleanupVirtualBrowserFS();
  });

  beforeEach(() => {
    setupVirtualBrowserFS();
  });

  afterEach(() => {
    cleanupVirtualBrowserFS();
  });

  describe("Zero-Tolerance Doctor Gate Enforcement (p25)", () => {
    test("assertDoctorGatePassed throws HarnessError on failing doctor check", async () => {
      await expect(
        assertDoctorGatePassed("/virtual/nonexistent/run/directory", { repoRoot: "/virtual/empty" }),
      ).rejects.toThrow(HarnessError);
    });

    test("auditDoctorGate succeeds on healthy initialized run", async () => {
      const root = tempDir("doctor-gate-healthy-audit");
      const runRoot = initRun(
        root,
        "run-healthy-doc-audit",
        Buffer.from("Verify doctor gate passes cleanly"),
        "argv",
        true,
      );
      const auditRes = await auditDoctorGate(runRoot, { repoRoot: root });
      expect(auditRes.healthy).toBe(true);
    });

    test("assertDoctorGatePassed succeeds on healthy initialized run", async () => {
      const root = tempDir("doctor-gate-healthy-assert");
      const runRoot = initRun(
        root,
        "run-healthy-doc-assert",
        Buffer.from("Verify doctor gate passes cleanly"),
        "argv",
        true,
      );
      const assertRes = await assertDoctorGatePassed(runRoot, { repoRoot: root });
      expect(assertRes.healthy).toBe(true);
    });
  });

  describe("Pulse Loop Execution", () => {
    test("executePulseTick performs single-step audit, recovery, and wave evaluation", () => {
      const state = schedulerState();
      const port = createMockPort(state);
      const tickResult = executePulseTick(port, { tickNumber: 1 });
      expect(tickResult.tickNumber).toBe(1);
      expect(tickResult.graphHealthy).toBeTrue();
      expect(tickResult.supervisoryReport).toBeDefined();
      expect(tickResult.readyTasks.length).toBeGreaterThan(0);
      expect(tickResult.workflowCompleted).toBeFalse();
    });

    test("runPulseLoop executes multi-tick loop up to maxTicks", async () => {
      const state = schedulerState();
      const port = createMockPort(state);
      const ticksRecorded: number[] = [];
      const loopResult = await runPulseLoop(port, {
        maxTicks: 3,
        intervalMs: 0,
        onTick: (res) => ticksRecorded.push(res.tickNumber),
      });
      expect(loopResult.totalTicks).toBe(3);
      expect(loopResult.stoppedReason).toBe("max_ticks_reached");
      expect(ticksRecorded).toEqual([1, 2, 3]);
    });

    test("runPulseLoop halts when workflow is completed (all tasks done)", async () => {
      const state = schedulerState();
      const tasks = state.tasks as Record<string, Record<string, unknown>>;
      for (const t of Object.values(tasks)) t.status = "done";

      const port = createMockPort(state);
      const loopResult = await runPulseLoop(port, {
        maxTicks: 10,
        intervalMs: 0,
        stopWhenDone: true,
      });
      expect(loopResult.totalTicks).toBe(1);
      expect(loopResult.stoppedReason).toBe("workflow_completed");
    });

    test("runPulseLoop respects AbortSignal cancellation", async () => {
      const state = schedulerState();
      const port = createMockPort(state);
      const controller = new AbortController();

      const loopResult = await runPulseLoop(port, {
        maxTicks: 100,
        intervalMs: 0,
        signal: controller.signal,
        onTick: (res) => {
          if (res.tickNumber >= 2) controller.abort();
        },
      });
      expect(loopResult.stoppedReason).toBe("aborted");
      expect(loopResult.totalTicks).toBeLessThan(100);
    });

    test("executePulseTick handles watchdog registration fallback and unexpected error recovery", () => {
      const state = schedulerState();
      const port = createMockPort(state);
      const wdTarget = tempDir("pulse-wd-root");
      const resWithWatchdog = executePulseTick(port, {
        tickNumber: 1,
        watchdogId: "pulse-wd-1",
        watchdogTarget: wdTarget,
      });
      expect(resWithWatchdog.tickNumber).toBe(1);

      const failingPort: TransactionPort = {
        read: () => structuredClone(state),
        transact: () => {
          throw new Error("Transact failure");
        },
      };
      const resWithError = executePulseTick(failingPort, { tickNumber: 2 });
      expect(resWithError.graphHealthy).toBe(false);
      expect(resWithError.error).toContain("Transact failure");
    });

    test("runPulseLoop invokes onError and onStop callbacks", async () => {
      const failingPort: TransactionPort = {
        read: () => {
          throw new Error("Loop error simulation");
        },
        transact: () => {
          throw new Error("Transact simulation");
        },
      };
      let errorReported = false;
      let stopReported = false;

      const result = await runPulseLoop(failingPort, {
        maxTicks: 1,
        intervalMs: 0,
        onError: () => {
          errorReported = true;
        },
        onStop: () => {
          stopReported = true;
        },
      });
      expect(errorReported).toBe(true);
      expect(stopReported).toBe(true);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test("runPulseLoop catches diagnostics error and continues floor execution", async () => {
      const state = schedulerState();
      const port = createMockPort(state);
      const loopResult = await runPulseLoop(port, {
        maxTicks: 1,
        intervalMs: 0,
        runDiagnostics: true,
        diagnosticsOptions: {
          inspectors: ["failing:check" as unknown as "doctor"],
          customInspectors: {
            "failing:check": () => {
              throw new Error("Diagnostics explosion");
            },
          },
          strict: true,
        },
      });
      expect(loopResult.totalTicks).toBe(1);
      expect(loopResult.errors.some((e) => e.includes("Diagnostics explosion"))).toBe(true);
    });

    test("runPulseLoop handles pre-aborted signal and zero maxTicks cleanly", async () => {
      const state = schedulerState();
      const port = createMockPort(state);
      const preAbortedController = new AbortController();
      preAbortedController.abort();

      const abortedLoop = await runPulseLoop(port, {
        maxTicks: 10,
        intervalMs: 0,
        signal: preAbortedController.signal,
      });
      expect(abortedLoop.stoppedReason).toBe("aborted");
      expect(abortedLoop.totalTicks).toBe(0);

      const zeroTickLoop = await runPulseLoop(port, {
        maxTicks: 0,
        intervalMs: 0,
      });
      expect(zeroTickLoop.stoppedReason).toBe("max_ticks_reached");
      expect(zeroTickLoop.totalTicks).toBe(0);
    });

    test("runPulseLoop stops on mid-loop abort signal", async () => {
      const state = schedulerState();
      const port = createMockPort(state);
      const controller = new AbortController();
      let count = 0;

      const loopResult = await runPulseLoop(port, {
        maxTicks: 5,
        intervalMs: 0,
        signal: controller.signal,
        onTick: () => {
          count++;
          if (count === 1) controller.abort();
        },
      });
      expect(loopResult.stoppedReason).toBe("aborted");
      expect(loopResult.totalTicks).toBe(1);
    });
  });

  describe("Complete SchedulerEngine Instance Methods", () => {
    test("SchedulerEngine executes health, watchdog, and supervisory audits", () => {
      const heartbeatRepo = tempDir("engine-watchdog-test");
      const heartbeatRun = initRun(
        heartbeatRepo,
        "run-engine-watchdog",
        Buffer.from("Test prompt for engine watchdog"),
        "argv",
        true,
      );
      const engine = new SchedulerEngine({
        heartbeatCadenceMs: 5000,
        timeoutMs: 10000,
        maxRepairRounds: 3,
        maxParallel: 4,
        watchdogTarget: heartbeatRun,
      });

      const state = schedulerState();
      expect(engine.auditHealth(state).healthy).toBe(true);
      expect(engine.auditWatchdog()).toBeDefined();
      expect(engine.auditSupervisory5Point(state).healthy).toBe(true);
      expect(engine.registerSupervisoryHeartbeat("test-leader-1").agent_id).toBe("test-leader-1");
    });

    test("SchedulerEngine executes probe dispatch, wave evaluation, and recovery", () => {
      const engine = new SchedulerEngine({
        heartbeatCadenceMs: 5000,
        timeoutMs: 10000,
        maxRepairRounds: 3,
        maxParallel: 4,
      });

      const state = schedulerState();
      const port = createMockPort(state);

      const leaderProbe = engine.dispatchTopLeaderProbe(state);
      expect(leaderProbe.dispatched).toBe(true);
      expect(leaderProbe.targetAgentId).toBeDefined();

      expect(engine.evaluateReadyBatch(state, 3).entries.length).toBeGreaterThan(0);
      const waveRes = engine.evaluateWave(state, 5);
      expect(waveRes.readyTasks.length).toBeGreaterThan(0);
      expect(waveRes.totalEligible).toBe(waveRes.readyTasks.length);

      expect(engine.evaluateMultiDomainBatch(state, { maxParallel: 3 })).toBeDefined();
      expect(engine.dispatchMultiDomainValidators(state, { maxParallel: 3 })).toBeDefined();
      expect(engine.proposeMultiDomainWave(state, { maxParallel: 3 })).toBeDefined();
      expect(engine.recoverStale(port)).toBeDefined();
    });

    test("SchedulerEngine executes auditDoctor", async () => {
      const engine = new SchedulerEngine({
        heartbeatCadenceMs: 5000,
        timeoutMs: 10000,
      });

      const root = tempDir("engine-doctor-audit");
      const runRoot = initRun(
        root,
        "run-engine-doc-audit",
        Buffer.from("Test prompt for engine doctor audit"),
        "argv",
        true,
      );
      expect((await engine.auditDoctor(runRoot, { repoRoot: root })).healthy).toBe(true);
    });

    test("SchedulerEngine executes runDoctorGate", async () => {
      const engine = new SchedulerEngine({
        heartbeatCadenceMs: 5000,
        timeoutMs: 10000,
      });

      const root = tempDir("engine-doctor-run");
      const runRoot = initRun(
        root,
        "run-engine-doc-run",
        Buffer.from("Test prompt for engine doctor run"),
        "argv",
        true,
      );
      expect((await engine.runDoctorGate(runRoot, { repoRoot: root })).healthy).toBe(true);
    });

    test("SchedulerEngine executes script-backed diagnostics", async () => {
      const engine = new SchedulerEngine({
        heartbeatCadenceMs: 5000,
        timeoutMs: 10000,
      });

      const state = schedulerState();
      expect(
        (await engine.auditScriptBackedDiagnostics({ state })).receipts.length,
      ).toBeGreaterThan(0);
      expect((await engine.runScriptBackedDiagnostics({ state })).receipts.length).toBeGreaterThan(
        0,
      );
    });
  });
});
