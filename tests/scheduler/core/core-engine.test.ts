import { describe, expect, test } from "bun:test";
import {
  assertDoctorGatePassed,
  auditDoctorGate,
  executePulseTick,
  runPulseLoop,
  SchedulerEngine,
} from "../../../olt/scripts/src/engine/scheduler/index.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { scratchRoot as makeScratchRoot } from "../../shared/scratch-root.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { TransactionPort, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import { schedulerState } from "../fixtures.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

function createMockPort(initialState: Record<string, unknown>): TransactionPort {
  let state = structuredClone(initialState) as unknown as WorkflowState;
  return {
    read: () => structuredClone(state),
    transact: (actor, kind, payload, mutate) => {
      const draft = structuredClone(state);
      mutate(draft);
      state = draft;
      return state;
    },
  };
}

describe("Core Scheduler Engine — Zero-Tolerance Doctor Gate Enforcement (p25)", () => {
  test("assertDoctorGatePassed throws HarnessError on failing doctor check", async () => {
    await expect(assertDoctorGatePassed("/nonexistent/run/directory")).rejects.toThrow(
      HarnessError,
    );
  });

  test("auditDoctorGate and assertDoctorGatePassed succeed on healthy initialized run", async () => {
    const root = scratchRoot("doctor-gate-healthy");
    const runRoot = initRun(
      root,
      "run-healthy-doc",
      Buffer.from("Verify doctor gate passes cleanly"),
      "argv",
      true,
    );

    const auditRes = await auditDoctorGate(runRoot);
    expect(auditRes.healthy).toBe(true);

    const assertRes = await assertDoctorGatePassed(runRoot);
    expect(assertRes.healthy).toBe(true);
  });
});

describe("Core Scheduler Engine — Pulse Loop Execution", () => {
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
      intervalMs: 10,
      onTick: (res) => ticksRecorded.push(res.tickNumber),
    });

    expect(loopResult.totalTicks).toBe(3);
    expect(loopResult.stoppedReason).toBe("max_ticks_reached");
    expect(ticksRecorded).toEqual([1, 2, 3]);
  });

  test("runPulseLoop halts when workflow is completed (all tasks done)", async () => {
    const state = schedulerState();
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    for (const t of Object.values(tasks)) {
      t.status = "done";
    }

    const port = createMockPort(state);
    const loopResult = await runPulseLoop(port, {
      maxTicks: 10,
      intervalMs: 10,
      stopWhenDone: true,
    });

    expect(loopResult.totalTicks).toBe(1);
    expect(loopResult.stoppedReason).toBe("workflow_completed");
  });

  test("runPulseLoop respects AbortSignal cancellation", async () => {
    const state = schedulerState();
    const port = createMockPort(state);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 25);

    const loopResult = await runPulseLoop(port, {
      maxTicks: 100,
      intervalMs: 10,
      signal: controller.signal,
    });

    expect(loopResult.stoppedReason).toBe("aborted");
    expect(loopResult.totalTicks).toBeLessThan(100);
  });

  test("executePulseTick handles watchdog registration fallback and unexpected error recovery", () => {
    const state = schedulerState();
    const port = createMockPort(state);

    const resWithWatchdog = executePulseTick(port, {
      tickNumber: 1,
      watchdogId: "pulse-wd-1",
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
      onError: () => {
        errorReported = true;
      },
      onStop: (_reason) => {
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

  test("runPulseLoop stops on mid-loop abort signal", async () => {
    const state = schedulerState();
    const port = createMockPort(state);
    const controller = new AbortController();

    let count = 0;
    const loopResult = await runPulseLoop(port, {
      maxTicks: 5,
      intervalMs: 10,
      signal: controller.signal,
      onTick: () => {
        count++;
        if (count === 1) {
          controller.abort();
        }
      },
    });

    expect(loopResult.stoppedReason).toBe("aborted");
    expect(loopResult.totalTicks).toBe(1);
  });
});

describe("Core Scheduler Engine — Complete SchedulerEngine Instance Methods", () => {
  test("SchedulerEngine executes complete suite of methods", async () => {
    const heartbeatRepo = scratchRoot("engine-watchdog-test");
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
    const port = createMockPort(state);

    const healthReport = engine.auditHealth(state);
    expect(healthReport.healthy).toBe(true);

    const watchdogReport = engine.auditWatchdog();
    expect(watchdogReport).toBeDefined();

    const supervisory5Point = engine.auditSupervisory5Point(state);
    expect(supervisory5Point.healthy).toBe(true);

    const leaderProbe = engine.dispatchTopLeaderProbe(state);
    expect(leaderProbe.dispatched).toBe(true);
    expect(leaderProbe.targetAgentId).toBeDefined();

    const readyBatch = engine.evaluateReadyBatch(state, 3);
    expect(readyBatch.entries.length).toBeGreaterThan(0);

    const waveRes = engine.evaluateWave(state, 5);
    expect(waveRes.readyTasks.length).toBeGreaterThan(0);
    expect(waveRes.totalEligible).toBe(waveRes.readyTasks.length);

    const mdBatch = engine.evaluateMultiDomainBatch(state, { maxParallel: 3 });
    expect(mdBatch).toBeDefined();

    const mdVal = engine.dispatchMultiDomainValidators(state, { maxParallel: 3 });
    expect(mdVal).toBeDefined();

    const mdWave = engine.proposeMultiDomainWave(state, { maxParallel: 3 });
    expect(mdWave).toBeDefined();

    const recRes = engine.recoverStale(port);
    expect(recRes).toBeDefined();

    const hb = engine.registerSupervisoryHeartbeat("test-leader-1");
    expect(hb.agent_id).toBe("test-leader-1");

    const root = scratchRoot("engine-doctor-test");
    const runRoot = initRun(
      root,
      "run-engine-doc",
      Buffer.from("Test prompt for engine doctor"),
      "argv",
      true,
    );
    const docAudit = await engine.auditDoctor(runRoot);
    expect(docAudit.healthy).toBe(true);
    const docGate = await engine.runDoctorGate(runRoot);
    expect(docGate.healthy).toBe(true);

    const diagAudit = await engine.auditScriptBackedDiagnostics({ state });
    expect(diagAudit.receipts.length).toBeGreaterThan(0);
    const diagRun = await engine.runScriptBackedDiagnostics({ state });
    expect(diagRun.receipts.length).toBeGreaterThan(0);
  }, 20000);
});
