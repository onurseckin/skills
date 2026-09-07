import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDefaultSocraticDialecticEngine, SocraticDialecticEngine } from "../../fixtures.ts";

describe("Socratic Dialectic - Inter-Round Regression Auditing Clean State", () => {
  beforeEach(() => {
    resetDefaultSocraticDialecticEngine();
  });

  afterEach(() => {
    resetDefaultSocraticDialecticEngine();
  });

  describe("5. Inter-Round Visual Regression Auditing - Pristine State", () => {
    it("should pass inter-round regression audit when sealed upstream properties remain unperturbed", () => {
      const engine = new SocraticDialecticEngine();

      const c1 = engine.raiseChallenge({ category: "c1", thesis: "Layout grid" });
      const c2 = engine.raiseChallenge({ category: "c2", thesis: "Containers" });
      engine.submitDefense({
        challengeId: c1.challengeId,
        rationale: "12-col grid verified against canonical responsive scale.",
        evidenceReferences: ["grid:12"],
      });
      engine.submitDefense({
        challengeId: c2.challengeId,
        rationale: "Container constraints applied correctly across viewports.",
        evidenceReferences: ["container:1280"],
      });

      const round1Payload = {
        "layout.grid.columns": 12,
        "layout.containers.maxWidth": 1280,
      };
      engine.advanceRound({ statePayload: round1Payload });

      const cleanRound2Payload = {
        "layout.grid.columns": 12,
        "layout.containers.maxWidth": 1280,
        "typography.scale.h1": 36,
      };

      const auditResult = engine.auditInterRoundState(cleanRound2Payload);
      expect(auditResult.hasRegressions).toBe(false);
      expect(auditResult.collateralDefects).toHaveLength(0);
      expect(auditResult.regressionScore).toBe(0);
    });
  });
});
