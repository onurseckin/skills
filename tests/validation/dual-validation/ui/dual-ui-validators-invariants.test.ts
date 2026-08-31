import { describe, expect, it } from "bun:test";
import {
  ALL_4_VIEWPORT_TIERS,
  CANONICAL_4_VIEWPORTS,
  DESCENDER_CHARS,
  MIN_SCREENSHOT_BYTES,
  MIN_TOUCH_HITBOX_PT,
  calculateOpticalWeight,
  evaluateAestheticHarmony,
  evaluateDualUiGates,
  evaluateOpticalHierarchy,
  inspectAllOverflowElements,
  inspectAllTouchHitboxes,
  inspectDescenderIntegrity,
  inspectHorizontalOverflow,
  inspectTouchHitbox,
  normalizeWeightMultiplier,
  validateUiCognitive,
  validateUiMechanic,
} from "../../../../olt/scripts/src/validation/ui/index.ts";


describe("Dual UI Validators - Hardened Invariants", () => {
  describe("5. Hardened Invariants (4-Viewport Matrix, Optical Weight, DPR Tolerance, Entropy & Lifecycle)", () => {
    it("enforces strict 4-viewport matrix gate hardlock on missing tiers", () => {
      const report = validateUiMechanic({
        requireAllViewports: true,
        screenshots: [
          { name: "mobile.png", path: "sc/m.png", viewport: "mobile", sizeBytes: 2048 },
          { name: "tablet.png", path: "sc/t.png", viewport: "tablet", sizeBytes: 2048 },
        ],
      });

      expect(report.passed).toBe(false);
      expect(report.missingViewports).toEqual(["desktop", "desktop-wide"]);
      expect(report.totalDefects).toBe(2);

      const dualResult = evaluateDualUiGates({
        isUiTask: true,
        mechanicInput: {
          requireAllViewports: true,
          screenshots: [{ name: "m.png", path: "sc/m.png", viewport: "mobile", sizeBytes: 2048 }],
        },
        cognitiveInput: {
          critique: "Aesthetic hierarchy is balanced.",
          canExecuteShell: false,
        },
      });

      expect(dualResult.passed).toBe(false);
      expect(dualResult.defects.some((d) => d.category === "viewport-matrix")).toBe(true);
    });

    it("evaluates scoped container optical hierarchy and composite weight vector", () => {
      expect(normalizeWeightMultiplier("bold")).toBe(1.25);
      expect(normalizeWeightMultiplier(400)).toBe(1.0);
      expect(normalizeWeightMultiplier(800)).toBe(1.35);

      const opticalWeightH1 = calculateOpticalWeight({
        selector: "h1",
        tag: "h1",
        fontSize: 32,
        fontWeight: "bold",
        letterSpacing: 2,
      });
      expect(opticalWeightH1).toBe(32 * 1.25 + 0.2);

      const scopedEvaluation = evaluateOpticalHierarchy([
        {
          selector: "section.hero h1",
          tag: "h1",
          fontSize: 36,
          fontWeight: 700,
          containerSelector: "section.hero",
        },
        {
          selector: "section.hero h2",
          tag: "h2",
          fontSize: 24,
          fontWeight: 600,
          containerSelector: "section.hero",
        },
        {
          selector: "nav h2",
          tag: "h2",
          fontSize: 18,
          fontWeight: 600,
          containerSelector: "nav.main",
        },
        {
          selector: "nav h3",
          tag: "h3",
          fontSize: 14,
          fontWeight: 400,
          containerSelector: "nav.main",
        },
      ]);

      expect(scopedEvaluation.passed).toBe(true);
      expect(scopedEvaluation.containerEvaluations?.length).toBe(2);

      const failingScoped = evaluateOpticalHierarchy([
        {
          selector: "article.post h1",
          tag: "h1",
          fontSize: 20,
          fontWeight: 300,
          containerSelector: "article.post",
        },
        {
          selector: "article.post h2",
          tag: "h2",
          fontSize: 28,
          fontWeight: 800,
          containerSelector: "article.post",
        },
      ]);

      expect(failingScoped.passed).toBe(false);
      expect(failingScoped.issues[0]).toContain(
        "Inverted optical scale in container [article.post]",
      );
    });

    it("applies DPR-aware subpixel tolerance in horizontal overflow detection", () => {
      // On mobile (DPR 3), subpixel tolerance is 0.25px
      const tinyDeltaWithinDpr = inspectHorizontalOverflow(".box", "mobile", 390.15, 390, 0.15, 3);
      expect(tinyDeltaWithinDpr.hasOverflow).toBe(false);

      const exceedingDelta = inspectHorizontalOverflow(".box", "mobile", 390.8, 390, 0.8, 3);
      expect(exceedingDelta.hasOverflow).toBe(true);
      expect(exceedingDelta.message).toContain("exceeding");
    });

    it("verifies screenshot visual entropy and non-zero render proofing", () => {
      const report = validateUiMechanic({
        screenshots: [
          {
            name: "valid.png",
            path: "sc/valid.png",
            viewport: "mobile",
            sizeBytes: 4096,
            entropyScore: 0.82,
            isBlank: false,
          },
          {
            name: "blank.png",
            path: "sc/blank.png",
            viewport: "tablet",
            sizeBytes: 2048,
            entropyScore: 0.05,
            isBlank: true,
          },
        ],
      });

      expect(report.validScreenshotsCount).toBe(1);
      expect(report.passed).toBe(false);
    });

    it("enforces deterministic browser lifecycle and async hydration invariants", () => {
      const report = validateUiMechanic({
        lifecycleInvariants: {
          fontsReady: false,
          networkIdle: true,
          layoutQuiet: true,
          freshContextPerViewport: true,
          hydrationComplete: false,
        },
      });

      expect(report.passed).toBe(false);
      expect(report.lifecycleViolations.length).toBe(2);
      expect(report.lifecycleViolations[0]).toContain("document.fonts.ready");
      expect(report.lifecycleViolations[1]).toContain("async hydration incomplete");

      const dualResult = evaluateDualUiGates({
        isUiTask: true,
        mechanicInput: {
          lifecycleInvariants: {
            fontsReady: false,
            freshContextPerViewport: false,
          },
        },
        cognitiveInput: {
          critique: "Visual hierarchy and contrast are pristine.",
          canExecuteShell: false,
        },
      });

      expect(dualResult.passed).toBe(false);
      expect(dualResult.defects.some((d) => d.category === "browser-lifecycle")).toBe(true);
    });

    it("allows fractional subpixel rhythm snapping in aesthetic harmony evaluation", () => {
      const snappedPass = evaluateAestheticHarmony([
        { selector: ".card", margin: 15.98, padding: 24.02 },
      ]);
      expect(snappedPass.passed).toBe(true);

      const offRhythmFail = evaluateAestheticHarmony([
        { selector: ".card", margin: 11.2, padding: 21.5 },
      ]);
      expect(offRhythmFail.passed).toBe(false);
    });

    it("accepts same-sized headings with superior font-weight as valid visual hierarchy", () => {
      const sameSizeDistinctWeight = evaluateOpticalHierarchy([
        {
          selector: "section.sidebar h2",
          tag: "h2",
          fontSize: 18,
          fontWeight: 700, // optical weight = 18 * 1.25 = 22.5
          containerSelector: "section.sidebar",
        },
        {
          selector: "section.sidebar h3",
          tag: "h3",
          fontSize: 18,
          fontWeight: 400, // optical weight = 18 * 1.0 = 18.0
          containerSelector: "section.sidebar",
        },
      ]);

      expect(sameSizeDistinctWeight.passed).toBe(true);
      expect(sameSizeDistinctWeight.issues.length).toBe(0);
    });

    it("handles unitless line-height multipliers without false-positive descender clipping", () => {
      const unitlessPass = inspectDescenderIntegrity([
        {
          selector: "p.summary",
          text: "Typography query jump",
          fontSize: 16,
          lineHeight: 1.5, // unitless multiplier! (computed = 24px)
          paddingBottom: 0,
          overflowClipped: false,
        },
      ]);
      expect(unitlessPass.passed).toBe(true);
      expect(unitlessPass.clippedElements.length).toBe(0);
    });

    it("safely sanitizes non-finite or negative numbers in aesthetic harmony checks", () => {
      const sanitized = evaluateAestheticHarmony([
        { selector: ".auto-box", margin: -16, padding: 24 },
        { selector: ".nan-box", margin: Number.NaN, padding: Number.POSITIVE_INFINITY },
      ]);
      expect(sanitized.passed).toBe(true);
    });
  });
});
