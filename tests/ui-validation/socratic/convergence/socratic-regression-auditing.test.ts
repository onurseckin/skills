import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  HarnessError,
  resetDefaultSocraticDialecticEngine,
  SocraticDialecticEngine,
} from "../../fixtures.ts";

describe("Socratic Dialectic - Inter-Round Regression Auditing", () => {
  beforeEach(() => {
    resetDefaultSocraticDialecticEngine();
  });

  afterEach(() => {
    resetDefaultSocraticDialecticEngine();
  });

  describe("5. Inter-Round Visual Regression Auditing", () => {
    it("should detect collateral defects when sealed upstream properties are modified in downstream rounds", () => {
      const engine = new SocraticDialecticEngine();

      const c1 = engine.raiseChallenge({ category: "c1", thesis: "Layout grid validation" });
      const c2 = engine.raiseChallenge({ category: "c2", thesis: "Spatial distribution" });
      engine.submitDefense({
        challengeId: c1.challengeId,
        rationale: "12-column grid implemented with 16px gutter spacing.",
        evidenceReferences: ["grid:12-col"],
      });
      engine.submitDefense({
        challengeId: c2.challengeId,
        rationale: "Spatial container margin aligned to canonical spacing token md.",
        evidenceReferences: ["token:spacing.md"],
      });

      const round1Payload = {
        "layout.grid.columns": 12,
        "layout.grid.gutter": 16,
        "layout.containers.maxWidth": 1280,
      };

      engine.advanceRound({ statePayload: round1Payload });
      expect(engine.getCurrentRoundNumber()).toBe(2);

      const round2MutatedPayload = {
        "layout.grid.columns": 8,
        "typography.scale.h1": 36,
        "typography.scale.body": 16,
      };

      const auditResult = engine.auditInterRoundState(round2MutatedPayload);
      expect(auditResult.hasRegressions).toBe(true);
      expect(auditResult.collateralDefects).toHaveLength(1);
      expect(auditResult.collateralDefects[0].propertyKey).toBe("layout.grid.columns");
      expect(auditResult.collateralDefects[0].sealedValue).toBe(12);
      expect(auditResult.collateralDefects[0].currentValue).toBe(8);
      expect(auditResult.violatedMilestoneRounds).toContain(1);

      const c3 = engine.raiseChallenge({ category: "c3", thesis: "Typo 1" });
      const c4 = engine.raiseChallenge({ category: "c4", thesis: "Typo 2" });
      engine.submitDefense({
        challengeId: c3.challengeId,
        rationale: "Typography scale verified with modular ratio 1.25.",
        evidenceReferences: ["font:modular-scale"],
      });
      engine.submitDefense({
        challengeId: c4.challengeId,
        rationale: "Line height proportions verified at 1.5 for body text.",
        evidenceReferences: ["font:line-height"],
      });

      expect(() => engine.advanceRound({ statePayload: round2MutatedPayload })).toThrow(
        HarnessError,
      );
    });
  });
});
