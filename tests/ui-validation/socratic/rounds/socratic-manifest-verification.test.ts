import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MilestoneLockEngine, resetDefaultMilestoneLockEngine } from "../../fixtures.ts";

describe("Socratic Dialectic - Manifest Verification & Custom Scopes", () => {
  beforeEach(() => {
    resetDefaultMilestoneLockEngine();
  });

  afterEach(() => {
    resetDefaultMilestoneLockEngine();
  });

  describe("12. Manifest Verification Nuances & Custom Scopes", () => {
    it("should allow sealing milestones with custom scopes", () => {
      const lockEngine = new MilestoneLockEngine("session-custom-scopes");
      const customScopes = ["custom.component.header", "custom.component.footer"];

      const manifest = lockEngine.sealMilestone({
        sessionId: "session-custom-scopes",
        roundNumber: 1,
        roundName: "Custom Macro",
        statePayload: { header: "present" },
        challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
        customScopes,
      });

      expect(manifest.sealedScope).toEqual(customScopes);
      expect(lockEngine.getManifest(1)?.sealedScope).toEqual(customScopes);
    });

    it("should verify manifest integrity against an external state payload", () => {
      const lockEngine = new MilestoneLockEngine("session-external-verify");
      const originalPayload = { key: "value123", count: 42 };

      const manifest = lockEngine.sealMilestone({
        sessionId: "session-external-verify",
        roundNumber: 1,
        roundName: "Test Round",
        statePayload: originalPayload,
        challengeSummary: { total: 1, defended: 1, arbitrated: 0 },
      });

      const resultMatch = lockEngine.verifyManifestIntegrity(manifest, {
        count: 42,
        key: "value123",
      });
      expect(resultMatch.isValid).toBe(true);
      expect(resultMatch.stateHashMatches).toBe(true);

      const resultMismatch = lockEngine.verifyManifestIntegrity(manifest, {
        count: 99,
        key: "value123",
      });
      expect(resultMismatch.isValid).toBe(false);
      expect(resultMismatch.stateHashMatches).toBe(false);
      expect(resultMismatch.discrepancyReason).toContain("Payload hash mismatch");
    });
  });
});
