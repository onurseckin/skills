import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  computeSha256,
  type EmpiricalRegressionProof,
  HarnessError,
  MilestoneLockEngine,
  resetDefaultMilestoneLockEngine,
} from "../../fixtures.ts";

describe("Milestone Locks - Anti-Moving-Goalpost Invariant Enforcement", () => {
  beforeEach(() => {
    resetDefaultMilestoneLockEngine();
  });

  afterEach(() => {
    resetDefaultMilestoneLockEngine();
  });

  describe("7. Anti-Moving-Goalpost Invariant Enforcement", () => {
    it("should throw when trying to mutate sealed upstream scopes in later rounds without an unlock token", () => {
      const lockEngine = new MilestoneLockEngine("session-moving-goalpost");

      lockEngine.sealMilestone({
        sessionId: "session-moving-goalpost",
        roundNumber: 1,
        roundName: "Macro-Layout",
        statePayload: { grid: 12 },
        challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
      });

      expect(() =>
        lockEngine.assertScopeMutable({
          scope: "layout.grid",
          currentRound: 2,
        }),
      ).toThrow(HarnessError);

      expect(() =>
        lockEngine.assertScopeMutable({
          scope: "layout.landmarks",
          currentRound: 3,
        }),
      ).toThrow(HarnessError);

      expect(() =>
        lockEngine.assertScopeMutable({
          scope: "typography.scale",
          currentRound: 2,
        }),
      ).not.toThrow();
    });

    it("should allow mutation of sealed scope when a valid, active Optical Regression token is provided", () => {
      const lockEngine = new MilestoneLockEngine("session-token-assert");

      lockEngine.sealMilestone({
        sessionId: "session-token-assert",
        roundNumber: 1,
        roundName: "Macro-Layout",
        statePayload: { grid: 12 },
        challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
      });

      const proof: EmpiricalRegressionProof = {
        proofId: "proof-opt-001",
        sessionId: "session-token-assert",
        targetSealedRound: 1,
        currentActiveRound: 3,
        affectedScope: "layout.grid",
        rootCauseAnalysis:
          "High DPI rendering causes subpixel rounding error resulting in 1px gutter overflow in 3-column layout.",
        opticalDeltaMetric: 0.042,
        evidenceArtifactHash: computeSha256("artifact:diff-gutter-overflow"),
        proposedRemediation:
          "Recalibrate CSS grid fractions to use subpixel calc(100% / 3 - 16px) instead of raw 33.333%.",
      };

      const token = lockEngine.requestOpticalRegressionUnlock(proof);

      expect(() =>
        lockEngine.assertScopeMutable({
          scope: "layout.grid",
          currentRound: 3,
          token,
        }),
      ).not.toThrow();

      expect(() =>
        lockEngine.assertScopeMutable({
          scope: "layout.landmarks",
          currentRound: 3,
          token,
        }),
      ).toThrow(HarnessError);
    });
  });
});
