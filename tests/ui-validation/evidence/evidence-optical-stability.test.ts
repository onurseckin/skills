import { describe, expect, it, HarnessError, OpticalStabilityBarrier } from "../fixtures.ts";

describe("Evidence Lifecycle - Artifact Keys & Stability Barrier", () => {
  describe("Optical Stability Barrier", () => {
    it("evaluates 3-factor optical stability barrier and issues readiness tokens", () => {
      const barrier = new OpticalStabilityBarrier(500);
      const keyString = "dashboard_r1_overview_default_1440x900";

      const stableInput = {
        inFlightRequests: 0,
        networkQuiescenceDurationMs: 600,
        fontsReady: true,
        unrenderedAssetCount: 0,
        activeAnimationsCount: 0,
        layoutShiftDelta: 0.0001,
      };

      const stableRes = barrier.evaluateStability(keyString, stableInput);
      expect(stableRes.stable).toBe(true);
      expect(stableRes.readinessScore).toBe(1.0);
      expect(stableRes.readinessToken).toBeDefined();
      expect(stableRes.failureReasons.length).toBe(0);

      expect(barrier.verifyReadinessToken(stableRes.readinessToken!, keyString)).toBe(true);
      expect(barrier.verifyReadinessToken("ost_invalid_token", keyString)).toBe(false);
      expect(barrier.verifyReadinessToken(stableRes.readinessToken!, "different_key")).toBe(false);
    });

    it("rejects unstable state with multiple factor violations", () => {
      const barrier = new OpticalStabilityBarrier(500);
      const keyString = "modal_r1_dialog_open_768x1024";

      const unstableInput = {
        inFlightRequests: 3,
        networkQuiescenceDurationMs: 100,
        fontsReady: false,
        unrenderedAssetCount: 2,
        activeAnimationsCount: 1,
        layoutShiftDelta: 0.02,
      };

      const unstableRes = barrier.evaluateStability(keyString, unstableInput);
      expect(unstableRes.stable).toBe(false);
      expect(unstableRes.readinessToken).toBeUndefined();
      expect(unstableRes.readinessScore).toBeLessThan(0.5);
      expect(unstableRes.failureReasons.length).toBeGreaterThanOrEqual(4);
    });

    it("throws HarnessError on invalid optical barrier inputs", () => {
      const barrier = new OpticalStabilityBarrier();
      expect(() =>
        barrier.evaluateStability(
          "key",
          null as unknown as Parameters<OpticalStabilityBarrier["evaluateStability"]>[1],
        ),
      ).toThrow(HarnessError);
    });
  });
});
