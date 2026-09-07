import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  HarnessError,
  TemporalKeyframeStepSampler,
  resetDefaultMotionVerificationEngine,
  type KeyframeSamplePoint,
} from "../fixtures.ts";

describe("Motion Verification - Headless Pre-flight & Keyframe Sampler", () => {
  beforeEach(() => {
    resetDefaultMotionVerificationEngine();
  });

  afterEach(() => {
    resetDefaultMotionVerificationEngine();
  });

  describe("Phase 2: Temporal Keyframe Step-Sampling", () => {
    it("samples 0% inception, 50% midpoint, and 100% resting states cleanly", () => {
      const sampler = new TemporalKeyframeStepSampler();
      const samples: KeyframeSamplePoint[] = [
        { point: "0%", timestampMs: 0, value: 0 },
        { point: "50%", timestampMs: 150, value: 0.5 },
        { point: "100%", timestampMs: 300, value: 1.0 },
      ];

      const res = sampler.sampleAndAnalyze({
        animationName: "fade-in",
        durationMs: 300,
        samples,
        easingType: "ease-out",
      });

      expect(res.passed).toBe(true);
      expect(res.sampledInception0).toBe(true);
      expect(res.sampledMidpoint50).toBe(true);
      expect(res.sampledFinal100).toBe(true);
      expect(res.easingCurveValid).toBe(true);
      expect(res.bounceOvershootDetected).toBe(false);
    });

    it("detects missing keyframe checkpoints, overshoot anomalies, and blur artifacts", () => {
      const sampler = new TemporalKeyframeStepSampler();
      const samples: KeyframeSamplePoint[] = [
        { point: "0%", timestampMs: 0, value: 0 },
        { point: "50%", timestampMs: 150, value: 1.4, blurDetected: true },
      ];

      const res = sampler.sampleAndAnalyze({
        animationName: "bad-dialog-pop",
        durationMs: 300,
        samples,
        easingType: "linear",
      });

      expect(res.passed).toBe(false);
      expect(res.sampledFinal100).toBe(false);
      expect(res.bounceOvershootDetected).toBe(true);
      expect(res.blurArtifactDetected).toBe(true);
      expect(res.violations.length).toBeGreaterThanOrEqual(3);
    });

    it("throws HarnessError on invalid keyframe inspection inputs", () => {
      const sampler = new TemporalKeyframeStepSampler();
      expect(() =>
        sampler.sampleAndAnalyze(
          null as unknown as Parameters<TemporalKeyframeStepSampler["sampleAndAnalyze"]>[0],
        ),
      ).toThrow(HarnessError);
    });
  });
});
