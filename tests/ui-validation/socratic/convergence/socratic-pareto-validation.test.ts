import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  HarnessError,
  resetDefaultSocraticDialecticEngine,
  SocraticDialecticEngine,
} from "../../fixtures.ts";

describe("Socratic Dialectic - Pareto Arbitration Input Validation", () => {
  beforeEach(() => {
    resetDefaultSocraticDialecticEngine();
  });

  afterEach(() => {
    resetDefaultSocraticDialecticEngine();
  });

  describe("4. Adversarial Convergence & Pareto Arbitration Escalation - Validation", () => {
    it("should throw error when Pareto arbitration input is invalid", () => {
      const engine = new SocraticDialecticEngine();
      const chall = engine.raiseChallenge({ category: "test", thesis: "Thesis" });

      expect(() =>
        engine.escalateToParetoArbitration({
          challengeId: "wrong-id",
          competingForces: [{ force: "F1", weight: 1 }],
          candidateResolutions: [{ id: "r1", description: "d1", score: 80 }],
        }),
      ).toThrow(HarnessError);

      expect(() =>
        engine.escalateToParetoArbitration({
          challengeId: chall.challengeId,
          competingForces: [],
          candidateResolutions: [{ id: "r1", description: "d1", score: 80 }],
        }),
      ).toThrow(HarnessError);

      expect(() =>
        engine.escalateToParetoArbitration({
          challengeId: chall.challengeId,
          competingForces: [{ force: "F1", weight: 1 }],
          candidateResolutions: [],
        }),
      ).toThrow(HarnessError);
    });
  });
});
