import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  HarnessError,
  SPRING_PRESETS,
  MicrocraftInspector,
  MotionVerificationEngine,
  getDefaultMotionVerificationEngine,
  setDefaultMotionVerificationEngine,
  resetDefaultMotionVerificationEngine,
} from "../fixtures.ts";

describe("Motion Verification - Microcraft & Physics Inspection", () => {
  beforeEach(() => {
    resetDefaultMotionVerificationEngine();
  });

  afterEach(() => {
    resetDefaultMotionVerificationEngine();
  });

  describe("Microcraft & Tactile Feedback Inspection", () => {
    it("inspects spring physics presets and enforces cockpit zero-overshoot constraint", () => {
      const inspector = new MicrocraftInspector();
      expect(SPRING_PRESETS.COCKPIT.name).toBe("cockpit");
      expect(SPRING_PRESETS.GENTLE.stiffness).toBe(120);

      const cockpitSmoothSamples = [
        { timeMs: 0, value: 0 },
        { timeMs: 50, value: 0.5 },
        { timeMs: 100, value: 0.8 },
        { timeMs: 150, value: 0.95 },
        { timeMs: 200, value: 1.0 },
      ];

      const cockpitPass = inspector.inspectSpringPhysics({
        presetName: "cockpit",
        trajectorySamples: cockpitSmoothSamples,
        targetValue: 1.0,
      });
      expect(cockpitPass.passed).toBe(true);
      expect(cockpitPass.maxOvershoot).toBe(0);

      const cockpitOvershootSamples = [
        { timeMs: 0, value: 0 },
        { timeMs: 80, value: 1.2 },
        { timeMs: 150, value: 0.95 },
        { timeMs: 200, value: 1.0 },
      ];

      const cockpitFail = inspector.inspectSpringPhysics({
        presetName: "cockpit",
        trajectorySamples: cockpitOvershootSamples,
        targetValue: 1.0,
      });
      expect(cockpitFail.passed).toBe(false);
      expect(
        cockpitFail.violations.some((v) =>
          v.includes("Cockpit spring preset mandates zero overshoot"),
        ),
      ).toBe(true);
    });

    it("throws HarnessError on invalid microcraft inputs", () => {
      const inspector = new MicrocraftInspector();
      expect(() =>
        inspector.inspectSpringPhysics(
          null as unknown as Parameters<MicrocraftInspector["inspectSpringPhysics"]>[0],
        ),
      ).toThrow(HarnessError);
    });
  });

  describe("MotionVerificationEngine Singleton", () => {
    it("manages singleton instance getters, setters, and resetters", () => {
      const engine1 = getDefaultMotionVerificationEngine();
      const engine2 = getDefaultMotionVerificationEngine();
      expect(engine1).toBe(engine2);

      const custom = new MotionVerificationEngine();
      setDefaultMotionVerificationEngine(custom);
      expect(getDefaultMotionVerificationEngine()).toBe(custom);

      resetDefaultMotionVerificationEngine();
      const fresh = getDefaultMotionVerificationEngine();
      expect(fresh).not.toBe(custom);
    });
  });
});
