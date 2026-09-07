import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  HarnessError,
  InterRoundRegressionAuditor,
  MilestoneLockEngine,
  resetDefaultMilestoneLockEngine,
  resetDefaultSocraticDialecticEngine,
  SocraticDialecticEngine,
} from "../../fixtures.ts";

describe("Socratic Dialectic - Edge Cases & Nuances", () => {
  beforeEach(() => {
    resetDefaultMilestoneLockEngine();
    resetDefaultSocraticDialecticEngine();
  });

  afterEach(() => {
    resetDefaultMilestoneLockEngine();
    resetDefaultSocraticDialecticEngine();
  });

  describe("12. Edge Cases, Query Filters & Engine Resets", () => {
    it("should validate session ID setting on engines", () => {
      const socraticEngine = new SocraticDialecticEngine();
      expect(socraticEngine.getSessionId()).toBe("socratic-session-001");
      socraticEngine.setSessionId("new-session-id");
      expect(socraticEngine.getSessionId()).toBe("new-session-id");
      expect(socraticEngine.getMilestoneEngine().getSessionId()).toBe("new-session-id");
      expect(() => socraticEngine.setSessionId("")).toThrow(HarnessError);

      const lockEngine = new MilestoneLockEngine("init-session");
      expect(lockEngine.getSessionId()).toBe("init-session");
      lockEngine.setSessionId("updated-session");
      expect(lockEngine.getSessionId()).toBe("updated-session");
      expect(() => lockEngine.setSessionId("   ")).toThrow(HarnessError);
    });

    it("should filter challenges by round number and status", () => {
      const engine = new SocraticDialecticEngine();
      const c1 = engine.raiseChallenge({ roundNumber: 1, category: "cat1", thesis: "Thesis 1" });
      const c2 = engine.raiseChallenge({ roundNumber: 1, category: "cat2", thesis: "Thesis 2" });
      const c3 = engine.raiseChallenge({ roundNumber: 2, category: "cat3", thesis: "Thesis 3" });

      engine.submitDefense({
        challengeId: c1.challengeId,
        rationale: "Valid rationale for defending challenge 1 with evidence.",
        evidenceReferences: ["ref1"],
      });

      expect(engine.getChallenge(c1.challengeId)).toBe(c1);
      expect(engine.getChallenge("unknown-id")).toBeUndefined();

      const r1Challenges = engine.listChallenges({ roundNumber: 1 });
      expect(r1Challenges).toHaveLength(2);

      const r2Challenges = engine.listChallenges({ roundNumber: 2 });
      expect(r2Challenges).toHaveLength(1);

      const defendedChallenges = engine.listChallenges({ status: "DEFENDED" });
      expect(defendedChallenges).toHaveLength(1);
      expect(defendedChallenges[0].challengeId).toBe(c1.challengeId);

      const pendingChallenges = engine.listChallenges({ status: "PENDING" });
      expect(pendingChallenges).toHaveLength(2);
    });

    it("should handle InterRoundRegressionAuditor on empty sealed manifests", () => {
      const auditor = new InterRoundRegressionAuditor();
      const result = auditor.auditStateRegressions(2, { someKey: 1 }, []);
      expect(result.hasRegressions).toBe(false);
      expect(result.collateralDefects).toHaveLength(0);
      expect(result.regressionScore).toBe(0);
    });

    it("should reset SocraticDialecticEngine and MilestoneLockEngine cleanly", () => {
      const engine = new SocraticDialecticEngine();
      engine.raiseChallenge({ category: "cat", thesis: "Thesis" });
      expect(engine.listChallenges()).toHaveLength(1);

      engine.reset();
      expect(engine.listChallenges()).toHaveLength(0);
      expect(engine.getCurrentRoundNumber()).toBe(1);
      expect(engine.isComplete()).toBe(false);

      const lockEngine = new MilestoneLockEngine();
      lockEngine.sealMilestone({
        sessionId: "s",
        roundNumber: 1,
        roundName: "r1",
        statePayload: {},
        challengeSummary: { total: 0, defended: 0, arbitrated: 0 },
      });
      expect(lockEngine.listManifests()).toHaveLength(1);

      lockEngine.reset();
      expect(lockEngine.listManifests()).toHaveLength(0);
      expect(lockEngine.getHighestSealedRound()).toBe(0);
    });
  });
});
