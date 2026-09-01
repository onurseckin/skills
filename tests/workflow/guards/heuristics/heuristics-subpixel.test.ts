import { describe, expect, it } from "bun:test";
import {
  calculateApcaLightness,
  formatManifestFilename,
  isCertifiedManifest,
  loadCompanionManifest,
  saveCompanionManifest,
  synthesizeCompanionManifest,
  validateApcaElement,
  validateConcentricRadius,
  validateCustom,
  validateFloatingUiCollision,
  validateMaterialStateLayers,
  validateMechanical,
  validateSubpixelSnapping,
  validateWaiAriaFocusTrap,
} from "../../../../olt/scripts/src/capture/validator/index.ts";
import type {
  CompanionManifestV2,
  ElementPhysicsSnapshot,
  ValidationContext,
} from "../../../../olt/scripts/src/capture/validator/types.ts";
import {
  computeLayoutMetrics,
  createEmptyDomPhysicsSnapshot,
} from "../../../../olt/scripts/src/capture/runners/dom-physics-extractor.ts";
import { createSyntheticPngBuffer } from "../../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";
import {
  analyzeDualChannel,
  validateCompanionManifestCriteria,
  type CompanionManifestData,
  type DualChannelInput,
  type ScreenshotMetadata,
  type StructuredFinding,
  type VisualMetricsReport,
} from "../../../../olt/scripts/src/validation/dual-channel-analyzer/index.ts";
import { assertRoleArtifactPresent } from "../../../../olt/scripts/src/workflow/review/role-evidence.ts";
import type { TaskRecord, WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";

function createFindingCollector(): {
  readonly findings: StructuredFinding[];
  readonly addFinding: (
    category: StructuredFinding["category"],
    severity: StructuredFinding["severity"],
    message: string,
    remediation: string,
    affectedSelector?: string,
    viewport?: string,
  ) => void;
} {
  const findings: StructuredFinding[] = [];
  const addFinding = (
    category: StructuredFinding["category"],
    severity: StructuredFinding["severity"],
    message: string,
    remediation: string,
    affectedSelector?: string,
    viewport?: string,
  ): void => {
    findings.push({
      id: `FINDING-${String(findings.length + 1).padStart(3, "0")}`,
      category,
      severity,
      message,
      remediation,
      ...(affectedSelector !== undefined ? { affectedSelector } : {}),
      ...(viewport !== undefined ? { viewport } : {}),
    });
  };
  return { findings, addFinding };
}

describe("Adversarial Edge Cases: Subpixel Border Alignment & Fractional Scale Factors", () => {
  it("flags elements with fractional subpixel coordinates causing subpixel rendering blur", () => {
    const fractionalEl: ElementPhysicsSnapshot = {
      selector: "div.card-subpixel",
      tagName: "DIV",
      bounds: { x: 10.33, y: 20.75, width: 100.45, height: 50.55 },
    };

    const defect = validateSubpixelSnapping(fractionalEl, 0);
    expect(defect).not.toBeNull();
    expect(defect?.pillar).toBe("mechanical");
    expect(defect?.category).toBe("subpixel-snapping");
    expect(defect?.severity).toBe("minor");
    expect(defect?.message).toContain("fractional subpixel positioning");
  });

  it("passes integer pixel aligned elements and rejects transform subpixel fractions", () => {
    const integerEl: ElementPhysicsSnapshot = {
      selector: "div.card-snapped",
      tagName: "DIV",
      bounds: { x: 10.0, y: 20.0, width: 100.0, height: 50.0 },
    };
    expect(validateSubpixelSnapping(integerEl, 0)).toBeNull();

    // Adversarial transform: matrix with fractional translation (10.45, 20.55)
    const transformEl: ElementPhysicsSnapshot = {
      selector: "div.card-matrix",
      tagName: "DIV",
      bounds: { x: 10.0, y: 20.0, width: 100.0, height: 50.0 },
      computedStyles: {
        transform: "matrix(1, 0, 0, 1, 10.45, 20.55)",
      },
    };
    const defect = validateSubpixelSnapping(transformEl, 1);
    expect(defect).not.toBeNull();
    expect(defect?.category).toBe("subpixel-snapping");

    // CSS translate3d with fractional values
    const translate3dEl: ElementPhysicsSnapshot = {
      selector: "div.card-translate",
      tagName: "DIV",
      bounds: { x: 0, y: 0, width: 50, height: 50 },
      computedStyles: {
        transform: "translate3d(12.75px, 8.4px, 0)",
      },
    };
    const translateDefect = validateSubpixelSnapping(translate3dEl, 2);
    expect(translateDefect).not.toBeNull();
    expect(translateDefect?.category).toBe("subpixel-snapping");
  });

  it("validates concentric corner radii alignment under outer/inner radii formulas", () => {
    // Nested element with R_outer = 16, R_inner = 8, Padding = 8 => (16 = 8 + 8) PASS
    const matchedEl: ElementPhysicsSnapshot = {
      selector: "div.inner-card",
      tagName: "DIV",
      bounds: { x: 8, y: 8, width: 80, height: 80 },
      parentBorderRadius: 16,
      parentPadding: 8,
      computedStyles: {
        borderRadius: 8,
      },
    };
    expect(validateConcentricRadius(matchedEl, 0)).toBeNull();

    // Adversarial: Mismatched outer radius (outer = 28, inner = 8, padding = 8, expected = 16)
    const mismatchedEl: ElementPhysicsSnapshot = {
      selector: "div.inner-mismatched",
      tagName: "DIV",
      bounds: { x: 8, y: 8, width: 80, height: 80 },
      parentBorderRadius: 28,
      parentPadding: 8,
      computedStyles: {
        borderRadius: 8,
      },
    };
    const defect = validateConcentricRadius(mismatchedEl, 1);
    expect(defect).not.toBeNull();
    expect(defect?.pillar).toBe("mechanical");
    expect(defect?.category).toBe("concentric-radius");
    expect(defect?.severity).toBe("moderate");
    expect(defect?.message).toContain("expected 16px (inner radius 8px + padding 8px)");
  });

  it("computes layout metrics with fractional tolerances without throwing errors", () => {
    const emptySnapshot = createEmptyDomPhysicsSnapshot(1440, 900, 2.5);
    expect(emptySnapshot.viewport.deviceScaleFactor).toBe(2.5);

    const elementPhysics = [
      {
        selector: "div.overflowing-container",
        tagName: "div",
        bounds: { x: 0, y: 0, width: 1500, height: 100, top: 0, right: 1500, bottom: 100, left: 0 },
        computedStyles: {
          display: "block",
          position: "relative",
          zIndex: 0,
          overflowX: "scroll",
          overflowY: "hidden",
          color: "#ffffff",
          backgroundColor: "#000000",
        },
        metrics: {
          scrollWidth: 1600,
          clientWidth: 1400,
          scrollHeight: 100,
          clientHeight: 100,
          offsetWidth: 1400,
          offsetHeight: 100,
        },
        textSnippet: "Long text content...",
      },
    ];

    const metrics = computeLayoutMetrics(elementPhysics, 1440, 900, 0.5);
    expect(metrics.layoutOverflows.length).toBeGreaterThanOrEqual(1);
    expect(metrics.layoutOverflows[0]?.selector).toBe("div.overflowing-container");
    expect(metrics.layoutOverflows[0]?.overflowX).toBe(200);
  });
});
