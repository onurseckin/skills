import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  computeStagnationSignature,
  evaluateAntiStagnationState,
  getRegisteredEngines,
  registerActiveEngine,
  resetRegisteredEngines,
  runAutonomousInitialization,
  unregisterActiveEngine,
  type MindAntiStagnationConfig,
  type StagnationMetrics,
} from "../../olt/scripts/src/mind/implement-mind-system-anti-stagnation-engine-autonomous-initialization-fb-1788280257917-mfzkp.ts";

describe("Mind System Anti-Stagnation Engine & Autonomous Initialization", () => {
  beforeEach(() => {
    resetRegisteredEngines();
  });

  afterEach(() => {
    resetRegisteredEngines();
  });

  test("computes deterministic stagnation signatures across cycle metrics", () => {
    const metricsA: StagnationMetrics = {
      synthesizedCount: 2,
      enqueuedCount: 3,
      openDefectsCount: 1,
      feedbackCount: 0,
    };
    const metricsB: StagnationMetrics = {
      synthesizedCount: 2,
      enqueuedCount: 3,
      openDefectsCount: 1,
      feedbackCount: 0,
    };
    const metricsC: StagnationMetrics = {
      synthesizedCount: 3,
      enqueuedCount: 3,
      openDefectsCount: 1,
      feedbackCount: 0,
    };
    const sigA = computeStagnationSignature(metricsA);
    const sigB = computeStagnationSignature(metricsB);
    const sigC = computeStagnationSignature(metricsC);
    expect(sigA.length).toBe(16);
    expect(sigA).toBe(sigB);
    expect(sigA).not.toBe(sigC);
  });

  test("evaluates active non-stagnant state with progressive scoring", () => {
    const metrics: StagnationMetrics = {
      synthesizedCount: 5,
      enqueuedCount: 2,
      openDefectsCount: 0,
      feedbackCount: 1,
      previousSignature: "different_signature",
    };
    const evalResult = evaluateAntiStagnationState(metrics);
    expect(evalResult.isStagnant).toBe(false);
    expect(evalResult.zeroDeltaCycles).toBe(0);
    expect(evalResult.progressiveScore).toBeGreaterThan(50);
    expect(evalResult.actionRecommended).toBe("continue");
    expect(evalResult.containmentState).toBe("nominal");
    expect(evalResult.quotaDepleted).toBe(false);
  });

  test("triggers socratic challenge when zero delta threshold reached", () => {
    const metrics: StagnationMetrics = {
      synthesizedCount: 0,
      enqueuedCount: 0,
      openDefectsCount: 0,
      feedbackCount: 0,
    };
    const currentSig = computeStagnationSignature(metrics);
    const stagnantMetrics: StagnationMetrics = {
      ...metrics,
      previousSignature: currentSig,
    };
    const customConfig: MindAntiStagnationConfig = {
      zeroDeltaThreshold: 1,
      maintenanceThreshold: 1,
      targetCadenceSeconds: 30,
      enableAutonomousInit: true,
    };
    const evalResult = evaluateAntiStagnationState(stagnantMetrics, customConfig);
    expect(evalResult.isStagnant).toBe(true);
    expect(evalResult.zeroDeltaCycles).toBe(1);
    expect(evalResult.actionRecommended).toBe("socratic_challenge");
  });

  test("recommends force sync when defects exceed threshold", () => {
    const metrics: StagnationMetrics = {
      synthesizedCount: 1,
      enqueuedCount: 1,
      openDefectsCount: 10,
      feedbackCount: 0,
    };
    const evalResult = evaluateAntiStagnationState(metrics);
    expect(evalResult.actionRecommended).toBe("force_sync");
    expect(evalResult.isStagnant).toBe(false);
  });

  test("recommends suspended animation on quota exhaustion", () => {
    const depletedMetrics: StagnationMetrics = {
      synthesizedCount: 4,
      enqueuedCount: 1,
      openDefectsCount: 0,
      feedbackCount: 2,
      remainingQuotaPercentage: 8,
    };
    const depletedResult = evaluateAntiStagnationState(depletedMetrics);
    expect(depletedResult.quotaDepleted).toBe(true);
    expect(depletedResult.actionRecommended).toBe("suspend_quota");
    expect(depletedResult.remainingQuotaPercentage).toBe(8);

    const healthyMetrics: StagnationMetrics = {
      ...depletedMetrics,
      remainingQuotaPercentage: 65,
    };
    const healthyResult = evaluateAntiStagnationState(healthyMetrics);
    expect(healthyResult.quotaDepleted).toBe(false);
    expect(healthyResult.actionRecommended).toBe("continue");

    const customFloorConfig: MindAntiStagnationConfig = {
      zeroDeltaThreshold: 3,
      maintenanceThreshold: 3,
      targetCadenceSeconds: 60,
      enableAutonomousInit: true,
      quotaFloorPercentage: 20,
    };
    const customFloorResult = evaluateAntiStagnationState(
      { ...depletedMetrics, remainingQuotaPercentage: 15 },
      customFloorConfig,
    );
    expect(customFloorResult.quotaDepleted).toBe(true);
    expect(customFloorResult.actionRecommended).toBe("suspend_quota");
  });

  test("enforces 3-strike boundary containment progression", () => {
    const baseMetrics: StagnationMetrics = {
      synthesizedCount: 0,
      enqueuedCount: 0,
      openDefectsCount: 0,
      feedbackCount: 0,
    };
    const sig = computeStagnationSignature(baseMetrics);

    const strike0 = evaluateAntiStagnationState({
      ...baseMetrics,
      previousSignature: "different_sig",
    });
    expect(strike0.zeroDeltaCycles).toBe(0);
    expect(strike0.containmentState).toBe("nominal");
    expect(strike0.actionRecommended).toBe("continue");

    const strike1 = evaluateAntiStagnationState({
      ...baseMetrics,
      previousSignature: sig,
      consecutiveZeroDeltas: 0,
    });
    expect(strike1.zeroDeltaCycles).toBe(1);
    expect(strike1.containmentState).toBe("strike_1");

    const strike2 = evaluateAntiStagnationState({
      ...baseMetrics,
      previousSignature: sig,
      consecutiveZeroDeltas: 1,
    });
    expect(strike2.zeroDeltaCycles).toBe(2);
    expect(strike2.containmentState).toBe("strike_2");

    const strike3 = evaluateAntiStagnationState({
      ...baseMetrics,
      previousSignature: sig,
      consecutiveZeroDeltas: 2,
    });
    expect(strike3.zeroDeltaCycles).toBe(3);
    expect(strike3.containmentState).toBe("containment");
    expect(strike3.isStagnant).toBe(true);
    expect(strike3.actionRecommended).toBe("socratic_challenge");

    const customStrikeConfig: MindAntiStagnationConfig = {
      zeroDeltaThreshold: 5,
      maintenanceThreshold: 3,
      targetCadenceSeconds: 60,
      enableAutonomousInit: true,
      strikeLimit: 2,
    };
    const strikeCustom = evaluateAntiStagnationState(
      {
        ...baseMetrics,
        previousSignature: sig,
        consecutiveZeroDeltas: 1,
      },
      customStrikeConfig,
    );
    expect(strikeCustom.containmentState).toBe("containment");
    expect(strikeCustom.actionRecommended).toBe("socratic_challenge");
  });

  test("executes autonomous initialization with capsule ingestion and active engine registration", () => {
    const defaultInit = runAutonomousInitialization();
    expect(defaultInit.initialized).toBe(true);
    expect(defaultInit.activeEngines.length).toBe(3);
    expect(defaultInit.activeEngines).toContain("anti-stagnation");
    expect(defaultInit.activeEngines).toContain("cognitive-memory");
    expect(defaultInit.activeEngines).toContain("pareto-arbitration");
    expect(defaultInit.initialSignature.length).toBe(16);
    expect(defaultInit.timestamp.length).toBeGreaterThan(0);
    expect(defaultInit.ingestedCapsules.length).toBeGreaterThan(0);
    expect(defaultInit.semanticMemory.tier1BedrockInvariants.length).toBe(4);
    expect(defaultInit.semanticMemory.tier2ActiveWorkingMemory.length).toBeGreaterThan(0);

    registerActiveEngine("telemetry-epoch-aggregator");
    expect(getRegisteredEngines()).toContain("telemetry-epoch-aggregator");
    unregisterActiveEngine("telemetry-epoch-aggregator");
    expect(getRegisteredEngines()).not.toContain("telemetry-epoch-aggregator");

    const customInit = runAutonomousInitialization({
      activeCapsules: ["capsule-mind-gen-2", "capsule-mind-gen-3"],
      extraEngines: ["resource-governor", "socratic-sparring"],
      initialWorkingMemory: ["task-1.1-active"],
      initialArchivedEpics: [
        {
          id: "epic-archive-01",
          content: "Initial blueprint architecture",
          epistemicStatus: "active",
          timestamp: "2026-09-01T00:00:00.000Z",
        },
      ],
    });

    expect(customInit.ingestedCapsules).toEqual(["capsule-mind-gen-2", "capsule-mind-gen-3"]);
    expect(customInit.activeEngines).toContain("resource-governor");
    expect(customInit.activeEngines).toContain("socratic-sparring");
    expect(customInit.semanticMemory.tier2ActiveWorkingMemory).toContain("task-1.1-active");
    expect(customInit.semanticMemory.tier2ActiveWorkingMemory).toContain(
      "ingested:capsule-mind-gen-2",
    );
    expect(customInit.semanticMemory.tier3ArchivedEpics.length).toBe(1);
  });
});
