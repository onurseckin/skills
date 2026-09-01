import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
import { setupWorkflowVirtualFs } from "../../shared/index.ts";

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

describe("Adversarial Edge Cases: Nested Glass Surfaces & Translucency", () => {
  let vfsCleanup: (() => void) | undefined;

  beforeEach(() => {
    const setup = setupWorkflowVirtualFs();
    vfsCleanup = setup.cleanup;
  });

  afterEach(() => {
    vfsCleanup?.();
    vfsCleanup = undefined;
  });

  it("evaluates 5+ deeply nested translucent glass layers without stack overflow or NaN values", () => {
    // Construct a 5-level deep hierarchy of translucent glass surfaces
    const level5: ElementPhysicsSnapshot = {
      selector:
        "div.glass-container > div.glass-l1 > div.glass-l2 > div.glass-l3 > span.glass-label",
      tagName: "SPAN",
      text: "Deep Glass Surface Content",
      bounds: { x: 140, y: 140, width: 200, height: 24 },
      computedStyles: {
        color: "#ffffff",
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        fontSize: 16,
        fontWeight: 500,
        borderRadius: 4,
        padding: 4,
        opacity: 0.9,
      },
      interactive: false,
    };

    const level4: ElementPhysicsSnapshot = {
      selector: "div.glass-container > div.glass-l1 > div.glass-l2 > div.glass-l3",
      tagName: "DIV",
      bounds: { x: 130, y: 130, width: 220, height: 40 },
      computedStyles: {
        backgroundColor: "rgba(255, 255, 255, 0.1)",
        borderRadius: 12,
        padding: 8,
        opacity: 0.85,
      },
      children: [level5],
    };

    const level3: ElementPhysicsSnapshot = {
      selector: "div.glass-container > div.glass-l1 > div.glass-l2",
      tagName: "DIV",
      bounds: { x: 120, y: 120, width: 240, height: 60 },
      computedStyles: {
        backgroundColor: "rgba(255, 255, 255, 0.08)",
        borderRadius: 20,
        padding: 8,
        opacity: 0.8,
      },
      children: [level4],
    };

    const level2: ElementPhysicsSnapshot = {
      selector: "div.glass-container > div.glass-l1",
      tagName: "DIV",
      bounds: { x: 110, y: 110, width: 260, height: 80 },
      computedStyles: {
        backgroundColor: "rgba(255, 255, 255, 0.05)",
        borderRadius: 28,
        padding: 8,
        opacity: 0.75,
      },
      children: [level3],
    };

    const level1: ElementPhysicsSnapshot = {
      selector: "div.glass-container",
      tagName: "DIV",
      bounds: { x: 100, y: 100, width: 280, height: 100 },
      computedStyles: {
        backgroundColor: "#000000",
        borderRadius: 36,
        padding: 8,
        opacity: 1.0,
      },
      children: [level2],
    };

    const ctx: ValidationContext = {
      screenId: "nested-glass-view",
      viewport: "desktop",
      elements: [level1, level2, level3, level4, level5],
      viewportBounds: { width: 1440, height: 900 },
    };

    const manifest = synthesizeCompanionManifest(ctx);
    expect(manifest.version).toBe("2.0");
    expect(manifest.screenId).toBe("nested-glass-view");
    expect(manifest.criteria.length).toBeGreaterThanOrEqual(4);
    expect(manifest.pillars.mechanical.passed).toBe(true);
    expect(manifest.pillars.cognitive.passed).toBe(true);
  });

  it("handles zero opacity and extreme alpha values in APCA contrast calculations", () => {
    // Text with pure black and pure white
    const whiteOnBlack = calculateApcaLightness(
      { r: 255, g: 255, b: 255, a: 1 },
      { r: 0, g: 0, b: 0, a: 1 },
    );
    expect(Math.abs(whiteOnBlack)).toBeGreaterThan(100);

    // Identical colors yield near-zero or zero contrast
    const blackOnBlack = calculateApcaLightness(
      { r: 0, g: 0, b: 0, a: 1 },
      { r: 0, g: 0, b: 0, a: 1 },
    );
    expect(Math.abs(blackOnBlack)).toBe(0);

    const whiteOnWhite = calculateApcaLightness(
      { r: 255, g: 255, b: 255, a: 1 },
      { r: 255, g: 255, b: 255, a: 1 },
    );
    expect(Math.abs(whiteOnWhite)).toBe(0);

    // Element with insufficient contrast (light gray text on white background)
    const lowContrastEl: ElementPhysicsSnapshot = {
      selector: "span.faint-text",
      tagName: "SPAN",
      text: "Faint Ghost Text",
      bounds: { x: 50, y: 50, width: 120, height: 20 },
      computedStyles: {
        color: "#d0d0d0",
        backgroundColor: "#ffffff",
        fontSize: 14,
        fontWeight: 400,
      },
    };

    const defect = validateApcaElement(lowContrastEl, 0);
    expect(defect).not.toBeNull();
    expect(defect?.pillar).toBe("mechanical");
    expect(defect?.category).toBe("apca-contrast");
    expect(defect?.severity).toBe("critical");
  });

  it("flags Material Design 3 state layer opacity deviations and handles extreme opacity values", () => {
    // Normal compliant state layers (hover 8%, focus 12%, pressed 12%, dragged 16%)
    const compliantEl: ElementPhysicsSnapshot = {
      selector: "button.md3-compliant",
      tagName: "BUTTON",
      bounds: { x: 10, y: 10, width: 100, height: 48 },
      stateLayers: {
        hover: 0.08,
        focus: 0.12,
        pressed: 0.12,
        dragged: 0.16,
      },
    };
    expect(validateMaterialStateLayers(compliantEl, 0)).toBeNull();

    // Adversarial: Extreme / non-compliant opacities (hover 60%, pressed 0%)
    const deviantEl: ElementPhysicsSnapshot = {
      selector: "button.md3-deviant",
      tagName: "BUTTON",
      bounds: { x: 10, y: 10, width: 100, height: 48 },
      stateLayers: {
        hover: 0.6,
        focus: 0.01,
        pressed: 0.0,
        dragged: 0.99,
      },
    };
    const defect = validateMaterialStateLayers(deviantEl, 1);
    expect(defect).not.toBeNull();
    expect(defect?.pillar).toBe("custom");
    expect(defect?.category).toBe("md3-state-layers");
    expect(defect?.severity).toBe("moderate");
    expect(defect?.message).toContain("hover opacity 60%");
  });

  it("evaluates floating UI collision with boundary padding and clipping bounds", () => {
    // Floating popover placed outside the viewport boundary (< 8px padding)
    const collidingEl: ElementPhysicsSnapshot = {
      selector: "div.popover-menu",
      tagName: "DIV",
      isFloating: true,
      bounds: { x: 2, y: 4, width: 300, height: 200 },
    };

    const defect = validateFloatingUiCollision(collidingEl, 0, { width: 1280, height: 800 });
    expect(defect).not.toBeNull();
    expect(defect?.pillar).toBe("custom");
    expect(defect?.category).toBe("floating-ui-collision");
    expect(defect?.severity).toBe("serious");
    expect(defect?.message).toContain("Floating element overflows viewport boundary");

    // Well-contained floating popover
    const safeEl: ElementPhysicsSnapshot = {
      selector: "div.popover-menu-safe",
      tagName: "DIV",
      isFloating: true,
      bounds: { x: 20, y: 20, width: 200, height: 100 },
    };
    expect(validateFloatingUiCollision(safeEl, 1, { width: 1280, height: 800 })).toBeNull();
  });
});
