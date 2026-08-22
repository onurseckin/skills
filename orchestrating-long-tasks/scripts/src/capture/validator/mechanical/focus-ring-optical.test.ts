import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  calculateApcaContrast,
  calculateRelativeLuminance,
  calculateWcagContrast,
  compositeRgb,
  isValidColor,
  parseRgb,
  type RgbaColor,
} from "../../../reporting/theme-contrast-matrix.ts";
import type { ElementPhysicsSnapshot, ValidationContext } from "../types.ts";
import { validateApcaElement } from "./apca.ts";
import { validateConcentricRadius } from "./concentric-radius.ts";
import {
  auditFocusRingContrast,
  calculateConcentricRadius,
  calculateOpticalCurvatureMetrics,
  parseCssColor,
  snapToDevicePixelRatio,
  validateNestedConcentricCorners,
  type ConcentricCornerEvaluation,
  type FocusRingDefect,
  type FocusRingGeometry,
  type OpticalCurvatureMetrics,
} from "./focus-ring-optical.ts";
import { validateMechanical } from "./index.ts";
import { validateSubpixelSnapping } from "./subpixel-snapping.ts";

/**
 * Geometric helper types and pure calculation functions for testing.
 */
interface CornerRadii {
  readonly topLeft: number;
  readonly topRight: number;
  readonly bottomRight: number;
  readonly bottomLeft: number;
}

interface DirectionalPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

type NestedCornerClassification =
  | "concentric"
  | "non-concentric"
  | "square-in-round"
  | "inverted-mismatch";

interface DprSnappingEvaluation {
  readonly dpr: number;
  readonly requestedCssPx: number;
  readonly physicalPixels: number;
  readonly snappedCssPx: number;
  readonly isGridAligned: boolean;
  readonly subpixelResidual: number;
}

interface HairlineSubpixelGapResult {
  readonly hasHairlineGap: boolean;
  readonly gapCssPx: number;
  readonly gapPhysicalPx: number;
  readonly severity: "none" | "minor" | "moderate" | "serious";
}

/** Computes per-corner concentric outer radii with asymmetric directional padding */
function computeDirectionalConcentricOuter(
  inner: CornerRadii,
  pad: DirectionalPadding,
): CornerRadii {
  const padTL = (pad.top + pad.left) / 2;
  const padTR = (pad.top + pad.right) / 2;
  const padBR = (pad.bottom + pad.right) / 2;
  const padBL = (pad.bottom + pad.left) / 2;

  return {
    topLeft: calculateConcentricRadius(inner.topLeft, padTL),
    topRight: calculateConcentricRadius(inner.topRight, padTR),
    bottomRight: calculateConcentricRadius(inner.bottomRight, padBR),
    bottomLeft: calculateConcentricRadius(inner.bottomLeft, padBL),
  };
}

/** Classifies nested corner relationship into formal geometric taxonomy */
function classifyNestedCornerGeometry(
  outerRadius: number,
  innerRadius: number,
  padding: number,
): {
  readonly classification: NestedCornerClassification;
  readonly isConcentric: boolean;
  readonly delta: number;
} {
  const expectedOuter = calculateConcentricRadius(innerRadius, padding);
  const delta = Math.abs(outerRadius - expectedOuter);

  if (innerRadius === 0 && outerRadius > padding + 2) {
    return { classification: "square-in-round", isConcentric: false, delta };
  }

  if (innerRadius > outerRadius && padding > 0) {
    return { classification: "inverted-mismatch", isConcentric: false, delta };
  }

  if (delta <= 2) {
    return { classification: "concentric", isConcentric: true, delta };
  }

  return { classification: "non-concentric", isConcentric: false, delta };
}

/** Comprehensive DPR grid snapping analysis */
function analyzeDprGridSnapping(cssPixels: number, dpr: number): DprSnappingEvaluation {
  const physicalPixels = Math.round(cssPixels * dpr);
  const snappedCssPx = snapToDevicePixelRatio(cssPixels, dpr);
  const subpixelResidual = Math.abs(cssPixels * dpr - physicalPixels);
  const isGridAligned = subpixelResidual < 0.001;

  return {
    dpr,
    requestedCssPx: cssPixels,
    physicalPixels,
    snappedCssPx,
    isGridAligned,
    subpixelResidual,
  };
}

/** Identifies optical curvature defects and hairline subpixel gaps */
function detectHairlineSubpixelGap(
  innerRadius: number,
  outerRadius: number,
  padding: number,
  dpr: number,
): HairlineSubpixelGapResult {
  const expectedOuter = innerRadius + padding;
  const rawDelta = outerRadius - expectedOuter;
  const gapCssPx = Math.abs(rawDelta);
  const physicalGap = gapCssPx * dpr;

  let severity: "none" | "minor" | "moderate" | "serious" = "none";
  if (gapCssPx > 0.05 && gapCssPx <= 1.0) {
    severity = "minor";
  } else if (gapCssPx > 1.0 && gapCssPx <= 2.5) {
    severity = "moderate";
  } else if (gapCssPx > 2.5) {
    severity = "serious";
  }

  return {
    hasHairlineGap: gapCssPx > 0.05,
    gapCssPx,
    gapPhysicalPx: physicalGap,
    severity,
  };
}

describe("Optical Ring Snapping & Concentric Geometry Matrix Validator", () => {
  describe("1. Exact Concentric Radius Calculations (R_outer = R_inner + P)", () => {
    it("computes exact concentric outer radius for standard component pairings", () => {
      // Standard equation: R_outer = R_inner + P
      // Button inside card container: inner = 8px, padding = 12px -> outer = 20px
      expect(calculateConcentricRadius(8, 12)).toBe(20);

      // Compact chip: inner = 4px, padding = 4px -> outer = 8px
      expect(calculateConcentricRadius(4, 4)).toBe(8);

      // Dialog modal: inner = 16px, padding = 24px -> outer = 40px
      expect(calculateConcentricRadius(16, 24)).toBe(40);

      // Button with focus ring outline offset: inner = 6px, offset = 2px -> outer = 8px
      expect(calculateConcentricRadius(6, 2)).toBe(8);

      // Large focus ring halo: inner = 8px, offset = 4px -> outer = 12px
      expect(calculateConcentricRadius(8, 4)).toBe(12);
    });

    it("handles boundary cases: zero inner radius, zero padding, and negative clamps", () => {
      // Sharp inner square nested in padded container: inner = 0, padding = 8 -> outer = 8
      expect(calculateConcentricRadius(0, 8)).toBe(8);

      // Zero padding (flush boundary): outer = inner
      expect(calculateConcentricRadius(12, 0)).toBe(12);

      // Clamps negative radius/padding safely to 0
      expect(calculateConcentricRadius(-5, 10)).toBe(5);
      expect(calculateConcentricRadius(10, -15)).toBe(0);
    });

    it("computes diagonal optical compensation along 45-degree corner trajectory", () => {
      // Diagonal distance growth along the 45-deg corner trajectory is (sqrt(2) - 1) * P
      const eval4 = validateNestedConcentricCorners(8, 4, 4);
      expect(eval4.isConcentric).toBe(true);
      expect(eval4.opticalCorrection).toBeCloseTo((Math.SQRT2 - 1) * 4, 2);

      const eval12 = validateNestedConcentricCorners(20, 8, 12);
      expect(eval12.isConcentric).toBe(true);
      expect(eval12.opticalCorrection).toBeCloseTo((Math.SQRT2 - 1) * 12, 2);
    });

    it("evaluates multi-level nested concentric hierarchies (Card -> Panel -> Button -> Focus Ring)", () => {
      const cardPadding = 16;
      const panelPadding = 12;
      const focusRingOffset = 3;

      const buttonRadius = 6;
      const expectedFocusRingRadius = calculateConcentricRadius(buttonRadius, focusRingOffset);
      const expectedPanelRadius = calculateConcentricRadius(buttonRadius, panelPadding);
      const expectedCardRadius = calculateConcentricRadius(expectedPanelRadius, cardPadding);

      expect(expectedFocusRingRadius).toBe(9);
      expect(expectedPanelRadius).toBe(18);
      expect(expectedCardRadius).toBe(34);

      // Chain invariance: R_card - P_card - P_panel = R_button
      expect(expectedCardRadius - cardPadding - panelPadding).toBe(buttonRadius);
    });

    it("computes directional per-corner concentric radii with asymmetric padding", () => {
      const innerCorners: CornerRadii = {
        topLeft: 12,
        topRight: 8,
        bottomRight: 4,
        bottomLeft: 16,
      };

      const asymmetricPadding: DirectionalPadding = {
        top: 10,
        right: 20,
        bottom: 10,
        left: 20,
      };

      const outerCorners = computeDirectionalConcentricOuter(innerCorners, asymmetricPadding);

      // Top-Left: inner 12 + pad (10+20)/2 = 15 -> 27
      expect(outerCorners.topLeft).toBe(27);
      // Top-Right: inner 8 + pad (10+20)/2 = 15 -> 23
      expect(outerCorners.topRight).toBe(23);
      // Bottom-Right: inner 4 + pad (10+20)/2 = 15 -> 19
      expect(outerCorners.bottomRight).toBe(19);
      // Bottom-Left: inner 16 + pad (10+20)/2 = 15 -> 31
      expect(outerCorners.bottomLeft).toBe(31);
    });

    it("passes concentric elements through validateConcentricRadius when diff <= 2px", () => {
      const compliantChild: ElementPhysicsSnapshot = {
        selector: "button.card-action",
        tagName: "BUTTON",
        bounds: { x: 20, y: 20, width: 120, height: 40 },
        computedStyles: { borderRadius: 8 },
        parentBorderRadius: 20,
        parentPadding: 12, // 8 + 12 = 20 (diff = 0)
      };

      const defect = validateConcentricRadius(compliantChild, 0);
      expect(defect).toBeNull();

      // Within 2px tolerance (outer = 21 vs expected = 20 -> diff = 1 <= 2)
      const minorToleranceChild: ElementPhysicsSnapshot = {
        ...compliantChild,
        parentBorderRadius: 21,
      };
      expect(validateConcentricRadius(minorToleranceChild, 1)).toBeNull();
    });

    it("flags defect in validateConcentricRadius when outer radius violates concentric equation by > 2px", () => {
      const nonConcentricChild: ElementPhysicsSnapshot = {
        selector: "button.card-action",
        tagName: "BUTTON",
        bounds: { x: 20, y: 20, width: 120, height: 40 },
        computedStyles: { borderRadius: 8 },
        parentBorderRadius: 8, // Outer is 8px, but expected is 8 + 12 = 20px (diff = 12px > 2px)
        parentPadding: 12,
      };

      const defect = validateConcentricRadius(nonConcentricChild, 42);
      expect(defect).not.toBeNull();
      expect(defect?.pillar).toBe("mechanical");
      expect(defect?.category).toBe("concentric-radius");
      expect(defect?.severity).toBe("moderate");
      expect(defect?.message).toContain("Concentric corner radius mismatch");
      expect(defect?.message).toContain("outer radius is 8px but expected 20px");
      expect(defect?.metadata?.innerRadius).toBe(8);
      expect(defect?.metadata?.actualOuterRadius).toBe(8);
      expect(defect?.metadata?.expectedOuterRadius).toBe(20);
      expect(defect?.remediations.length).toBeGreaterThan(0);
    });

    it("validates container element with children array in validateConcentricRadius", () => {
      const containerWithMismatchedChild: ElementPhysicsSnapshot = {
        selector: "div.panel-container",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 300, height: 200 },
        computedStyles: {
          borderRadius: 8, // Container radius 8px
          padding: 16, // Padding 16px
        },
        children: [
          {
            selector: "div.inner-card",
            tagName: "DIV",
            bounds: { x: 16, y: 16, width: 268, height: 168 },
            computedStyles: { borderRadius: 12 }, // Expected container = 12 + 16 = 28px
          },
        ],
      };

      const defect = validateConcentricRadius(containerWithMismatchedChild, 5);
      expect(defect).not.toBeNull();
      expect(defect?.id).toBe("mech-concentric-radius-child-5-0");
      expect(defect?.elementSelector).toBe("div.panel-container > div.inner-card");
      expect(defect?.message).toContain("container radius is 8px but expected 28px");
      expect(defect?.metadata?.innerRadius).toBe(12);
      expect(defect?.metadata?.actualOuterRadius).toBe(8);
      expect(defect?.metadata?.expectedOuterRadius).toBe(28);
    });
  });

  describe("2. Nested Corner Evaluation (Concentric vs Non-Concentric vs Square-in-Round vs Inverted)", () => {
    it("correctly evaluates concentric nested corners with smooth uniform curves", () => {
      const evaluation = validateNestedConcentricCorners(20, 8, 12, 1.0);
      expect(evaluation.isConcentric).toBe(true);
      expect(evaluation.delta).toBe(0);
      expect(evaluation.expectedOuterRadius).toBe(20);
      expect(evaluation.actualOuterRadius).toBe(20);
      expect(evaluation.details).toContain("Corners are concentric within tolerance");

      const classification = classifyNestedCornerGeometry(20, 8, 12);
      expect(classification.classification).toBe("concentric");
      expect(classification.isConcentric).toBe(true);
    });

    it("correctly evaluates non-concentric nested corners where radii are equal (corner pinching)", () => {
      // Both inner and outer are 12px with 16px padding -> inner looks pinched against outer
      const evaluation = validateNestedConcentricCorners(12, 12, 16, 1.0);
      expect(evaluation.isConcentric).toBe(false);
      expect(evaluation.delta).toBe(16); // Expected 28px, got 12px
      expect(evaluation.expectedOuterRadius).toBe(28);
      expect(evaluation.details).toContain("Concentric corner mismatch");

      const classification = classifyNestedCornerGeometry(12, 12, 16);
      expect(classification.classification).toBe("non-concentric");
      expect(classification.isConcentric).toBe(false);
    });

    it("correctly detects square nested in round (R_inner = 0 inside rounded container)", () => {
      // Sharp inner element inside 16px rounded container with 8px padding
      const evaluation = validateNestedConcentricCorners(16, 0, 8, 1.0);
      expect(evaluation.isConcentric).toBe(false);
      expect(evaluation.delta).toBe(8); // Expected 8px, got 16px
      expect(evaluation.expectedOuterRadius).toBe(8);

      const classification = classifyNestedCornerGeometry(16, 0, 8);
      expect(classification.classification).toBe("square-in-round");
      expect(classification.isConcentric).toBe(false);
    });

    it("correctly detects inverted mismatch (R_inner > R_outer with positive padding)", () => {
      // Inner pill button (R=24) inside slightly rounded container (R=8) with 8px padding
      const evaluation = validateNestedConcentricCorners(8, 24, 8, 1.0);
      expect(evaluation.isConcentric).toBe(false);
      expect(evaluation.delta).toBe(24); // Expected 32px, got 8px
      expect(evaluation.expectedOuterRadius).toBe(32);

      const classification = classifyNestedCornerGeometry(8, 24, 8);
      expect(classification.classification).toBe("inverted-mismatch");
      expect(classification.isConcentric).toBe(false);
    });

    it("evaluates comprehensive matrix across diverse geometry test vectors", () => {
      const testMatrix: readonly {
        readonly inner: number;
        readonly outer: number;
        readonly pad: number;
        readonly tol: number;
        readonly expectedClass: NestedCornerClassification;
        readonly expectedConcentric: boolean;
      }[] = [
        {
          inner: 4,
          outer: 8,
          pad: 4,
          tol: 1.0,
          expectedClass: "concentric",
          expectedConcentric: true,
        },
        {
          inner: 8,
          outer: 16,
          pad: 8,
          tol: 1.0,
          expectedClass: "concentric",
          expectedConcentric: true,
        },
        {
          inner: 16,
          outer: 32,
          pad: 16,
          tol: 1.0,
          expectedClass: "concentric",
          expectedConcentric: true,
        },
        {
          inner: 6,
          outer: 9,
          pad: 3,
          tol: 1.0,
          expectedClass: "concentric",
          expectedConcentric: true,
        },
        {
          inner: 8,
          outer: 8,
          pad: 8,
          tol: 1.0,
          expectedClass: "non-concentric",
          expectedConcentric: false,
        },
        {
          inner: 12,
          outer: 12,
          pad: 12,
          tol: 1.0,
          expectedClass: "non-concentric",
          expectedConcentric: false,
        },
        {
          inner: 0,
          outer: 24,
          pad: 8,
          tol: 1.0,
          expectedClass: "square-in-round",
          expectedConcentric: false,
        },
        {
          inner: 0,
          outer: 16,
          pad: 4,
          tol: 1.0,
          expectedClass: "square-in-round",
          expectedConcentric: false,
        },
        {
          inner: 20,
          outer: 10,
          pad: 8,
          tol: 1.0,
          expectedClass: "inverted-mismatch",
          expectedConcentric: false,
        },
        {
          inner: 16,
          outer: 6,
          pad: 12,
          tol: 1.0,
          expectedClass: "inverted-mismatch",
          expectedConcentric: false,
        },
      ];

      for (const vector of testMatrix) {
        const result = validateNestedConcentricCorners(
          vector.outer,
          vector.inner,
          vector.pad,
          vector.tol,
        );
        expect(result.isConcentric).toBe(vector.expectedConcentric);

        const classification = classifyNestedCornerGeometry(vector.outer, vector.inner, vector.pad);
        expect(classification.classification).toBe(vector.expectedClass);
        expect(classification.isConcentric).toBe(vector.expectedConcentric);
      }
    });
  });

  describe("3. Focus Ring Optical Snapping Across Standard and Fractional DPRs", () => {
    it("snaps coordinates and widths on DPR 1.0x (Standard Desktop Display)", () => {
      const dpr = 1.0;

      // Clean integer pixel values remain exact
      expect(snapToDevicePixelRatio(2.0, dpr)).toBe(2.0);
      expect(snapToDevicePixelRatio(100.0, dpr)).toBe(100.0);

      // Fractional CSS value on DPR 1.0x snaps to nearest integer physical pixel
      expect(snapToDevicePixelRatio(2.4, dpr)).toBe(2.0);
      expect(snapToDevicePixelRatio(2.6, dpr)).toBe(3.0);

      const analysis = analyzeDprGridSnapping(2.0, dpr);
      expect(analysis.isGridAligned).toBe(true);
      expect(analysis.physicalPixels).toBe(2);
    });

    it("snaps coordinates and widths on DPR 1.25x (125% Windows Scaling)", () => {
      const dpr = 1.25;

      // 0.8 CSS px = 1 physical px on 1.25x
      expect(snapToDevicePixelRatio(0.8, dpr)).toBe(0.8);
      const analysis08 = analyzeDprGridSnapping(0.8, dpr);
      expect(analysis08.isGridAligned).toBe(true);
      expect(analysis08.physicalPixels).toBe(1);

      // 1.6 CSS px = 2 physical px
      expect(snapToDevicePixelRatio(1.6, dpr)).toBe(1.6);
      const analysis16 = analyzeDprGridSnapping(1.6, dpr);
      expect(analysis16.isGridAligned).toBe(true);
      expect(analysis16.physicalPixels).toBe(2);

      // 2.0 CSS px = 2.5 physical px -> rounds to 3 physical px (2.4 CSS px)
      expect(snapToDevicePixelRatio(2.0, dpr)).toBe(2.4);
      const analysis20 = analyzeDprGridSnapping(2.0, dpr);
      expect(analysis20.isGridAligned).toBe(false);
      expect(analysis20.physicalPixels).toBe(3);
      expect(analysis20.snappedCssPx).toBe(2.4);
    });

    it("snaps coordinates and widths on DPR 1.5x (150% Scaling Display)", () => {
      const dpr = 1.5;

      // 2.0 CSS px = 3 physical px
      expect(snapToDevicePixelRatio(2.0, dpr)).toBe(2.0);
      const analysis20 = analyzeDprGridSnapping(2.0, dpr);
      expect(analysis20.isGridAligned).toBe(true);
      expect(analysis20.physicalPixels).toBe(3);

      // 1.0 CSS px = 1.5 physical px -> snaps to 2 physical px (1.333... CSS px)
      expect(snapToDevicePixelRatio(1.0, dpr)).toBeCloseTo(1.333, 3);
      const analysis10 = analyzeDprGridSnapping(1.0, dpr);
      expect(analysis10.isGridAligned).toBe(false);
      expect(analysis10.physicalPixels).toBe(2);
    });

    it("snaps coordinates and widths on DPR 2.0x (Retina Display)", () => {
      const dpr = 2.0;

      // 0.5 CSS px = 1 physical px
      expect(snapToDevicePixelRatio(0.5, dpr)).toBe(0.5);
      const analysis05 = analyzeDprGridSnapping(0.5, dpr);
      expect(analysis05.isGridAligned).toBe(true);
      expect(analysis05.physicalPixels).toBe(1);

      // 1.5 CSS px = 3 physical px
      expect(snapToDevicePixelRatio(1.5, dpr)).toBe(1.5);
      const analysis15 = analyzeDprGridSnapping(1.5, dpr);
      expect(analysis15.isGridAligned).toBe(true);
      expect(analysis15.physicalPixels).toBe(3);

      // 2.0 CSS px = 4 physical px
      expect(snapToDevicePixelRatio(2.0, dpr)).toBe(2.0);
      const analysis20 = analyzeDprGridSnapping(2.0, dpr);
      expect(analysis20.isGridAligned).toBe(true);
      expect(analysis20.physicalPixels).toBe(4);

      // Fractional 0.35 CSS px = 0.7 physical px -> snaps to 1 physical px (0.5 CSS px)
      expect(snapToDevicePixelRatio(0.35, dpr)).toBe(0.5);
      const analysisUnsnapped = analyzeDprGridSnapping(0.35, dpr);
      expect(analysisUnsnapped.isGridAligned).toBe(false);
      expect(analysisUnsnapped.physicalPixels).toBe(1);
    });

    it("snaps coordinates and widths on DPR 3.0x (Mobile Retina @3x / Ultra High Density)", () => {
      const dpr = 3.0;

      // 0.333... CSS px = 1 physical px (1/3)
      expect(snapToDevicePixelRatio(1 / 3, dpr)).toBeCloseTo(0.333, 3);
      // 0.666... CSS px = 2 physical px (2/3)
      expect(snapToDevicePixelRatio(2 / 3, dpr)).toBeCloseTo(0.667, 3);
      // 1.0 CSS px = 3 physical px
      expect(snapToDevicePixelRatio(1.0, dpr)).toBe(1.0);
      const analysis10 = analyzeDprGridSnapping(1.0, dpr);
      expect(analysis10.isGridAligned).toBe(true);
      expect(analysis10.physicalPixels).toBe(3);
    });

    it("detects subpixel snapping defects via validateSubpixelSnapping for fractional bounds", () => {
      const cleanElement: ElementPhysicsSnapshot = {
        selector: "button.focus-ring-snapped",
        tagName: "BUTTON",
        bounds: { x: 100, y: 200, width: 120, height: 40 },
        computedStyles: { transform: "none" },
      };

      expect(validateSubpixelSnapping(cleanElement, 0)).toBeNull();

      const fractionalElement: ElementPhysicsSnapshot = {
        selector: "button.focus-ring-unsnapped",
        tagName: "BUTTON",
        bounds: { x: 100.35, y: 200.45, width: 119.8, height: 39.9 },
        computedStyles: { transform: "matrix(1, 0, 0, 1, 10.45, 20.35)" },
      };

      const defect = validateSubpixelSnapping(fractionalElement, 1);
      expect(defect).not.toBeNull();
      expect(defect?.pillar).toBe("mechanical");
      expect(defect?.category).toBe("subpixel-snapping");
      expect(defect?.severity).toBe("minor");
      expect(defect?.message).toContain("fractional subpixel positioning");
      expect(defect?.metadata?.fractionalValues).toContain("x=100.35px");
      expect(defect?.metadata?.fractionalValues).toContain("y=200.45px");
    });
  });

  describe("4. Focus Ring Contrast Ratio Audits (WCAG 2.1 3:1 Non-Text Contrast)", () => {
    it("verifies accessible high-contrast focus rings meet WCAG 2.1 3:1 non-text threshold via auditFocusRingContrast", () => {
      // Standard Accessible Blue (#005fcc) on White (#ffffff) -> CR ~ 6.0:1 >= 3.0:1
      const blueAudit = auditFocusRingContrast("#005fcc", "#ffffff");
      expect(blueAudit.passes).toBe(true);
      expect(blueAudit.contrastRatio).toBeGreaterThanOrEqual(3.0);
      expect(blueAudit.contrastRatio).toBeCloseTo(6.0, 1);

      // Deep Black Ring (#000000) on White (#ffffff) -> CR = 21:1
      const blackAudit = auditFocusRingContrast("#000000", "#ffffff");
      expect(blackAudit.passes).toBe(true);
      expect(blackAudit.contrastRatio).toBe(21.0);

      // Dark Slate Ring (#0f172a) on Light Gray (#f1f5f9) -> CR >= 13:1
      const slateAudit = auditFocusRingContrast("#0f172a", "#f1f5f9");
      expect(slateAudit.passes).toBe(true);
      expect(slateAudit.contrastRatio).toBeGreaterThanOrEqual(13.0);
    });

    it("identifies failing low-contrast focus rings below 3:1 threshold via auditFocusRingContrast", () => {
      // Faint Cyan (#70c5ff) on White (#ffffff) -> CR ~ 1.7:1 (FAIL)
      const faintCyanAudit = auditFocusRingContrast("#70c5ff", "#ffffff");
      expect(faintCyanAudit.passes).toBe(false);
      expect(faintCyanAudit.contrastRatio).toBeLessThan(3.0);

      // Pale Gray Ring (#d1d5db) on White (#ffffff) -> CR ~ 1.5:1 (FAIL)
      const paleGrayAudit = auditFocusRingContrast("#d1d5db", "#ffffff");
      expect(paleGrayAudit.passes).toBe(false);
      expect(paleGrayAudit.contrastRatio).toBeLessThan(3.0);

      // Light Yellow (#fef08a) on White (#ffffff) -> CR ~ 1.15:1 (FAIL)
      const yellowAudit = auditFocusRingContrast("#fef08a", "#ffffff");
      expect(yellowAudit.passes).toBe(false);
      expect(yellowAudit.contrastRatio).toBeLessThan(3.0);
    });

    it("parses diverse CSS color representations in parseCssColor", () => {
      // Named color
      const whiteRgb = parseCssColor("white");
      expect(whiteRgb).toEqual({ r: 255, g: 255, b: 255, a: 1 });

      // Hex 3-digit
      const red3 = parseCssColor("#f00");
      expect(red3).toEqual({ r: 255, g: 0, b: 0, a: 1 });

      // Hex 6-digit
      const blue6 = parseCssColor("#0000ff");
      expect(blue6).toEqual({ r: 0, g: 0, b: 255, a: 1 });

      // Hex 8-digit
      const semiGreen = parseCssColor("#00ff0080");
      expect(semiGreen?.r).toBe(0);
      expect(semiGreen?.g).toBe(255);
      expect(semiGreen?.b).toBe(0);
      expect(semiGreen?.a).toBeCloseTo(0.5, 1);

      // RGBA functional syntax
      const rgbaColor = parseCssColor("rgba(10, 20, 30, 0.75)");
      expect(rgbaColor).toEqual({ r: 10, g: 20, b: 30, a: 0.75 });

      // HSLA functional syntax
      const hslGreen = parseCssColor("hsl(120, 100%, 50%)");
      expect(hslGreen?.r).toBe(0);
      expect(hslGreen?.g).toBe(255);
      expect(hslGreen?.b).toBe(0);
      expect(hslGreen?.a).toBe(1);
    });

    it("evaluates multi-theme focus ring matrix across Light, Dark, and High-Contrast modes", () => {
      const themeProfiles = [
        {
          theme: "light",
          ringColor: "#0284c7", // Sky 600 (CR ~ 4.4:1 on white)
          background: "#ffffff",
          expectedPass: true,
        },
        {
          theme: "dark",
          ringColor: "#38bdf8", // Sky 400 (CR ~ 7.5:1 on slate 900)
          background: "#0f172a", // Slate 900
          expectedPass: true,
        },
        {
          theme: "dark-failing",
          ringColor: "#1e3a8a", // Dark Blue (CR ~ 1.1:1 on slate 900 -> FAILS 3:1)
          background: "#0f172a",
          expectedPass: false,
        },
        {
          theme: "high-contrast-light",
          ringColor: "#000000",
          background: "#ffffff",
          expectedPass: true,
        },
        {
          theme: "high-contrast-dark",
          ringColor: "#facc15", // Vivid Yellow (CR ~ 14.5:1 on black)
          background: "#000000",
          expectedPass: true,
        },
      ];

      for (const profile of themeProfiles) {
        const audit = auditFocusRingContrast(profile.ringColor, profile.background);
        expect(audit.passes).toBe(profile.expectedPass);
      }
    });

    it("evaluates alpha-composited translucent focus rings against dark substrate", () => {
      // 80% White focus ring on dark navy (#0f172a)
      const white80 = "rgba(255, 255, 255, 0.8)";
      const darkNavy = "#0f172a";
      const audit80 = auditFocusRingContrast(white80, darkNavy);
      expect(audit80.passes).toBe(true);
      expect(audit80.contrastRatio).toBeGreaterThanOrEqual(10.0);

      // 20% White focus ring on dark navy (too faint)
      const white20 = "rgba(255, 255, 255, 0.2)";
      const audit20 = auditFocusRingContrast(white20, darkNavy);
      expect(audit20.passes).toBe(false);
      expect(audit20.contrastRatio).toBeLessThan(3.0);
    });

    it("computes APCA perceptual lightness difference for focus ring pairings", () => {
      // White on Dark Navy -> Negative Lc with high magnitude
      const apcaWhiteOnDark = calculateApcaContrast("#ffffff", "#0f172a");
      expect(Math.abs(apcaWhiteOnDark)).toBeGreaterThan(90.0);

      // Black on White -> Positive Lc > 100
      const apcaBlackOnWhite = calculateApcaContrast("#000000", "#ffffff");
      expect(apcaBlackOnWhite).toBeGreaterThan(100.0);

      // Inaccessible pair -> Low Lc
      const apcaFaint = calculateApcaContrast("#94a3b8", "#cbd5e1");
      expect(Math.abs(apcaFaint)).toBeLessThan(30.0);
    });
  });

  describe("5. Optical Curvature Defects, Squircle Metrics & Hairline Gaps", () => {
    it("computes non-Euclidean optical curvature smoothing metrics for superellipse corners", () => {
      // Circular baseline (exponent = 2.0)
      const circleMetrics = calculateOpticalCurvatureMetrics(8, 2, 10, 0.0, 2.0);
      expect(circleMetrics.curvatureExponent).toBe(2.0);
      expect(circleMetrics.smoothingFactor).toBe(0.0);
      expect(circleMetrics.nonEuclideanDelta).toBe(0.0);
      expect(circleMetrics.hasG2Continuity).toBe(false);

      // iOS/macOS squircle (exponent = 4.0, G2 continuous)
      const squircleMetrics = calculateOpticalCurvatureMetrics(8, 2, 10, undefined, 4.0);
      expect(squircleMetrics.curvatureExponent).toBe(4.0);
      expect(squircleMetrics.nonEuclideanDelta).toBeGreaterThan(0.0);
      expect(squircleMetrics.hasG2Continuity).toBe(true);
      expect(squircleMetrics.cornerArcLengthCorrection).toBeGreaterThan(1.0);
    });

    it("detects hairline subpixel gaps caused by offset/radius round-off mismatch", () => {
      // Perfect concentric match: inner=8, outer=12, padding=4 -> 0px gap
      const noGap = detectHairlineSubpixelGap(8, 12, 4, 2.0);
      expect(noGap.hasHairlineGap).toBe(false);
      expect(noGap.gapCssPx).toBe(0);
      expect(noGap.severity).toBe("none");

      // Hairline 0.5px gap at 2.0x DPR (1.0 physical device pixel)
      const hairlineGap = detectHairlineSubpixelGap(8, 12.5, 4, 2.0);
      expect(hairlineGap.hasHairlineGap).toBe(true);
      expect(hairlineGap.gapCssPx).toBeCloseTo(0.5, 2);
      expect(hairlineGap.gapPhysicalPx).toBeCloseTo(1.0, 2);
      expect(hairlineGap.severity).toBe("minor");

      // Moderate gap: 1.5px gap at 1.5x DPR
      const moderateGap = detectHairlineSubpixelGap(8, 13.5, 4, 1.5);
      expect(moderateGap.hasHairlineGap).toBe(true);
      expect(moderateGap.gapCssPx).toBeCloseTo(1.5, 2);
      expect(moderateGap.severity).toBe("moderate");

      // Serious gap: 4px gap mismatch
      const seriousGap = detectHairlineSubpixelGap(8, 16, 4, 1.0);
      expect(seriousGap.hasHairlineGap).toBe(true);
      expect(seriousGap.gapCssPx).toBe(4.0);
      expect(seriousGap.severity).toBe("serious");
    });

    it("integrates with full validateMechanical pipeline without false positives on pristine UI", () => {
      const pristineContext: ValidationContext = {
        screenId: "settings-dialog",
        viewport: "desktop",
        elements: [
          {
            selector: "button.save-btn",
            tagName: "BUTTON",
            text: "Save Changes",
            bounds: { x: 100, y: 100, width: 140, height: 48 },
            computedStyles: {
              color: "#ffffff",
              backgroundColor: "#0f172a",
              fontSize: 16,
              fontWeight: 600,
              borderRadius: 8,
              transform: "none",
            },
            interactive: true,
            isTouchTarget: true,
            parentBorderRadius: 24,
            parentPadding: 16, // Concentric: 8 + 16 = 24px
          },
        ],
        viewportBounds: { width: 1440, height: 900 },
      };

      const result = validateMechanical(pristineContext);
      expect(result.pillar).toBe("mechanical");
      expect(result.passed).toBe(true);
      expect(result.defects.length).toBe(0);
      expect(result.evaluatedCount).toBe(1);
    });

    it("aggregates mechanical defects when concentric radius and subpixel flaws co-occur", () => {
      const defectiveContext: ValidationContext = {
        screenId: "settings-dialog-defective",
        viewport: "desktop",
        elements: [
          {
            selector: "button.faulty-btn",
            tagName: "BUTTON",
            text: "Faulty Action",
            bounds: { x: 100.45, y: 100.35, width: 139.7, height: 47.8 }, // Subpixel fractional
            computedStyles: {
              color: "#ffffff",
              backgroundColor: "#0f172a",
              fontSize: 16,
              fontWeight: 600,
              borderRadius: 4,
              transform: "translate(10.35px, 20.45px)", // Transform fractional
            },
            interactive: true,
            isTouchTarget: true,
            parentBorderRadius: 28, // Outer 28px vs expected 4 + 8 = 12px (Concentric mismatch diff = 16px)
            parentPadding: 8,
          },
        ],
        viewportBounds: { width: 1440, height: 900 },
      };

      const result = validateMechanical(defectiveContext);
      expect(result.passed).toBe(false);
      expect(result.defects.length).toBeGreaterThanOrEqual(2);

      const defectCategories = result.defects.map((d) => d.category);
      expect(defectCategories).toContain("concentric-radius");
      expect(defectCategories).toContain("subpixel-snapping");
    });
  });

  describe("6. Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
    it("verifies zero TypeScript any and zero compiler/linter suppressions across touched mechanical validator files", () => {
      const filesToAudit = [
        resolve(import.meta.dir, "focus-ring-optical.test.ts"),
        resolve(import.meta.dir, "focus-ring-optical.ts"),
        resolve(import.meta.dir, "concentric-radius.ts"),
        resolve(import.meta.dir, "subpixel-snapping.ts"),
        resolve(import.meta.dir, "apca.ts"),
        resolve(import.meta.dir, "index.ts"),
      ];

      const anyPattern = /:\s*any\b|as\s+any\b|<any>|\bany\s*>/;
      const suppressionPattern = new RegExp("@ts-" + "ignore|@ts-" + "expect-error|@ts-" + "nocheck|eslint-" + "disable|oxlint-" + "disable");

      for (const filePath of filesToAudit) {
        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;

          // Skip lines that define the testing regexes themselves
          if (line.includes("anyPattern") || line.includes("suppressionPattern") || line.includes("new RegExp")) continue;

          expect(anyPattern.test(line)).toBe(false);
          expect(suppressionPattern.test(line)).toBe(false);
        }
      }
    });
  });
});
