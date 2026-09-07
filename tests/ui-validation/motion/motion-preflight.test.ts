import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  HarnessError,
  TARGET_FRAME_RATE,
  TARGET_FRAME_DURATION_MS,
  MAX_PERMISSIBLE_JANK_RATE,
  MAX_PERMISSIBLE_CLS,
  GPU_ACCELERATED_PROPERTIES,
  LAYOUT_TRIGGERING_PROPERTIES,
  HeadlessMotionPreFlightAuditor,
  resetDefaultMotionVerificationEngine,
  type MotionHeadlessPreFlightInput,
} from "../fixtures.ts";

describe("Motion Verification - Headless Pre-flight & Keyframe Sampler", () => {
  beforeEach(() => {
    resetDefaultMotionVerificationEngine();
  });

  afterEach(() => {
    resetDefaultMotionVerificationEngine();
  });

  describe("Phase 1: Quantitative Motion Headless Pre-flight", () => {
    it("verifies frame rate constants and property classifications", () => {
      expect(TARGET_FRAME_RATE).toBe(60);
      expect(TARGET_FRAME_DURATION_MS).toBeCloseTo(16.67, 1);
      expect(MAX_PERMISSIBLE_JANK_RATE).toBe(0.05);
      expect(MAX_PERMISSIBLE_CLS).toBe(0.01);

      expect(GPU_ACCELERATED_PROPERTIES).toContain("transform");
      expect(GPU_ACCELERATED_PROPERTIES).toContain("opacity");
      expect(LAYOUT_TRIGGERING_PROPERTIES).toContain("width");
      expect(LAYOUT_TRIGGERING_PROPERTIES).toContain("height");
      expect(LAYOUT_TRIGGERING_PROPERTIES).toContain("top");
    });

    it("audits animated properties for GPU acceleration vs layout triggers", () => {
      const auditor = new HeadlessMotionPreFlightAuditor();
      const audits = auditor.auditProperties(["transform", "opacity", "width", "top"]);

      expect(audits[0].isGpuAccelerated).toBe(true);
      expect(audits[0].isLayoutTriggering).toBe(false);

      expect(audits[1].isGpuAccelerated).toBe(true);
      expect(audits[1].isLayoutTriggering).toBe(false);

      expect(audits[2].isGpuAccelerated).toBe(false);
      expect(audits[2].isLayoutTriggering).toBe(true);
      expect(audits[2].recommendation).toContain("Refactor to 'transform'");

      expect(audits[3].isLayoutTriggering).toBe(true);
    });

    it("calculates jank rate metrics correctly", () => {
      const auditor = new HeadlessMotionPreFlightAuditor();
      const smoothFrames = Array.from({ length: 60 }, (_, i) => ({
        timestampMs: i * 16.6,
        durationMs: 16.6,
      }));

      const smoothRes = auditor.calculateJankRate(smoothFrames);
      expect(smoothRes.totalFrames).toBe(60);
      expect(smoothRes.jankFrames).toBe(0);
      expect(smoothRes.jankRate).toBe(0);

      const jankyFrames = [
        ...smoothFrames.slice(0, 50),
        ...Array.from({ length: 10 }, (_, i) => ({
          timestampMs: 50 * 16.6 + i * 25,
          durationMs: 25.0,
        })),
      ];

      const jankyRes = auditor.calculateJankRate(jankyFrames);
      expect(jankyRes.jankFrames).toBe(10);
      expect(jankyRes.jankRate).toBeCloseTo(10 / 60, 2);
    });

    it("audits pre-flight animation cleanly when meeting 60fps and GPU acceleration", () => {
      const auditor = new HeadlessMotionPreFlightAuditor();
      const input: MotionHeadlessPreFlightInput = {
        animationName: "sidebar-slide",
        targetSelector: ".sidebar",
        animatedProperties: ["transform", "opacity"],
        frameSamples: Array.from({ length: 30 }, (_, i) => ({
          timestampMs: i * 16.6,
          durationMs: 16.6,
        })),
        layoutShifts: [{ shiftScore: 0.0005 }],
      };

      const result = auditor.auditAnimation(input);
      expect(result.passed).toBe(true);
      expect(result.jankRate).toBe(0);
      expect(result.cumulativeLayoutShift).toBe(0.0005);
      expect(result.violations.length).toBe(0);
    });

    it("rejects animation failing pre-flight with layout triggering properties and high jank", () => {
      const auditor = new HeadlessMotionPreFlightAuditor();
      const input: MotionHeadlessPreFlightInput = {
        animationName: "accordion-expand",
        targetSelector: ".accordion-body",
        animatedProperties: ["height", "margin-top"],
        frameSamples: Array.from({ length: 20 }, (_, i) => ({
          timestampMs: i * 25,
          durationMs: 25,
        })),
        layoutShifts: [{ shiftScore: 0.05 }],
      };

      const result = auditor.auditAnimation(input);
      expect(result.passed).toBe(false);
      expect(result.layoutTriggeringViolations.length).toBe(2);
      expect(result.violations.some((v) => v.includes("Jank rate"))).toBe(true);
      expect(result.violations.some((v) => v.includes("Cumulative Layout Shift"))).toBe(true);
    });

    it("throws HarnessError on invalid pre-flight inputs", () => {
      const auditor = new HeadlessMotionPreFlightAuditor();
      expect(() => auditor.auditProperties(null as unknown as string[])).toThrow(HarnessError);
      expect(() => auditor.auditAnimation(null as unknown as MotionHeadlessPreFlightInput)).toThrow(
        HarnessError,
      );
    });
  });
});
