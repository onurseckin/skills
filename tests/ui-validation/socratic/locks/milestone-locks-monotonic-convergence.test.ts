import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  HarnessError,
  MilestoneLockEngine,
  resetDefaultMilestoneLockEngine,
  resetDefaultSocraticDialecticEngine,
  SocraticDialecticEngine,
} from "../../fixtures.ts";

describe("Milestone Locks - Monotonic Convergence Law", () => {
  beforeEach(() => {
    resetDefaultMilestoneLockEngine();
    resetDefaultSocraticDialecticEngine();
  });

  afterEach(() => {
    resetDefaultMilestoneLockEngine();
    resetDefaultSocraticDialecticEngine();
  });

  describe("8. Monotonic Convergence Law", () => {
    it("should prohibit out-of-order milestone sealing", () => {
      const lockEngine = new MilestoneLockEngine("session-monotonic");

      expect(() =>
        lockEngine.sealMilestone({
          sessionId: "session-monotonic",
          roundNumber: 2,
          roundName: "Typography",
          statePayload: { font: "Inter" },
          challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
        }),
      ).toThrow(HarnessError);

      lockEngine.sealMilestone({
        sessionId: "session-monotonic",
        roundNumber: 1,
        roundName: "Macro-Layout",
        statePayload: { grid: 12 },
        challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
      });

      expect(() =>
        lockEngine.sealMilestone({
          sessionId: "session-monotonic",
          roundNumber: 3,
          roundName: "Color",
          statePayload: { color: "blue" },
          challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
        }),
      ).toThrow(HarnessError);
    });

    it("should throw when trying to advance past Round 5", () => {
      const engine = new SocraticDialecticEngine({ sessionId: "session-r5" });

      for (let r = 1; r <= 4; r++) {
        const c1 = engine.raiseChallenge({
          category: `c1-r${r}`,
          thesis: `Thesis 1 for Round ${r}`,
        });
        const c2 = engine.raiseChallenge({
          category: `c2-r${r}`,
          thesis: `Thesis 2 for Round ${r}`,
        });
        engine.submitDefense({
          challengeId: c1.challengeId,
          rationale: `Substantive justification for round ${r} challenge 1 adherence.`,
          evidenceReferences: [`ref:r${r}-1`],
        });
        engine.submitDefense({
          challengeId: c2.challengeId,
          rationale: `Substantive justification for round ${r} challenge 2 adherence.`,
          evidenceReferences: [`ref:r${r}-2`],
        });
        engine.advanceRound({ skipRegressionAudit: true });
      }

      expect(engine.getCurrentRoundNumber()).toBe(5);

      const finalAdvance = engine.advanceRound({ skipRegressionAudit: true });
      expect(finalAdvance.isFinalRoundCompleted).toBe(true);
      expect(finalAdvance.sessionCompleted).toBe(true);
      expect(engine.isComplete()).toBe(true);

      expect(() => engine.advanceRound()).toThrow(HarnessError);
    });
  });
});
