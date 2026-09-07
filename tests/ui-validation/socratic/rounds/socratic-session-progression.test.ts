import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  HarnessError,
  resetDefaultSocraticDialecticEngine,
  SocraticDialecticEngine,
} from "../../fixtures.ts";

describe("Socratic Dialectic - Session Progression", () => {
  beforeEach(() => {
    resetDefaultSocraticDialecticEngine();
  });

  afterEach(() => {
    resetDefaultSocraticDialecticEngine();
  });

  describe("3. Socratic Dialectic Session Progression & Gate Verification", () => {
    it("should enforce mandatory quota of 2 defended challenges before unlocking Round 1 gate", () => {
      const engine = new SocraticDialecticEngine({ sessionId: "test-session-001" });
      expect(engine.getCurrentRoundNumber()).toBe(1);

      const readiness0 = engine.evaluateRoundReadiness();
      expect(readiness0.isGateUnlocked).toBe(false);
      expect(readiness0.quotaMet).toBe(false);

      expect(() => engine.advanceRound()).toThrow(HarnessError);

      const chall1 = engine.raiseChallenge({
        category: "spatial-hierarchy",
        thesis:
          "Is the macro-layout grid properly responsive across mobile and desktop breakpoints?",
      });
      engine.submitDefense({
        challengeId: chall1.challengeId,
        rationale:
          "The macro-layout employs fluid CSS grid with media query breakpoints at 640px, 1024px, and 1440px.",
        evidenceReferences: ["token:spacing.grid.columns", "artifact:responsive-prober-diff"],
      });

      const readiness1 = engine.evaluateRoundReadiness();
      expect(readiness1.isGateUnlocked).toBe(false);
      expect(readiness1.quotaMet).toBe(false);
      expect(() => engine.advanceRound()).toThrow(HarnessError);

      const chall2 = engine.raiseChallenge({
        category: "structural-landmarks",
        thesis:
          "Are semantic HTML landmarks (<main>, <nav>, <aside>) properly anchored in the DOM tree?",
      });

      const readiness2 = engine.evaluateRoundReadiness();
      expect(readiness2.isGateUnlocked).toBe(false);
      expect(readiness2.pendingChallengesCount).toBe(1);

      engine.submitDefense({
        challengeId: chall2.challengeId,
        rationale:
          "All top-level layout regions map directly to ARIA landmarks with unique accessible role descriptions.",
        evidenceReferences: ["dom:landmark-audit-log"],
      });

      const readiness3 = engine.evaluateRoundReadiness();
      expect(readiness3.isGateUnlocked).toBe(true);
      expect(readiness3.quotaMet).toBe(true);
      expect(readiness3.allChallengesResolved).toBe(true);

      const advanceResult = engine.advanceRound();
      expect(advanceResult.previousRound).toBe(1);
      expect(advanceResult.currentRound).toBe(2);
      expect(engine.getCurrentRoundNumber()).toBe(2);
      expect(advanceResult.manifest.roundNumber).toBe(1);
      expect(advanceResult.manifest.lockStatus).toBe("SEALED");
    });

    it("should throw when raising challenge with empty thesis or category", () => {
      const engine = new SocraticDialecticEngine();
      expect(() =>
        engine.raiseChallenge({ category: "", thesis: "Valid thesis statement goes here" }),
      ).toThrow(HarnessError);
      expect(() => engine.raiseChallenge({ category: "valid-cat", thesis: "" })).toThrow(
        HarnessError,
      );
    });

    it("should throw when submitting defense for non-existent challenge or already defended challenge", () => {
      const engine = new SocraticDialecticEngine();
      expect(() =>
        engine.submitDefense({
          challengeId: "non-existent-id",
          rationale: "Valid rationale that is long enough to satisfy substantive criteria.",
          evidenceReferences: ["ref-1"],
        }),
      ).toThrow(HarnessError);

      const chall = engine.raiseChallenge({ category: "cat", thesis: "Thesis statement" });
      engine.submitDefense({
        challengeId: chall.challengeId,
        rationale: "Valid rationale that is long enough to satisfy substantive criteria.",
        evidenceReferences: ["ref-1"],
      });

      expect(() =>
        engine.submitDefense({
          challengeId: chall.challengeId,
          rationale: "Another rationale trying to overwrite defended status.",
          evidenceReferences: ["ref-2"],
        }),
      ).toThrow(HarnessError);
    });
  });
});
