import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  CLOSING_FORBIDDEN_FOR_MIND,
  assertStagnationUnsuppressed,
  computeProgressSignature,
  evaluateAntiStagnation,
  recordNonZeroProgress,
  type AntiStagnationOptions,
  type AntiStagnationState,
  type ProgressDeltaInput,
} from "../../../olt/scripts/src/mind/lifecycle/orchestration/anti-stagnation.ts";
import {
  evaluateMindMode,
  runMindProductManagerLoop,
} from "../../../olt/scripts/src/mind/lifecycle/orchestration/product-manager.ts";
import {
  decideNextPulse,
  enforceInfiniteCadence,
} from "../../../olt/scripts/src/mind/cadence/driver-schedule.ts";
import {
  runPulseDriver,
  stepPulseDriver,
  type PulseDriverConfig,
  type PulseDriverPorts,
} from "../../../olt/scripts/src/mind/cadence/driver-loop.ts";
import { emptyDriverCounters } from "../../../olt/scripts/src/mind/cadence/driver-health.ts";
import { buildRemediationGuidance } from "../../../olt/scripts/src/engine/runner/process/watchdog-remediation.ts";
import { readCognitiveMemory } from "../../../olt/scripts/src/mind/tasks/smart/planner/memory.ts";
import { writeTaskQueue } from "../../../olt/scripts/src/task/queue/index.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Anti-Stagnation & Infinite Cadence Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const testDir = "/virtual/anti-stag-test";
  let memoryPath: string;
  let queuePath: string;
  let feedbackPath: string;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(testDir, { recursive: true });
    vfs.mkdirSync(join(testDir, ".olt"), { recursive: true });
    memoryPath = join(testDir, ".olt", "memory.json");
    queuePath = join(testDir, ".olt", "tasks.jsonl");
    feedbackPath = join(testDir, ".olt", "backlog.jsonl");
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("Anti-Stagnation Accumulation Across Cycles", () => {
    it("accumulates consecutiveZeroDeltaCycles and consecutiveMaintenanceCycles via options.previousState", () => {
      const input: ProgressDeltaInput = {
        synthesizedCount: 0,
        enqueuedCount: 0,
        openDefectsCount: 0,
        feedbackCount: 0,
      };
      const sig = computeProgressSignature(input);
      const inputWithSig: ProgressDeltaInput = {
        ...input,
        previousSignature: sig,
      };

      const eval1 = evaluateAntiStagnation(inputWithSig, { memoryPath });
      expect(eval1.consecutiveZeroDeltaCycles).toBe(1);
      expect(eval1.consecutiveMaintenanceCycles).toBe(1);
      expect(eval1.isStagnant).toBe(false);

      const eval2 = evaluateAntiStagnation(inputWithSig, {
        memoryPath,
        previousState: eval1,
      });
      expect(eval2.consecutiveZeroDeltaCycles).toBe(2);
      expect(eval2.consecutiveMaintenanceCycles).toBe(2);
      expect(eval2.isStagnant).toBe(false);

      const eval3 = evaluateAntiStagnation(inputWithSig, {
        memoryPath,
        previousState: eval2,
      });
      expect(eval3.consecutiveZeroDeltaCycles).toBe(3);
      expect(eval3.consecutiveMaintenanceCycles).toBe(3);
      expect(eval3.creativeStagnationDetected).toBe(true);
      expect(eval3.isStagnant).toBe(true);
    });

    it("accumulates consecutive cycles across evaluations via cognitive memory persistence", () => {
      const input: ProgressDeltaInput = {
        synthesizedCount: 0,
        enqueuedCount: 0,
        openDefectsCount: 0,
        feedbackCount: 0,
      };
      const sig = computeProgressSignature(input);

      const eval1 = evaluateAntiStagnation(
        { ...input, previousSignature: sig },
        { memoryPath, now: "2026-09-09T10:00:00.000Z" },
      );
      expect(eval1.consecutiveZeroDeltaCycles).toBe(1);
      expect(eval1.consecutiveMaintenanceCycles).toBe(1);

      // Second evaluation reads accumulated state from memory file
      const eval2 = evaluateAntiStagnation(
        { ...input, previousSignature: sig },
        { memoryPath, now: "2026-09-09T10:01:00.000Z" },
      );
      expect(eval2.consecutiveZeroDeltaCycles).toBe(2);
      expect(eval2.consecutiveMaintenanceCycles).toBe(2);

      // Third evaluation hits threshold 3
      const eval3 = evaluateAntiStagnation(
        { ...input, previousSignature: sig },
        { memoryPath, now: "2026-09-09T10:02:00.000Z" },
      );
      expect(eval3.consecutiveZeroDeltaCycles).toBe(3);
      expect(eval3.consecutiveMaintenanceCycles).toBe(3);
      expect(eval3.creativeStagnationDetected).toBe(true);
      expect(eval3.isStagnant).toBe(true);
    });

    it("resets consecutiveZeroDeltaCycles on non-zero delta while accumulating maintenance cycles", () => {
      const state1 = evaluateAntiStagnation(
        {
          synthesizedCount: 0,
          enqueuedCount: 0,
          openDefectsCount: 0,
          feedbackCount: 0,
          previousSignature: "sig-alpha",
        },
        { memoryPath, consecutiveZeroDeltaCycles: 2, consecutiveMaintenanceCycles: 2 },
      );

      // Different signature resets zero delta cycles to 0, but maintenance increments to 3
      expect(state1.consecutiveZeroDeltaCycles).toBe(0);
      expect(state1.consecutiveMaintenanceCycles).toBe(3);
      expect(state1.creativeStagnationDetected).toBe(true);
      expect(state1.isStagnant).toBe(true);
    });

    it("resets both counters on non-zero progress recording", () => {
      const stagnantState: AntiStagnationState = {
        consecutiveZeroDeltaCycles: 3,
        consecutiveMaintenanceCycles: 3,
        lastNonZeroProgressTimestamp: "2026-09-09T10:00:00.000Z",
        isStagnant: true,
        creativeStagnationDetected: true,
        preplanningStagnationDetected: false,
        activeHypothesisCount: 1,
        progressiveScore: 0,
      };

      recordNonZeroProgress("Synthesized 3 quality features", stagnantState, {
        memoryPath,
      });

      const mem = readCognitiveMemory(memoryPath);
      const antiStagMem = mem.context?.["anti_stagnation"] as
        | Readonly<Record<string, unknown>>
        | undefined;
      expect(antiStagMem?.["consecutiveZeroDeltaCycles"]).toBe(0);
      expect(antiStagMem?.["consecutiveMaintenanceCycles"]).toBe(0);
      expect(antiStagMem?.["isStagnant"]).toBe(false);
    });
  });

  describe("Creative and Preplanning Stagnation Triggers", () => {
    it("triggers isCreativeStagnant when consecutiveZeroDeltaCycles >= zeroDeltaThreshold", () => {
      const input: ProgressDeltaInput = {
        synthesizedCount: 1,
        enqueuedCount: 1,
        openDefectsCount: 0,
        feedbackCount: 0,
      };
      const sig = computeProgressSignature(input);

      const result = evaluateAntiStagnation(
        { ...input, previousSignature: sig },
        { memoryPath, consecutiveZeroDeltaCycles: 2, zeroDeltaThreshold: 3 },
      );
      expect(result.consecutiveZeroDeltaCycles).toBe(3);
      expect(result.consecutiveMaintenanceCycles).toBe(0);
      expect(result.creativeStagnationDetected).toBe(true);
      expect(result.preplanningStagnationDetected).toBe(false);
      expect(result.isStagnant).toBe(true);
    });

    it("triggers isCreativeStagnant when consecutiveMaintenanceCycles >= maintenanceThreshold", () => {
      const input: ProgressDeltaInput = {
        synthesizedCount: 0,
        enqueuedCount: 0,
        openDefectsCount: 0,
        feedbackCount: 0,
        previousSignature: "different-sig",
      };

      const result = evaluateAntiStagnation(input, {
        memoryPath,
        consecutiveMaintenanceCycles: 2,
        maintenanceThreshold: 3,
      });
      expect(result.consecutiveMaintenanceCycles).toBe(3);
      expect(result.creativeStagnationDetected).toBe(true);
      expect(result.isStagnant).toBe(true);
    });

    it("triggers isPreplanningStagnant when openDefectsCount > 0 && synthesizedCount === 0 && enqueuedCount === 0", () => {
      const input: ProgressDeltaInput = {
        synthesizedCount: 0,
        enqueuedCount: 0,
        openDefectsCount: 2,
        feedbackCount: 0,
      };

      const result = evaluateAntiStagnation(input, { memoryPath });
      expect(result.preplanningStagnationDetected).toBe(true);
      expect(result.isStagnant).toBe(true);
    });

    it("does not trigger isPreplanningStagnant when tasks are synthesized", () => {
      const input: ProgressDeltaInput = {
        synthesizedCount: 2,
        enqueuedCount: 2,
        openDefectsCount: 2,
        feedbackCount: 0,
      };

      const result = evaluateAntiStagnation(input, { memoryPath });
      expect(result.preplanningStagnationDetected).toBe(false);
    });
  });

  describe("Unsuppressed Stagnation Invariant", () => {
    it("assertStagnationUnsuppressed passes when stagnation flags are aligned", () => {
      const state: AntiStagnationState = {
        consecutiveZeroDeltaCycles: 3,
        consecutiveMaintenanceCycles: 3,
        lastNonZeroProgressTimestamp: "2026-09-09T10:00:00.000Z",
        isStagnant: true,
        creativeStagnationDetected: true,
        preplanningStagnationDetected: false,
        activeHypothesisCount: 1,
        progressiveScore: 10,
      };
      expect(() => assertStagnationUnsuppressed(state)).not.toThrow();
    });

    it("assertStagnationUnsuppressed throws if isStagnant is true but sub-flags are suppressed", () => {
      const suppressedState: AntiStagnationState = {
        consecutiveZeroDeltaCycles: 0,
        consecutiveMaintenanceCycles: 0,
        lastNonZeroProgressTimestamp: "2026-09-09T10:00:00.000Z",
        isStagnant: true,
        creativeStagnationDetected: false,
        preplanningStagnationDetected: false,
        activeHypothesisCount: 0,
        progressiveScore: 100,
      };
      expect(() => assertStagnationUnsuppressed(suppressedState)).toThrow(
        /Stagnation invariant violation/,
      );
    });

    it("writes unsuppressed stagnation hypotheses to cognitive memory", () => {
      const input: ProgressDeltaInput = {
        synthesizedCount: 0,
        enqueuedCount: 0,
        openDefectsCount: 1,
        feedbackCount: 0,
      };

      evaluateAntiStagnation(input, { memoryPath, now: "2026-09-09T12:00:00.000Z" });
      const mem = readCognitiveMemory(memoryPath);
      const stagnationHyp = mem.active_hypotheses.find(
        (h) => h.id === "hyp-preplanning-stagnation-unsuppressed",
      );
      expect(stagnationHyp).toBeDefined();
      expect(stagnationHyp?.statement).toContain("Active preplanning stagnation");
      expect(mem.strategic_focus.some((s) => s.includes("STAGNATION DEFECT"))).toBe(true);
    });
  });

  describe("CLOSING_FORBIDDEN_FOR_MIND & Product Manager", () => {
    it("enforces MODE_A_CREATIVE_PRODUCT_MANAGER when queue and feedback intake are clear", () => {
      writeTaskQueue([], queuePath);
      vfs.writeFileSync(feedbackPath, "");

      const result = evaluateMindMode({
        queuePath,
        feedbackQueuePath: feedbackPath,
        repoRoot: testDir,
        memoryPath,
        capsulesDir: join(testDir, ".olt", "capsules"),
        now: "2026-09-09T12:00:00.000Z",
      });

      expect(result.mode).toBe("MODE_A_CREATIVE_PRODUCT_MANAGER");
      expect(result.recommendedAction).toBe("EXECUTE_AUTONOMOUS_PRODUCT_EXPANSION");
      expect(result.reason).toContain("CLOSING_FORBIDDEN_FOR_MIND");
      expect(result.reason).toContain("Quality -> UI/UX Perfection -> Feature Ideation");
      expect(result.nextCommand).toContain("mind:self-evolve");
    });

    it("prescribes REMEDIATE_OPEN_DEFECTS when preplanning stagnation is detected", () => {
      writeTaskQueue([], queuePath);
      const capsulesDir = join(testDir, "capsules-open-defects");
      vfs.mkdirSync(capsulesDir, { recursive: true });
      vfs.writeFileSync(
        join(capsulesDir, "defects.jsonl"),
        JSON.stringify({
          id: "defect-test-1",
          status: "open",
          severity: "HIGH",
          category: "STAGNATION",
          statement: "Unresolved preplanning defect",
        }) + "\n",
      );

      const result = evaluateMindMode({
        queuePath,
        feedbackQueuePath: feedbackPath,
        repoRoot: testDir,
        memoryPath,
        capsulesDir,
        now: "2026-09-09T12:00:00.000Z",
      });

      expect(result.antiStagnationState.preplanningStagnationDetected).toBe(true);
      expect(result.recommendedAction).toBe("REMEDIATE_OPEN_DEFECTS");
      expect(result.reason).toContain("Preplanning stagnation detected");
    });
  });

  describe("Cadence Scheduler & Infinite Driver Loop", () => {
    it("decideNextPulse never terminates unprompted when nextWakeAt is missing or null", () => {
      const decision = decideNextPulse({
        nowMs: 100_000,
        nextWakeAt: null,
        lastAttemptAtMs: null,
        minIntervalMs: 60_000,
        maxSliceMs: 60_000,
      });

      expect(decision.due).toBe(true);
      expect(decision.waitMs).toBe(0);
      expect(decision.reason).toBe("no_prior_pulse");
    });

    it("enforceInfiniteCadence ensures bounded slice or due state", () => {
      const bounded = enforceInfiniteCadence({
        due: false,
        waitMs: 0,
        reason: "cooldown",
        deadlineMs: null,
      });
      expect(bounded.due).toBe(true);
      expect(bounded.waitMs).toBe(0);
    });

    it("runPulseDriver continues across clear queues without unprompted termination", () => {
      let callCount = 0;
      const ports: PulseDriverPorts = {
        now: () => 100_000,
        readNextWakeAt: () => null,
        runPulse: () => {
          callCount += 1;
          return { exitCode: 0, lockMechanism: "flock", stderr: "" };
        },
        writeHealth: () => {},
        sleep: () => {},
      };

      const config: PulseDriverConfig = {
        runRoot: testDir,
        pid: 1234,
        startedAtMs: 100_000,
        minIntervalMs: 0,
        maxSliceMs: 60_000,
        enforceInfiniteCadence: true,
      };

      const result = runPulseDriver(
        config,
        emptyDriverCounters(),
        ports,
        (iteration) => iteration < 3,
      );
      expect(result.iterations).toBe(3);
      expect(callCount).toBe(3);
    });
  });

  describe("Watchdog Remediation Under CLOSING_FORBIDDEN_FOR_MIND", () => {
    it("commands autonomous wave replanning rather than shutdown for Mind supervisor", () => {
      const guidance = buildRemediationGuidance({
        role: "mind",
        errorClassification: "STALL_TIMEOUT",
      });

      expect(guidance.action).toBe("autonomous_repair_routing");
      expect(guidance.summary).toContain("CLOSING_FORBIDDEN_FOR_MIND");
      expect(guidance.summary).toContain("shutdown is strictly prohibited");
      expect(guidance.supervisorTarget).toBe("mind");
      expect(guidance.fallbackDirective).toContain("Mind commands autonomous wave replanning");
      expect(guidance.fallbackDirective).toContain("rather than shutdown");
    });

    it("orchestrator stall escalates to Mind commanding autonomous wave replanning rather than shutdown", () => {
      const guidance = buildRemediationGuidance({
        role: "orchestrator",
        errorClassification: "STALL_TIMEOUT",
      });

      expect(guidance.action).toBe("escalate_to_supervisor");
      expect(guidance.supervisorTarget).toBe("mind");
      expect(guidance.fallbackDirective).toContain("Mind initiates autonomous wave replanning");
      expect(guidance.fallbackDirective).toContain(
        "under CLOSING_FORBIDDEN_FOR_MIND rather than shutdown",
      );
    });

    it("fallback guidance preserves CLOSING_FORBIDDEN_FOR_MIND when supervisor is Mind", () => {
      const guidance = buildRemediationGuidance({
        role: "unknown_daemon",
        supervisorTier: "mind",
        errorClassification: "STALL_TIMEOUT",
      });

      expect(guidance.supervisorTarget).toBe("mind");
      expect(guidance.summary).toContain("CLOSING_FORBIDDEN_FOR_MIND");
      expect(guidance.fallbackDirective).toContain("command autonomous wave replanning");
    });
  });
});
