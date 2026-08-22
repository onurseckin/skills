import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CadenceTriggerDispatcher,
  CLOSING_FORBIDDEN_FOR_MIND,
  createCadenceTrigger,
  createInitialCadenceState,
  DEFAULT_CADENCE_BASE_INTERVAL_MS,
  DEFAULT_CADENCE_MAX_INTERVAL_MS,
  enforceInfiniteMindCadence,
  evaluateAntiIdleRollover,
  MindCadenceEngine,
  PERPETUAL_NON_STOPPING_CADENCE,
  ZERO_SLEEP_DELAY_MS,
} from "./cadence.ts";
import {
  applyIntervalJitter,
  calculateBackoffWithStrategy,
  calculateDeterministicInterval,
  calculateExponentialBackoff,
  calculateThrottleInterval,
  computeAntiIdleInterval,
  createDeterministicRandom,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  DEFAULT_MAX_PAUSE_INTERVAL_MS,
  formatIntervalDuration,
  formatRawValueSeries,
  generateTrailingValueSeries,
  parseIntervalDuration,
  projectIntervalProgression,
} from "./interval.ts";
import {
  analyzeLivenessTrends,
  calculateTimeToStaleMs,
  checkStalePulseReclaimReadiness,
  createPulseHeartbeat,
  DEFAULT_LIVENESS_GRACE_MS,
  DEFAULT_LIVENESS_INTERVAL_MS,
  DEFAULT_LIVENESS_THRESHOLD_MS,
  evaluateLivenessFromRecord,
  evaluateMindLiveness,
  EXIT_CODE_CHECK_FAILURE,
  EXIT_CODE_HEALTHY,
  EXIT_CODE_STALE,
  formatLivenessBrief,
  getExitCodeForStatus,
} from "./liveness.ts";

describe("Mind Cadence & Anti-Idle Immediate Rollover Engine", () => {
  describe("1. Infinite Cadence Loop & Perpetual Invariants", () => {
    it("exports canonical perpetual invariants", () => {
      expect(PERPETUAL_NON_STOPPING_CADENCE).toBe("infinite_autonomous");
      expect(CLOSING_FORBIDDEN_FOR_MIND).toBe("CLOSING_FORBIDDEN_FOR_MIND");
      expect(ZERO_SLEEP_DELAY_MS).toBe(0);
    });

    it("creates initial perpetual cadence state with non-stopping flags", () => {
      const state = createInitialCadenceState({ generation: 2 });
      expect(state.status).toBe("RUNNING");
      expect(state.currentPhase).toBe("IDLE");
      expect(state.generation).toBe(2);
      expect(state.pulseCounter).toBe(0);
      expect(state.rolloverCounter).toBe(0);
      expect(state.infiniteCadenceEnforced).toBe(true);
      expect(state.closing_permitted).toBe(false);
      expect(state.invariant).toBe("CLOSING_FORBIDDEN_FOR_MIND");
      expect(state.currentIntervalMs).toBe(DEFAULT_CADENCE_BASE_INTERVAL_MS);
    });

    it("enforceInfiniteMindCadence guarantees mind loop closure is forbidden", () => {
      const state = createInitialCadenceState({ generation: 1 });
      const enforcement = enforceInfiniteMindCadence(state);
      expect(enforcement.isPermitted).toBe(true);
      expect(enforcement.closingForbidden).toBe(true);
      expect(enforcement.invariant).toBe("CLOSING_FORBIDDEN_FOR_MIND");
      expect(enforcement.message).toContain("Perpetual Mind Cadence enforced");
    });

    it("manages perpetual lifecycle across pulses in MindCadenceEngine", async () => {
      const engine = new MindCadenceEngine({ generation: 1 });
      expect(engine.getState().status).toBe("RUNNING");

      // Execute pulse 1 with work
      const step1 = await engine.step({
        trigger: createCadenceTrigger("WORK_AVAILABLE", "test-runner"),
        pendingTasks: 3,
        pulseOutcome: "converged",
        pulseValue: 2,
        pulseDurationMs: 150,
      });

      expect(step1.executedImmediately).toBe(true);
      expect(step1.delayMs).toBe(0);
      expect(step1.newState.pulseCounter).toBe(1);
      expect(step1.newState.rolloverCounter).toBe(1);
      expect(step1.newState.currentPhase).toBe("ACTIVE");

      // Execute pulse 2 with feedback
      const step2 = await engine.step({
        trigger: createCadenceTrigger("FEEDBACK_RECEIVED", "test-runner"),
        pendingFeedback: 1,
        pulseOutcome: "converged",
        pulseValue: 1,
        pulseDurationMs: 120,
      });

      expect(step2.executedImmediately).toBe(true);
      expect(step2.newState.pulseCounter).toBe(2);
      expect(step2.newState.rolloverCounter).toBe(2);

      const telemetry = engine.getTelemetry();
      expect(telemetry.totalPulses).toBe(2);
      expect(telemetry.totalRollovers).toBe(2);
      expect(telemetry.totalImmediateRollovers).toBe(2);
      expect(telemetry.immediateRolloverRatio).toBe(1.0);
      expect(telemetry.averagePulseDurationMs).toBe(135);
    });
  });

  describe("2. Anti-Idle Immediate Rollover Across Pulses", () => {
    it("immediately rolls over when tasks are pending in queue", () => {
      const trigger = createCadenceTrigger("WORK_AVAILABLE");
      const decision = evaluateAntiIdleRollover({
        trigger,
        pendingTasks: 5,
        pendingFeedback: 0,
        zeroValueStreak: 3,
      });

      expect(decision.shouldRolloverImmediately).toBe(true);
      expect(decision.targetDelayMs).toBe(0);
      expect(decision.targetPhase).toBe("ACTIVE");
      expect(decision.hasPendingWork).toBe(true);
      expect(decision.zeroValueStreak).toBe(0);
      expect(decision.reason).toContain("Anti-idle immediate rollover");
    });

    it("immediately rolls over when feedback is pending in queue", () => {
      const trigger = createCadenceTrigger("FEEDBACK_RECEIVED");
      const decision = evaluateAntiIdleRollover({
        trigger,
        pendingTasks: 0,
        pendingFeedback: 2,
        zeroValueStreak: 1,
      });

      expect(decision.shouldRolloverImmediately).toBe(true);
      expect(decision.targetDelayMs).toBe(0);
      expect(decision.targetPhase).toBe("ACTIVE");
      expect(decision.hasPendingWork).toBe(true);
      expect(decision.zeroValueStreak).toBe(0);
    });

    it("immediately rolls over on explicit IMMEDIATE_ROLLOVER signal", () => {
      const trigger = createCadenceTrigger("IMMEDIATE_ROLLOVER");
      const decision = evaluateAntiIdleRollover({
        trigger,
        pendingTasks: 0,
        pendingFeedback: 0,
        zeroValueStreak: 0,
      });

      expect(decision.shouldRolloverImmediately).toBe(true);
      expect(decision.targetDelayMs).toBe(0);
      expect(decision.targetPhase).toBe("ACTIVE");
    });

    it("immediately rolls over when previous pulse produced positive value", () => {
      const trigger = createCadenceTrigger("PULSE_COMPLETED", "pulse-executor", {
        value: 5,
        outcome: "converged",
      });
      const decision = evaluateAntiIdleRollover({
        trigger,
        pendingTasks: 0,
        pendingFeedback: 0,
        zeroValueStreak: 0,
      });

      expect(decision.shouldRolloverImmediately).toBe(true);
      expect(decision.targetDelayMs).toBe(0);
      expect(decision.targetPhase).toBe("ACTIVE");
      expect(decision.reason).toContain("positive value (5)");
    });

    it("enters resting backoff when no work/feedback is available (quiescent)", () => {
      const trigger = createCadenceTrigger("TIMER_EXPIRED");
      const decision = evaluateAntiIdleRollover({
        trigger,
        pendingTasks: 0,
        pendingFeedback: 0,
        zeroValueStreak: 2,
        baseIntervalMs: 100_000,
        maxIntervalMs: 1_000_000,
        applyJitter: false,
      });

      expect(decision.shouldRolloverImmediately).toBe(false);
      expect(decision.targetDelayMs).toBeGreaterThan(0);
      expect(decision.targetPhase).toBe("RESTING");
      expect(decision.hasPendingWork).toBe(false);
      expect(decision.zeroValueStreak).toBe(3);
    });

    it("respects safety halt and stops rollover", () => {
      const trigger = createCadenceTrigger("SAFETY_HALT");
      const decision = evaluateAntiIdleRollover({
        trigger,
        pendingTasks: 10,
        isHalted: true,
      });

      expect(decision.shouldRolloverImmediately).toBe(false);
      expect(decision.targetDelayMs).toBe(-1);
      expect(decision.targetPhase).toBe("HALTED");
    });
  });

  describe("3. Zero Artificial Sleep Loops & Instant State Transitions", () => {
    it("executes immediate rollover steps with sub-millisecond overhead (no sleep loops)", async () => {
      const engine = new MindCadenceEngine({ generation: 1 });
      const iterations = 50;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        const res = await engine.step({
          trigger: createCadenceTrigger("WORK_AVAILABLE"),
          pendingTasks: 1,
          pulseOutcome: "converged",
          pulseValue: 1,
        });
        expect(res.executedImmediately).toBe(true);
        expect(res.delayMs).toBe(0);
      }

      const totalElapsedMs = performance.now() - startTime;
      const avgStepMs = totalElapsedMs / iterations;

      // Ensure average step time is strictly sub-millisecond or negligible (no artificial sleep)
      expect(avgStepMs).toBeLessThan(5);
      expect(engine.getTelemetry().totalZeroSleepTransitions).toBe(iterations);
    });

    it("dispatches events to registered listeners in real time without blocking", async () => {
      const dispatcher = new CadenceTriggerDispatcher();
      const receivedEvents: string[] = [];

      const unsubscribe = dispatcher.subscribe((ev) => {
        receivedEvents.push(ev.type);
      });

      const state = createInitialCadenceState();
      await dispatcher.dispatch({
        type: "TRIGGER_DISPATCHED",
        currentPhase: "ACTIVE",
        state,
        timestamp: new Date().toISOString(),
      });

      await dispatcher.dispatch({
        type: "ROLLOVER_EXECUTED",
        currentPhase: "ROLLOVER",
        state,
        timestamp: new Date().toISOString(),
      });

      expect(receivedEvents).toEqual(["TRIGGER_DISPATCHED", "ROLLOVER_EXECUTED"]);
      unsubscribe();
      expect(dispatcher.listenerCount).toBe(0);
    });

    it("engine supports halt and resume operations cleanly", async () => {
      const engine = new MindCadenceEngine();
      engine.halt("Manual maintenance halt");
      expect(engine.getState().status).toBe("HALTED");
      expect(engine.getState().currentPhase).toBe("HALTED");

      const haltedStep = await engine.step({
        trigger: createCadenceTrigger("WORK_AVAILABLE"),
        pendingTasks: 5,
      });
      expect(haltedStep.decision.targetPhase).toBe("HALTED");
      expect(haltedStep.executedImmediately).toBe(false);

      engine.resume();
      expect(engine.getState().status).toBe("RUNNING");
      expect(engine.getState().currentPhase).toBe("ACTIVE");
    });
  });

  describe("4. Dynamic Interval Adjustments & Backoff Handling", () => {
    it("computes anti-idle interval correctly via computeAntiIdleInterval", () => {
      const workActive = computeAntiIdleInterval({
        hasPendingWork: true,
        zeroValueStreak: 5,
      });
      expect(workActive.isImmediate).toBe(true);
      expect(workActive.intervalMs).toBe(0);
      expect(workActive.zeroValueStreak).toBe(0);

      const quiescent = computeAntiIdleInterval({
        hasPendingWork: false,
        zeroValueStreak: 2,
        baseIntervalMs: 10_000,
        maxIntervalMs: 100_000,
        applyJitter: false,
      });
      expect(quiescent.isImmediate).toBe(false);
      expect(quiescent.intervalMs).toBe(Math.round(10_000 * Math.pow(1.5, 2)));
    });

    it("computes exponential backoff accurately: min(max, round(base * 1.5^streak))", () => {
      const base = 1000;
      const max = 10000;

      expect(calculateExponentialBackoff(base, max, 0)).toBe(1000);
      expect(calculateExponentialBackoff(base, max, 1)).toBe(1500);
      expect(calculateExponentialBackoff(base, max, 2)).toBe(2250);
      expect(calculateExponentialBackoff(base, max, 3)).toBe(3375);
      expect(calculateExponentialBackoff(base, max, 10)).toBe(max);
    });

    it("supports multiple backoff strategies", () => {
      const base = 1000;
      const max = 20000;

      expect(calculateBackoffWithStrategy({ baseIntervalMs: base, maxIntervalMs: max, streak: 3, strategy: "immediate" })).toBe(0);
      expect(calculateBackoffWithStrategy({ baseIntervalMs: base, maxIntervalMs: max, streak: 3, strategy: "fixed" })).toBe(1000);
      expect(calculateBackoffWithStrategy({ baseIntervalMs: base, maxIntervalMs: max, streak: 3, strategy: "linear" })).toBe(4000);
      expect(calculateBackoffWithStrategy({ baseIntervalMs: base, maxIntervalMs: max, streak: 3, strategy: "fibonacci" })).toBe(3000);
      expect(calculateBackoffWithStrategy({ baseIntervalMs: base, maxIntervalMs: max, streak: 2, strategy: "exponential", multiplier: 2 })).toBe(4000);
    });

    it("projects interval progression over N steps", () => {
      const steps = projectIntervalProgression({
        baseIntervalMs: 1000,
        maxIntervalMs: 10000,
        steps: 4,
        strategy: "linear",
      });
      expect(steps).toEqual([1000, 2000, 3000, 4000]);
    });

    it("generates deterministic PRNG sequence with Mulberry32", () => {
      const prng1 = createDeterministicRandom(42);
      const prng2 = createDeterministicRandom(42);

      const seq1 = [prng1(), prng1(), prng1(), prng1()];
      const seq2 = [prng2(), prng2(), prng2(), prng2()];

      expect(seq1).toEqual(seq2);
      for (const val of seq1) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });

    it("calculates deterministic interval with reproducible jitter", () => {
      const interval1 = calculateDeterministicInterval(10_000, 12345);
      const interval2 = calculateDeterministicInterval(10_000, 12345);
      expect(interval1).toBe(interval2);
      expect(interval1).toBeGreaterThanOrEqual(8_000);
      expect(interval1).toBeLessThanOrEqual(12_000);
    });

    it("formats and parses interval durations", () => {
      expect(formatIntervalDuration(0)).toBe("0ms");
      expect(formatIntervalDuration(500)).toBe("500ms");
      expect(formatIntervalDuration(60_000)).toBe("1m");
      expect(formatIntervalDuration(900_000)).toBe("15m");
      expect(formatIntervalDuration(3_660_000)).toBe("1h 1m");

      expect(parseIntervalDuration("0ms")).toBe(0);
      expect(parseIntervalDuration("15m")).toBe(900_000);
      expect(parseIntervalDuration("1h")).toBe(3_600_000);
    });

    it("calculates throttle interval on terminal, paused, and reset outcomes", () => {
      const terminal = calculateThrottleInterval({
        baseIntervalMs: 1000,
        maxIntervalMs: 5000,
        zeroValueStreak: 2,
        value: 0,
        outcome: "halted",
      });
      expect(terminal.isTerminal).toBe(true);
      expect(terminal.intervalMs).toBeNull();

      const rateLimited = calculateThrottleInterval({
        baseIntervalMs: 1000,
        maxIntervalMs: 5000,
        previousIntervalMs: 1500,
        zeroValueStreak: 1,
        value: 0,
        outcome: "paused",
        applyJitter: false,
      });
      expect(rateLimited.isRateLimited).toBe(true);
      expect(rateLimited.intervalMs).toBe(3000);

      const valueReset = calculateThrottleInterval({
        baseIntervalMs: 1000,
        maxIntervalMs: 5000,
        zeroValueStreak: 3,
        value: 10,
        outcome: "converged",
        applyJitter: false,
      });
      expect(valueReset.isReset).toBe(true);
      expect(valueReset.zeroValueStreak).toBe(0);
      expect(valueReset.intervalMs).toBe(1000);
    });

    it("generates trailing value series correctly", () => {
      const series = generateTrailingValueSeries([
        { pulseId: "p1", outcome: "converged", value: 5 },
        { pulseId: "p2", outcome: "quiescent", value: 0 },
        { pulseId: "p3", outcome: "quiescent", value: 0 },
      ]);
      expect(series.rawValues).toEqual([5, 0, 0]);
      expect(series.totalValue).toBe(5);
      expect(series.trailingZeroStreak).toBe(2);
      expect(series.isFlatZero).toBe(false);
      expect(formatRawValueSeries(series.rawValues)).toBe("[5, 0, 0]");
    });
  });

  describe("5. Liveness Tracking, Stale Pulse Reclamation & Timeout Recovery", () => {
    it("maps liveness status to canonical exit codes", () => {
      expect(getExitCodeForStatus("healthy")).toBe(EXIT_CODE_HEALTHY);
      expect(getExitCodeForStatus("stale")).toBe(EXIT_CODE_STALE);
      expect(getExitCodeForStatus("missing_record")).toBe(EXIT_CODE_CHECK_FAILURE);
      expect(getExitCodeForStatus("corrupted_record")).toBe(EXIT_CODE_CHECK_FAILURE);
    });

    it("evaluates healthy in-memory pulse record", () => {
      const nowMs = 1_700_000_000_000;
      const record = {
        pulse_id: "pulse-42",
        outcome: "active",
        at: new Date(nowMs - 60_000).toISOString(), // 1 minute old
        next_wake_at: new Date(nowMs + 840_000).toISOString(),
      };

      const result = evaluateLivenessFromRecord(record, {
        nowMs,
        intervalMs: 900_000,
        graceMs: 300_000,
      });

      expect(result.status).toBe("healthy");
      expect(result.healthy).toBe(true);
      expect(result.exitCode).toBe(EXIT_CODE_HEALTHY);
      expect(result.metrics.pulseId).toBe("pulse-42");
      expect(result.metrics.ageMs).toBe(60_000);
    });

    it("evaluates stale pulse when age exceeds interval + grace threshold", () => {
      const nowMs = 1_700_000_000_000;
      const record = {
        pulse_id: "pulse-42",
        outcome: "active",
        at: new Date(nowMs - 1_300_000).toISOString(), // 21.6 minutes old (> 20 min threshold)
      };

      const result = evaluateLivenessFromRecord(record, {
        nowMs,
        intervalMs: 900_000,
        graceMs: 300_000,
      });

      expect(result.status).toBe("stale");
      expect(result.healthy).toBe(false);
      expect(result.exitCode).toBe(EXIT_CODE_STALE);
      expect(result.reason).toContain("PAGING OWNER");
    });

    it("handles corrupted pulse records gracefully", () => {
      const corrupted = {
        pulse_id: "pulse-corrupt",
        at: "not-a-valid-date",
      };

      const result = evaluateLivenessFromRecord(corrupted);
      expect(result.status).toBe("corrupted_record");
      expect(result.healthy).toBe(false);
      expect(result.exitCode).toBe(EXIT_CODE_CHECK_FAILURE);
    });

    it("calculates time-to-stale accurately", () => {
      const nowMs = 1_000_000;
      const freshTs = new Date(nowMs - 200_000).toISOString();
      const staleCheck = calculateTimeToStaleMs(freshTs, 500_000, nowMs);

      expect(staleCheck.isStale).toBe(false);
      expect(staleCheck.remainingMs).toBe(300_000);
      expect(staleCheck.staleByMs).toBe(0);

      const oldTs = new Date(nowMs - 700_000).toISOString();
      const expiredCheck = calculateTimeToStaleMs(oldTs, 500_000, nowMs);
      expect(expiredCheck.isStale).toBe(true);
      expect(expiredCheck.remainingMs).toBe(0);
      expect(expiredCheck.staleByMs).toBe(200_000);
    });

    it("checks stale pulse reclaim readiness", () => {
      const nowMs = 1_000_000;
      const openActive = {
        open: {
          pulse_id: "pulse-10",
          deadline_at: new Date(nowMs + 50_000).toISOString(),
        },
      };

      const notReady = checkStalePulseReclaimReadiness(openActive, { nowMs, graceMs: 10_000 });
      expect(notReady.isReadyForReclaim).toBe(false);
      expect(notReady.openPulseId).toBe("pulse-10");

      const openExpired = {
        open: {
          pulse_id: "pulse-11",
          deadline_at: new Date(nowMs - 30_000).toISOString(),
        },
      };

      const ready = checkStalePulseReclaimReadiness(openExpired, { nowMs, graceMs: 10_000 });
      expect(ready.isReadyForReclaim).toBe(true);
      expect(ready.openPulseId).toBe("pulse-11");
      expect(ready.deadlinePassedByMs).toBe(30_000);
    });

    it("creates formatted pulse heartbeat and liveness brief", () => {
      const heartbeat = createPulseHeartbeat("pulse-99", { outcome: "active" });
      expect(heartbeat.pulse_id).toBe("pulse-99");
      expect(heartbeat.outcome).toBe("active");
      expect(typeof heartbeat.at).toBe("string");

      const brief = formatLivenessBrief({
        status: "healthy",
        healthy: true,
        exitCode: 0,
        reason: "Fresh",
        capsuleDir: ".capsules/test",
        pulseFile: ".capsules/test/last_pulse.json",
        metrics: {
          pulseId: "pulse-99",
          outcome: "active",
          pulseTimestamp: new Date().toISOString(),
          pulseTimeMs: Date.now(),
          nextWakeAt: null,
          ageMs: 5000,
          maxAllowedAgeMs: 1_200_000,
          intervalMs: 900_000,
          graceMs: 300_000,
        },
      });

      expect(brief).toContain("Mind Liveness Status: 🟢 HEALTHY");
      expect(brief).toContain("pulse-99");
    });

    it("analyzes multi-pulse history liveness trends", () => {
      const nowMs = 1_700_000_000_000;
      const history = [
        { pulse_id: "p1", at: new Date(nowMs - 100_000).toISOString() },
        { pulse_id: "p2", at: new Date(nowMs - 200_000).toISOString() },
        { pulse_id: "p3", at: new Date(nowMs - 300_000).toISOString() },
      ];

      const trends = analyzeLivenessTrends(history, {
        nowMs,
        intervalMs: 900_000,
        graceMs: 300_000,
      });

      expect(trends.totalPulses).toBe(3);
      expect(trends.healthyCount).toBe(3);
      expect(trends.staleCount).toBe(0);
      expect(trends.healthPercentage).toBe(100);
      expect(trends.consecutiveHealthyStreak).toBe(3);
      expect(trends.latestStatus).toBe("healthy");
    });
  });

  describe("6. Static Invariants (Zero-Any TypeScript & No Suppressions)", () => {
    const filesToInspect = [
      "orchestrating-long-tasks/scripts/src/mind/cadence.ts",
      "orchestrating-long-tasks/scripts/src/mind/interval.ts",
      "orchestrating-long-tasks/scripts/src/mind/liveness.ts",
      "orchestrating-long-tasks/scripts/src/mind/cadence-rollover.test.ts",
    ];

    // Build search patterns dynamically to avoid self-match
    const colonAny = ":" + " any";
    const asAny = "as" + " any";
    const genericAny = "<" + "any>";
    const recordAny = "Record<string," + " any>";
    const promiseAny = "Promise<" + "any>";

    const tsIgnore = "@ts-" + "ignore";
    const tsExpectError = "@ts-" + "expect-error";
    const tsNocheck = "@ts-" + "nocheck";
    const suppressionDirectiveA = ["es", "lint", "-disable"].join("");

    for (const relPath of filesToInspect) {
      it(`verifies ${relPath} contains 0 occurrences of 'any' and 0 suppressions`, () => {
        const fullPath = join(process.cwd(), relPath);
        const content = readFileSync(fullPath, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          // Skip comment lines in static test checking itself if needed, but here we enforce clean source
          if (line.includes("// Build search patterns") || line.includes("const colonAny =") || line.includes("const tsIgnore =") || line.includes("suppressionDirectiveA")) {
            continue;
          }

          // Check for TypeScript any usages
          expect(line).not.toContain(colonAny);
          expect(line).not.toContain(asAny);
          expect(line).not.toContain(genericAny);
          expect(line).not.toContain(recordAny);
          expect(line).not.toContain(promiseAny);

          // Check for suppressions
          expect(line).not.toContain(tsIgnore);
          expect(line).not.toContain(tsExpectError);
          expect(line).not.toContain(tsNocheck);
          expect(line).not.toContain(suppressionDirectiveA);
        }
      });
    }
  });
});
