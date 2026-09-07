import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  computeSha256,
  type EmpiricalRegressionProof,
  HarnessError,
  MilestoneLockEngine,
  resetDefaultMilestoneLockEngine,
  resetDefaultSocraticDialecticEngine,
} from "../../fixtures.ts";

describe("Milestone Locks - Optical Regression Exception Protocol", () => {
  beforeEach(() => {
    resetDefaultMilestoneLockEngine();
    resetDefaultSocraticDialecticEngine();
  });

  afterEach(() => {
    resetDefaultMilestoneLockEngine();
    resetDefaultSocraticDialecticEngine();
  });

  describe("9. Optical Regression Exception Protocol", () => {
    it("should reject non-empirical or weak regression proofs", () => {
      const lockEngine = new MilestoneLockEngine("session-proof-val");

      lockEngine.sealMilestone({
        sessionId: "session-proof-val",
        roundNumber: 1,
        roundName: "Macro-Layout",
        statePayload: { grid: 12 },
        challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
      });

      expect(() =>
        lockEngine.requestOpticalRegressionUnlock({
          proofId: "",
          sessionId: "session-proof-val",
          targetSealedRound: 1,
          currentActiveRound: 2,
          affectedScope: "layout.grid",
          rootCauseAnalysis: "Valid length root cause analysis here for testing purposes.",
          opticalDeltaMetric: 0.05,
          evidenceArtifactHash: computeSha256("artifact"),
          proposedRemediation: "Remediate grid properly",
        }),
      ).toThrow(HarnessError);

      expect(() =>
        lockEngine.requestOpticalRegressionUnlock({
          proofId: "p1",
          sessionId: "session-proof-val",
          targetSealedRound: 2,
          currentActiveRound: 2,
          affectedScope: "layout.grid",
          rootCauseAnalysis: "Valid length root cause analysis here for testing purposes.",
          opticalDeltaMetric: 0.05,
          evidenceArtifactHash: computeSha256("artifact"),
          proposedRemediation: "Remediate grid properly",
        }),
      ).toThrow(HarnessError);

      expect(() =>
        lockEngine.requestOpticalRegressionUnlock({
          proofId: "p2",
          sessionId: "session-proof-val",
          targetSealedRound: 1,
          currentActiveRound: 2,
          affectedScope: "layout.grid",
          rootCauseAnalysis: "Short bug",
          opticalDeltaMetric: 0.05,
          evidenceArtifactHash: computeSha256("artifact"),
          proposedRemediation: "Remediate grid properly",
        }),
      ).toThrow(HarnessError);

      expect(() =>
        lockEngine.requestOpticalRegressionUnlock({
          proofId: "p3",
          sessionId: "session-proof-val",
          targetSealedRound: 1,
          currentActiveRound: 2,
          affectedScope: "layout.grid",
          rootCauseAnalysis: "Valid length root cause analysis here for testing purposes.",
          opticalDeltaMetric: 0,
          evidenceArtifactHash: computeSha256("artifact"),
          proposedRemediation: "Remediate grid properly",
        }),
      ).toThrow(HarnessError);
    });

    it("should execute full unlock, remediation, and resealing lifecycle", () => {
      const lockEngine = new MilestoneLockEngine("session-opt-lifecycle");

      lockEngine.sealMilestone({
        sessionId: "session-opt-lifecycle",
        roundNumber: 1,
        roundName: "Macro-Layout",
        statePayload: { "layout.grid.columns": 12 },
        challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
      });

      const proof: EmpiricalRegressionProof = {
        proofId: "proof-007",
        sessionId: "session-opt-lifecycle",
        targetSealedRound: 1,
        currentActiveRound: 3,
        affectedScope: "layout.grid",
        rootCauseAnalysis:
          "Subpixel container jitter observed under 125% OS display scaling on Windows Chrome.",
        opticalDeltaMetric: 0.083,
        evidenceArtifactHash: computeSha256("screenshot:jitter-diff"),
        proposedRemediation: "Apply transform: translateZ(0) to force integer pixel rasterization.",
      };

      const token = lockEngine.requestOpticalRegressionUnlock(proof, { compensationCredit: 2 });
      expect(token.targetRound).toBe(1);
      expect(token.compensationCredit).toBe(2);
      expect(token.isConsumed).toBe(false);

      const unlockedManifest = lockEngine.getManifest(1);
      expect(unlockedManifest?.lockStatus).toBe("TEMPORARILY_UNLOCKED");

      const remediatedPayload = {
        "layout.grid.columns": 12,
        "layout.grid.rasterization": "translateZ(0)",
      };

      const resealedManifest = lockEngine.resealMilestone(1, remediatedPayload, token);
      expect(resealedManifest.lockStatus).toBe("RESEALED");
      expect(resealedManifest.unlockHistory).toHaveLength(1);
      expect(resealedManifest.unlockHistory[0].tokenId).toBe(token.tokenId);
      expect(resealedManifest.statePayloadHash).toBe(computeSha256(remediatedPayload));

      expect(() =>
        lockEngine.assertScopeMutable({
          scope: "layout.grid",
          currentRound: 3,
          token,
        }),
      ).toThrow(HarnessError);
    });

    it("should reject expired unlock tokens", () => {
      const lockEngine = new MilestoneLockEngine("session-expire-test");

      lockEngine.sealMilestone({
        sessionId: "session-expire-test",
        roundNumber: 1,
        roundName: "Macro-Layout",
        statePayload: { grid: 12 },
        challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
      });

      const proof: EmpiricalRegressionProof = {
        proofId: "proof-exp",
        sessionId: "session-expire-test",
        targetSealedRound: 1,
        currentActiveRound: 2,
        affectedScope: "layout.grid",
        rootCauseAnalysis: "Valid root cause analysis string that is sufficiently descriptive.",
        opticalDeltaMetric: 0.05,
        evidenceArtifactHash: computeSha256("artifact"),
        proposedRemediation: "Remediate grid properly",
      };

      const token = lockEngine.requestOpticalRegressionUnlock(proof, { expirationMs: -1000 });

      expect(() => lockEngine.validateUnlockToken(token, 1, "layout.grid")).toThrow(HarnessError);
    });
  });
});
