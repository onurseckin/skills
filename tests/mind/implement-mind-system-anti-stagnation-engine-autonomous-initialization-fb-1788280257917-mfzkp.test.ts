import { describe, expect, test } from "bun:test";
import {
  computeStagnationSignature,
  evaluateAntiStagnationState,
  runAutonomousInitialization,
  type MindAntiStagnationConfig,
  type StagnationMetrics,
} from "../../olt/scripts/src/mind/implement-mind-system-anti-stagnation-engine-autonomous-initialization-fb-1788280257917-mfzkp.ts";

describe("Mind System Anti-Stagnation Engine & Autonomous Initialization", () => {
  test("computes deterministic stagnation signatures", () => {
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
    const sigA = computeStagnationSignature(metricsA);
    const sigB = computeStagnationSignature(metricsB);
    expect(sigA.length).toBe(16);
    expect(sigA).toBe(sigB);
  });

  test("evaluates active non-stagnant state correctly", () => {
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
  });

  test("executes autonomous initialization with active engines", () => {
    const initResult = runAutonomousInitialization();
    expect(initResult.initialized).toBe(true);
    expect(initResult.activeEngines.length).toBe(3);
    expect(initResult.initialSignature.length).toBe(16);
    expect(initResult.timestamp.length).toBeGreaterThan(0);
  });
});
