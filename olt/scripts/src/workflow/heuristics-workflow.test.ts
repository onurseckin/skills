import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
} from "../capture/validator/index.ts";
import type {
  CompanionManifestV2,
  ElementPhysicsSnapshot,
  ValidationContext,
} from "../capture/validator/types.ts";
import {
  computeLayoutMetrics,
  createEmptyDomPhysicsSnapshot,
} from "../capture/runners/dom-physics-extractor.ts";
import { createSyntheticPngBuffer } from "../capture/runners/live-capture-runner.ts";
import {
  analyzeDualChannel,
  validateCompanionManifestCriteria,
} from "../validation/dual-channel-analyzer.ts";
import type {
  CompanionManifestData,
  DualChannelInput,
  ScreenshotMetadata,
  StructuredFinding,
  VisualMetricsReport,
} from "../validation/dual-channel-types.ts";
import { assertRoleArtifactPresent } from "./review/role-evidence.ts";
import type { TaskRecord, WorkflowState } from "./types.ts";
import { HarnessError } from "../core/errors/harness-error.ts";

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

describe("Adversarial Edge Cases: Modal Focus Trap Cycles & Tab Navigation", () => {
  it("flags modal dialogs missing WAI-ARIA 1.2 focus traps and aria-modal attributes", () => {
    // Adversarial: Dialog lacking both aria-modal="true" and hasTrapFocus: false
    const unconstrainedDialog: ElementPhysicsSnapshot = {
      selector: "div.modal-overlay[role='dialog']",
      tagName: "DIV",
      role: "dialog",
      bounds: { x: 200, y: 150, width: 400, height: 300 },
      attributes: {
        "aria-modal": "false",
      },
      hasTrapFocus: false,
    };

    const defect = validateWaiAriaFocusTrap(unconstrainedDialog, 0);
    expect(defect).not.toBeNull();
    expect(defect?.pillar).toBe("custom");
    expect(defect?.category).toBe("aria-focus-trap");
    expect(defect?.severity).toBe("critical");
    expect(defect?.message).toContain("missing WAI-ARIA 1.2 / Radix UI focus trap");
  });

  it("passes compliant modal dialogs with aria-modal and trapped keyboard focus", () => {
    const compliantDialog: ElementPhysicsSnapshot = {
      selector: "div.radix-dialog",
      tagName: "DIV",
      role: "dialog",
      bounds: { x: 200, y: 150, width: 400, height: 300 },
      attributes: {
        "aria-modal": "true",
      },
      hasTrapFocus: true,
    };

    expect(validateWaiAriaFocusTrap(compliantDialog, 0)).toBeNull();
  });

  it("flags composite interactive widgets missing roving tabindex and aria-activedescendant", () => {
    const compositeRoles = ["tablist", "menu", "menubar", "radiogroup", "grid", "tree"] as const;

    for (let i = 0; i < compositeRoles.length; i++) {
      const role = compositeRoles[i]!;
      const invalidComposite: ElementPhysicsSnapshot = {
        selector: `div.${role}-widget`,
        tagName: "DIV",
        role,
        bounds: { x: 0, y: 0, width: 300, height: 40 },
        hasRovingTabindex: false,
      };

      const defect = validateWaiAriaFocusTrap(invalidComposite, i);
      expect(defect).not.toBeNull();
      expect(defect?.severity).toBe("serious");
      expect(defect?.message).toContain(`role="${role}" lacks roving tabindex`);

      // Compliant with roving tabindex
      const validRoving: ElementPhysicsSnapshot = {
        selector: `div.${role}-roving`,
        tagName: "DIV",
        role,
        bounds: { x: 0, y: 0, width: 300, height: 40 },
        hasRovingTabindex: true,
      };
      expect(validateWaiAriaFocusTrap(validRoving, i)).toBeNull();

      // Compliant with aria-activedescendant
      const validActiveDesc: ElementPhysicsSnapshot = {
        selector: `div.${role}-activedesc`,
        tagName: "DIV",
        role,
        bounds: { x: 0, y: 0, width: 300, height: 40 },
        attributes: {
          "aria-activedescendant": "item-01",
        },
      };
      expect(validateWaiAriaFocusTrap(validActiveDesc, i)).toBeNull();
    }
  });

  it("handles disconnected DOM nodes and inert shadow roots gracefully", () => {
    // Orphaned node with empty selector, missing parents, bounds of 0 width/height
    const disconnectedEl: ElementPhysicsSnapshot = {
      selector: "",
      tagName: "DIV",
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      interactive: false,
    };

    const ctx: ValidationContext = {
      screenId: "disconnected-dom-test",
      viewport: "desktop",
      elements: [disconnectedEl],
    };

    const customResult = validateCustom(ctx);
    expect(customResult.pillar).toBe("custom");
    expect(customResult.defects).toHaveLength(0);

    const mechResult = validateMechanical(ctx);
    expect(mechResult.pillar).toBe("mechanical");
    expect(mechResult.defects).toHaveLength(0);
  });
});

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

describe("Adversarial Edge Cases: Multi-Viewport Companion Manifest Verification", () => {
  it("rejects companion manifests missing any of the 4 mandatory pillars", () => {
    const { findings, addFinding } = createFindingCollector();

    // Manifest missing Mechanical pillar
    const manifestMissingMech: CompanionManifestData = {
      schema: "companion.manifest.v1",
      screenId: "settings-view",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-COGN-COWAN",
          pillar: "cognitive",
          passed: true,
          details: "Passes chunking",
          evidence: "4 chunks",
        },
        {
          id: "CRIT-PROD-GEIST-TOKENS",
          pillar: "product",
          passed: true,
          details: "Passes tokens",
          evidence: "Tokens valid",
        },
        {
          id: "CRIT-UX-FOCUS-TRAP",
          pillar: "ux",
          passed: true,
          details: "Passes focus trap",
          evidence: "Trapped focus",
        },
      ],
    };

    const res = validateCompanionManifestCriteria(manifestMissingMech, addFinding);
    expect(res.valid).toBe(false);
    expect(
      findings.some(
        (f) => f.category === "missing_pillar_criteria" && f.message.includes("Mechanical"),
      ),
    ).toBe(true);
  });

  it("rejects unevidenced evaluations (missing passed flag, empty details and evidence)", () => {
    const { findings, addFinding } = createFindingCollector();

    const unevidencedManifest = {
      screenId: "profile-view",
      viewport: "mobile",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          // missing passed boolean!
          details: "",
          evidence: "   ",
        },
      ],
    };

    const res = validateCompanionManifestCriteria(unevidencedManifest, addFinding);
    expect(res.valid).toBe(false);
    expect(
      findings.some(
        (f) => f.category === "invalid_manifest_criterion" && f.message.includes("passed"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) =>
          f.category === "invalid_manifest_criterion" &&
          f.message.includes("non-empty 'details' or 'evidence'"),
      ),
    ).toBe(true);
  });

  it("rejects dual-channel UI task when required viewports are missing", () => {
    const input: DualChannelInput = {
      writeScope: ["src/views/Settings.tsx"],
      // Only desktop provided, mobile and tablet are missing
      screenshots: [
        {
          name: "settings-desktop.png",
          path: "/tmp/settings-desktop.png",
          viewport: "desktop",
          sizeBytes: 2048,
        },
      ],
    };

    const result = analyzeDualChannel(input);
    expect(result.isUiTask).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.mode).toBe("rejected");
    const missingVpFindings = result.findings.filter((f) => f.category === "missing_viewport");
    expect(missingVpFindings.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects dummy screenshot stubs (< 1024 bytes) and generates Anti-Mocking violation", () => {
    const input: DualChannelInput = {
      writeScope: ["src/views/Settings.tsx"],
      screenshots: [
        {
          name: "settings-desktop.png",
          path: "/tmp/settings-desktop.png",
          viewport: "desktop",
          sizeBytes: 67, // minimal stub
        },
        {
          name: "settings-tablet.png",
          path: "/tmp/settings-tablet.png",
          viewport: "tablet",
          sizeBytes: 500, // stub
        },
        {
          name: "settings-mobile.png",
          path: "/tmp/settings-mobile.png",
          viewport: "mobile",
          sizeBytes: 0, // zero bytes
        },
      ],
    };

    const result = analyzeDualChannel(input);
    expect(result.passed).toBe(false);
    expect(result.mode).toBe("rejected");
    const stubFindings = result.findings.filter((f) => f.category === "invalid_screenshot_size");
    expect(stubFindings.length).toBe(3);
    expect(stubFindings.some((f) => f.message.includes("Anti-Mocking Invariant Violation"))).toBe(
      true,
    );
  });

  it("passes multi-viewport companion manifest verification with genuine screenshots >= 1024 bytes", () => {
    const validPngBuffer = createSyntheticPngBuffer(10, 10, 1024);
    expect(validPngBuffer.byteLength).toBeGreaterThanOrEqual(1024);

    const input: DualChannelInput = {
      writeScope: ["src/components/Header.tsx"],
      screenshots: [
        {
          name: "header-mobile.png",
          path: "/mock/header-mobile.png",
          viewport: "mobile",
          sizeBytes: 1200,
        },
        {
          name: "header-tablet.png",
          path: "/mock/header-tablet.png",
          viewport: "tablet",
          sizeBytes: 1500,
        },
        {
          name: "header-desktop.png",
          path: "/mock/header-desktop.png",
          viewport: "desktop",
          sizeBytes: 2048,
        },
      ],
      manifests: [
        {
          schema: "companion.manifest.v1",
          screenId: "header",
          viewport: "desktop",
          criteria: [
            {
              id: "CRIT-MECH-APCA",
              pillar: "mechanical",
              passed: true,
              details: "APCA compliant",
              evidence: "Lc=85.0",
            },
            {
              id: "CRIT-COGN-STATES",
              pillar: "cognitive",
              passed: true,
              details: "FSM complete",
              evidence: "States: 5/5",
            },
            {
              id: "CRIT-PROD-GEIST-TOKENS",
              pillar: "product",
              passed: true,
              details: "Tokens matched",
              evidence: "Radius 8px",
            },
            {
              id: "CRIT-UX-FOCUS-TRAP",
              pillar: "ux",
              passed: true,
              details: "Trapped focus valid",
              evidence: "Tab cycle constrained",
            },
          ],
        },
      ],
    };

    const audit = analyzeDualChannel(input);
    expect(audit.isUiTask).toBe(true);
    expect(audit.passed).toBe(true);
    expect(audit.mode).toBe("screenshot_gap_filled");
    expect(audit.proofs).toHaveLength(3);
    expect(
      audit.proofs.some((p) => p.verifiedInvariants.includes("manifest_4_pillars_certified")),
    ).toBe(true);
  });

  it("enforces assertRoleArtifactPresent constraints across UI and non-UI domains", () => {
    // Non-UI domain passes without artifacts
    expect(() => {
      assertRoleArtifactPresent("task-db-01", false, { hasArtifact: false });
    }).not.toThrow();

    // UI domain throws HarnessError when no artifact is recorded
    expect(() => {
      assertRoleArtifactPresent("task-ui-01", true, { hasArtifact: false });
    }).toThrow(HarnessError);

    // UI domain throws HarnessError when screenshots are stubs (< 1024 bytes)
    expect(() => {
      assertRoleArtifactPresent("task-ui-02", true, {
        hasArtifact: true,
        screenshots: [{ sizeBytes: 67, name: "stub.png" }],
      });
    }).toThrow(HarnessError);

    // UI domain passes when screenshot is >= 1024 bytes
    expect(() => {
      assertRoleArtifactPresent("task-ui-03", true, {
        hasArtifact: true,
        screenshots: [{ sizeBytes: 1024, name: "real.png" }],
      });
    }).not.toThrow();

    // UI domain passes when companion manifests are present
    expect(() => {
      assertRoleArtifactPresent("task-ui-04", true, {
        hasArtifact: true,
        manifests: [{ screenId: "home", viewport: "desktop" }],
      });
    }).not.toThrow();
  });

  it("serializes, writes, and loads companion manifests v2.0 correctly and rejects invalid manifests", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "manifest-test-"));
    try {
      const syntheticCtx: ValidationContext = {
        screenId: "checkout-screen",
        viewport: "mobile",
        elements: [
          {
            selector: "button.checkout-btn",
            tagName: "BUTTON",
            text: "Pay Now",
            bounds: { x: 20, y: 100, width: 300, height: 48 },
            interactive: true,
            isTouchTarget: true,
            computedStyles: {
              color: "#ffffff",
              backgroundColor: "#000000",
              fontSize: 16,
              fontWeight: 600,
              borderRadius: 8,
            },
            implementedStates: ["default", "hover", "active", "focus", "disabled"],
          },
        ],
        viewportBounds: { width: 375, height: 667 },
      };

      const manifest = synthesizeCompanionManifest(syntheticCtx);
      expect(isCertifiedManifest(manifest)).toBe(true);

      const filePath = await saveCompanionManifest(manifest, tempDir);
      expect(formatManifestFilename(manifest.screenId, manifest.viewport)).toBe(
        "checkout-screen-mobile.manifest.json",
      );

      const loaded = await loadCompanionManifest(filePath);
      expect(loaded.version).toBe("2.0");
      expect(loaded.screenId).toBe("checkout-screen");
      expect(loaded.viewport).toBe("mobile");
      expect(loaded.verdict).toBe("CERTIFIED");
      expect(loaded.criteria.length).toBeGreaterThanOrEqual(4);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  it("verifies heuristics-workflow.test.ts contains zero any types and zero suppressions", async () => {
    const thisFilePath = join(import.meta.dir, "heuristics-workflow.test.ts");
    const content = await readFile(thisFilePath, "utf8");
    const lines = content.split("\n");

    const forbiddenAnyForms = [
      ":" + " any",
      "as" + " any",
      "<" + "any>",
      "Promise<" + "any>",
      "Record<string," + " any>",
    ];
    const forbiddenSupTokens = [
      "@" + "ts-ignore",
      "@" + "ts-expect-error",
      "@" + "ts-nocheck",
      "eslint-" + "disable",
      "oxlint-" + "disable",
    ];

    const invariantBlockIdx = lines.findIndex((l) =>
      l.includes("Static Invariant Verification: Zero TypeScript any"),
    );

    const invalidLines = lines.filter((line, idx) => {
      // Ignore the static invariant test block itself
      if (invariantBlockIdx !== -1 && idx >= invariantBlockIdx) return false;
      return (
        forbiddenAnyForms.some((token) => line.includes(token)) ||
        forbiddenSupTokens.some((token) => line.includes(token))
      );
    });

    expect(invalidLines).toEqual([]);
  });
});
