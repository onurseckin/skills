import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  HarnessError,
  MicrocraftInspector,
  resetDefaultMotionVerificationEngine,
  type FocusRingMetrics,
  type HoverLiftMetrics,
} from "../fixtures.ts";

describe("Motion Verification - Microcraft & Physics Inspection", () => {
  beforeEach(() => {
    resetDefaultMotionVerificationEngine();
  });

  afterEach(() => {
    resetDefaultMotionVerificationEngine();
  });

  describe("Microcraft & Tactile Feedback Inspection", () => {
    it("inspects focus rings for width, offset, contrast, and crispness", () => {
      const inspector = new MicrocraftInspector();
      const validRing: FocusRingMetrics = {
        selector: "button.primary",
        outlineWidthPx: 2,
        outlineStyle: "solid",
        outlineColor: "#3b82f6",
        outlineOffsetPx: 2,
        contrastRatioWithBackground: 4.5,
        isCrisp: true,
      };

      const passRes = inspector.inspectFocusRing(validRing);
      expect(passRes.passed).toBe(true);
      expect(passRes.violations.length).toBe(0);

      const badRing: FocusRingMetrics = {
        selector: "button.subtle",
        outlineWidthPx: 1,
        outlineStyle: "none",
        outlineColor: "#ccc",
        outlineOffsetPx: 0,
        contrastRatioWithBackground: 1.5,
        isCrisp: false,
      };

      const failRes = inspector.inspectFocusRing(badRing);
      expect(failRes.passed).toBe(false);
      expect(failRes.violations.length).toBe(5);
    });

    it("inspects hover lift tactile feedback (translateY and shadow depth)", () => {
      const inspector = new MicrocraftInspector();
      const validHover: HoverLiftMetrics = {
        selector: ".card-interactive",
        defaultTransform: "translateY(0px)",
        hoverTransform: "translateY(-2px)",
        defaultBoxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        hoverBoxShadow: "0 4px 6px rgba(0,0,0,0.15)",
        translateYPx: -2,
        shadowDepthChange: 3,
      };

      const passRes = inspector.inspectHoverLift(validHover);
      expect(passRes.passed).toBe(true);

      const badHover: HoverLiftMetrics = {
        selector: ".card-flat",
        defaultTransform: "translateY(0px)",
        hoverTransform: "translateY(5px)",
        defaultBoxShadow: "none",
        hoverBoxShadow: "none",
        translateYPx: 5,
        shadowDepthChange: 0,
      };

      const failRes = inspector.inspectHoverLift(badHover);
      expect(failRes.passed).toBe(false);
      expect(failRes.violations.length).toBe(2);
    });

    it("detects motion jitter and direction reversals", () => {
      const inspector = new MicrocraftInspector();
      const smoothSamples = [
        { timeMs: 0, value: 0 },
        { timeMs: 50, value: 0.2 },
        { timeMs: 100, value: 0.6 },
        { timeMs: 150, value: 0.9 },
        { timeMs: 200, value: 1.0 },
      ];
      expect(inspector.detectMotionJitter(smoothSamples).hasJitter).toBe(false);

      const noisySamples = [
        { timeMs: 0, value: 0 },
        { timeMs: 20, value: 0.4 },
        { timeMs: 40, value: 0.2 },
        { timeMs: 60, value: 0.6 },
        { timeMs: 80, value: 0.4 },
        { timeMs: 100, value: 0.8 },
        { timeMs: 120, value: 0.6 },
        { timeMs: 140, value: 1.0 },
      ];
      expect(inspector.detectMotionJitter(noisySamples).hasJitter).toBe(true);
    });

    it("throws HarnessError on invalid microcraft inputs", () => {
      const inspector = new MicrocraftInspector();
      expect(() => inspector.inspectFocusRing(null as unknown as FocusRingMetrics)).toThrow(
        HarnessError,
      );
      expect(() => inspector.inspectHoverLift(null as unknown as HoverLiftMetrics)).toThrow(
        HarnessError,
      );
      expect(() =>
        inspector.inspectSpringPhysics(
          null as unknown as Parameters<MicrocraftInspector["inspectSpringPhysics"]>[0],
        ),
      ).toThrow(HarnessError);
    });
  });
});
