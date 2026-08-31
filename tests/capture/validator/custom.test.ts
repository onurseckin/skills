import { describe, expect, it } from "bun:test";
import {
  getExpectedAppleTracking,
  validateAppleOpticalTracking,
} from "../../../olt/scripts/src/capture/validator/custom/apple-optical-tracking.ts";
import { validateFloatingUiCollision } from "../../../olt/scripts/src/capture/validator/custom/floating-ui-collision.ts";
import { validateGeistTokens } from "../../../olt/scripts/src/capture/validator/custom/geist-tokens.ts";
import { validateMaterialStateLayers } from "../../../olt/scripts/src/capture/validator/custom/material-state-layers.ts";
import { validateWaiAriaFocusTrap } from "../../../olt/scripts/src/capture/validator/custom/wai-aria-focus-trap.ts";
import { validateCustom } from "../../../olt/scripts/src/capture/validator/custom/index.ts";
import type {
  ElementPhysicsSnapshot,
  ValidationContext,
} from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Custom Validators", () => {
  describe("Apple Optical Tracking (validateAppleOpticalTracking & getExpectedAppleTracking)", () => {
    it("returns correct expected tracking ranges for all font size brackets", () => {
      // Bracket 1: <= 13
      const b1 = getExpectedAppleTracking(11);
      expect(b1.min).toBe(-0.05);
      expect(b1.max).toBe(0.4);
      expect(b1.expected).toBe(0.1);

      const b1Boundary = getExpectedAppleTracking(13);
      expect(b1Boundary.min).toBe(-0.05);
      expect(b1Boundary.max).toBe(0.4);

      // Bracket 2: <= 20
      const b2 = getExpectedAppleTracking(14);
      expect(b2.min).toBe(-0.5);
      expect(b2.max).toBe(0.2);
      expect(b2.expected).toBe(-0.2);

      const b2Boundary = getExpectedAppleTracking(20);
      expect(b2Boundary.min).toBe(-0.5);
      expect(b2Boundary.max).toBe(0.2);

      // Bracket 3: <= 34
      const b3 = getExpectedAppleTracking(21);
      expect(b3.min).toBe(-1.0);
      expect(b3.max).toBe(0.0);
      expect(b3.expected).toBe(-0.5);

      const b3Boundary = getExpectedAppleTracking(34);
      expect(b3Boundary.min).toBe(-1.0);
      expect(b3Boundary.max).toBe(0.0);

      // Bracket 4: > 34
      const b4 = getExpectedAppleTracking(48);
      expect(b4.min).toBe(-2.0);
      expect(b4.max).toBe(-0.2);
      expect(b4.expected).toBe(-1.0);
    });

    it("returns null if element has no styles, no fontSize, or no letterSpacing", () => {
      const elNoStyles: ElementPhysicsSnapshot = {
        selector: "span.text",
        tagName: "SPAN",
        bounds: { x: 0, y: 0, width: 100, height: 20 },
      };
      expect(validateAppleOpticalTracking(elNoStyles, 0)).toBeNull();

      const elNoFontSize: ElementPhysicsSnapshot = {
        selector: "span.text",
        tagName: "SPAN",
        bounds: { x: 0, y: 0, width: 100, height: 20 },
        computedStyles: { letterSpacing: 0 },
      };
      expect(validateAppleOpticalTracking(elNoFontSize, 0)).toBeNull();

      const elNoTracking: ElementPhysicsSnapshot = {
        selector: "span.text",
        tagName: "SPAN",
        bounds: { x: 0, y: 0, width: 100, height: 20 },
        computedStyles: { fontSize: 16 },
      };
      expect(validateAppleOpticalTracking(elNoTracking, 0)).toBeNull();
    });

    it("returns null if element is not in Apple font context and has no design-system attribute", () => {
      const elRoboto: ElementPhysicsSnapshot = {
        selector: "span.text",
        tagName: "SPAN",
        bounds: { x: 0, y: 0, width: 100, height: 20 },
        computedStyles: {
          fontSize: 16,
          letterSpacing: 2.0, // out of range but not apple font
          fontFamily: "Roboto, sans-serif",
        },
      };
      expect(validateAppleOpticalTracking(elRoboto, 0)).toBeNull();
    });

    it("detects apple fonts: SF Pro, apple-system, blinkmacsystemfont, or data-design-system=apple-hig", () => {
      const fonts = ["SF Pro Display", "-apple-system, sans-serif", "BlinkMacSystemFont, Segoe UI"];
      for (const font of fonts) {
        const elApple: ElementPhysicsSnapshot = {
          selector: "h1.apple-header",
          tagName: "H1",
          bounds: { x: 0, y: 0, width: 200, height: 40 },
          computedStyles: {
            fontSize: 32,
            letterSpacing: -0.5, // valid for 32px (-1.0 to 0.0)
            fontFamily: font,
          },
        };
        expect(validateAppleOpticalTracking(elApple, 0)).toBeNull();
      }

      // data-design-system = apple-hig
      const elHig: ElementPhysicsSnapshot = {
        selector: "h1.apple-header",
        tagName: "H1",
        bounds: { x: 0, y: 0, width: 200, height: 40 },
        attributes: { "data-design-system": "apple-hig" },
        computedStyles: {
          fontSize: 32,
          letterSpacing: -0.5,
        },
      };
      expect(validateAppleOpticalTracking(elHig, 0)).toBeNull();
    });

    it("evaluates elements with generic data-design-system even if not Apple font", () => {
      const elCustomDs: ElementPhysicsSnapshot = {
        selector: "h1.header",
        tagName: "H1",
        bounds: { x: 0, y: 0, width: 200, height: 40 },
        attributes: { "data-design-system": "custom-system" },
        computedStyles: {
          fontSize: 12,
          letterSpacing: 1.5, // exceeds max 0.4
          fontFamily: "Inter, sans-serif",
        },
      };
      const defect = validateAppleOpticalTracking(elCustomDs, 1);
      expect(defect).not.toBeNull();
      expect(defect?.category).toBe("apple-hig-tracking");
    });

    it("returns defect when actual tracking is below min or above max", () => {
      // Under min: fontSize 12, tracking -0.2 (min is -0.05)
      const elUnder: ElementPhysicsSnapshot = {
        selector: "p.body",
        tagName: "P",
        bounds: { x: 0, y: 0, width: 100, height: 20 },
        computedStyles: {
          fontSize: 12,
          letterSpacing: -0.2,
          fontFamily: "SF Pro Text",
        },
      };
      const defectUnder = validateAppleOpticalTracking(elUnder, 2);
      expect(defectUnder).not.toBeNull();
      expect(defectUnder?.id).toBe("cust-apple-tracking-2");
      expect(defectUnder?.pillar).toBe("custom");
      expect(defectUnder?.severity).toBe("minor");
      expect(defectUnder?.metadata?.actualTracking).toBe(-0.2);
      expect(defectUnder?.metadata?.expectedMin).toBe(-0.05);
      expect(defectUnder?.remediations.length).toBeGreaterThan(0);

      // Over max: fontSize 40, tracking 0.5 (max is -0.2)
      const elOver: ElementPhysicsSnapshot = {
        selector: "h1.hero",
        tagName: "H1",
        bounds: { x: 0, y: 0, width: 300, height: 50 },
        computedStyles: {
          fontSize: 40,
          letterSpacing: 0.5,
          fontFamily: "-apple-system",
        },
      };
      const defectOver = validateAppleOpticalTracking(elOver, 3);
      expect(defectOver).not.toBeNull();
      expect(defectOver?.id).toBe("cust-apple-tracking-3");
      expect(defectOver?.metadata?.actualTracking).toBe(0.5);
      expect(defectOver?.metadata?.expectedMax).toBe(-0.2);
    });
  });

  describe("Floating UI Collision (validateFloatingUiCollision)", () => {
    it("returns null for non-floating elements", () => {
      const elNormal: ElementPhysicsSnapshot = {
        selector: "div.container",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      };
      expect(validateFloatingUiCollision(elNormal, 0)).toBeNull();
    });

    it("identifies floating elements by isFloating, role, or selector", () => {
      const selectors = ["div.popover-card", "span.tooltip-label", "ul.dropdown-menu-list"];
      for (const sel of selectors) {
        const el: ElementPhysicsSnapshot = {
          selector: sel,
          tagName: "DIV",
          bounds: { x: 50, y: 50, width: 200, height: 100 },
        };
        // Inside bounds: passes
        expect(validateFloatingUiCollision(el, 0)).toBeNull();
      }

      const elByRole: ElementPhysicsSnapshot = {
        selector: "div.custom",
        tagName: "DIV",
        role: "tooltip",
        bounds: { x: 50, y: 50, width: 200, height: 100 },
      };
      expect(validateFloatingUiCollision(elByRole, 0)).toBeNull();

      const elByFlag: ElementPhysicsSnapshot = {
        selector: "div.custom-floating",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 50, y: 50, width: 200, height: 100 },
      };
      expect(validateFloatingUiCollision(elByFlag, 0)).toBeNull();
    });

    it("detects viewport boundary collisions on left, top, right, and bottom", () => {
      const vp = { width: 1000, height: 600 };

      // Left collision: x < 8
      const elLeft: ElementPhysicsSnapshot = {
        selector: "div.popover-left",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 4, y: 100, width: 150, height: 50 },
      };
      const defLeft = validateFloatingUiCollision(elLeft, 1, vp);
      expect(defLeft).not.toBeNull();
      expect(defLeft?.id).toBe("cust-floating-collision-1");
      expect(defLeft?.severity).toBe("serious");
      expect(defLeft?.message).toContain("left edge");

      // Top collision: y < 8
      const elTop: ElementPhysicsSnapshot = {
        selector: "div.popover-top",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 100, y: 2, width: 150, height: 50 },
      };
      const defTop = validateFloatingUiCollision(elTop, 2, vp);
      expect(defTop).not.toBeNull();
      expect(defTop?.message).toContain("top edge");

      // Right collision: x + width > 1000 - 8 (992)
      const elRight: ElementPhysicsSnapshot = {
        selector: "div.popover-right",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 900, y: 100, width: 100, height: 50 }, // 1000 > 992
      };
      const defRight = validateFloatingUiCollision(elRight, 3, vp);
      expect(defRight).not.toBeNull();
      expect(defRight?.message).toContain("right edge");

      // Bottom collision: y + height > 600 - 8 (592)
      const elBottom: ElementPhysicsSnapshot = {
        selector: "div.popover-bottom",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 100, y: 560, width: 150, height: 50 }, // 610 > 592
      };
      const defBottom = validateFloatingUiCollision(elBottom, 4, vp);
      expect(defBottom).not.toBeNull();
      expect(defBottom?.message).toContain("bottom edge");
    });

    it("uses fallback 1280x800 viewport bounds when omitted", () => {
      const elRightDefault: ElementPhysicsSnapshot = {
        selector: "div.popover-default",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 1250, y: 100, width: 50, height: 50 }, // 1300 > 1272
      };
      const defect = validateFloatingUiCollision(elRightDefault, 5);
      expect(defect).not.toBeNull();
      expect(defect?.message).toContain("right edge");
    });

    it("detects clipping container boundary overflows", () => {
      const elClippedX: ElementPhysicsSnapshot = {
        selector: "div.popover-clipped",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 50, y: 50, width: 200, height: 100 },
        clippingBounds: { x: 60, y: 40, width: 300, height: 300 }, // x 50 < clip.x 60
      };
      const defX = validateFloatingUiCollision(elClippedX, 6);
      expect(defX).not.toBeNull();
      expect(defX?.message).toContain("clipping boundary overflow");

      const elClippedY: ElementPhysicsSnapshot = {
        selector: "div.popover-clipped-y",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 100, y: 30, width: 100, height: 100 },
        clippingBounds: { x: 50, y: 50, width: 300, height: 300 }, // y 30 < clip.y 50
      };
      const defY = validateFloatingUiCollision(elClippedY, 7);
      expect(defY).not.toBeNull();

      const elClippedW: ElementPhysicsSnapshot = {
        selector: "div.popover-clipped-w",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 100, y: 100, width: 300, height: 100 }, // 400 > 50+300 = 350
        clippingBounds: { x: 50, y: 50, width: 300, height: 300 },
      };
      const defW = validateFloatingUiCollision(elClippedW, 8);
      expect(defW).not.toBeNull();

      const elClippedH: ElementPhysicsSnapshot = {
        selector: "div.popover-clipped-h",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 100, y: 100, width: 100, height: 300 }, // 400 > 50+300 = 350
        clippingBounds: { x: 50, y: 50, width: 300, height: 300 },
      };
      const defH = validateFloatingUiCollision(elClippedH, 9);
      expect(defH).not.toBeNull();
    });
  });

  describe("Geist Tokens (validateGeistTokens)", () => {
    it("returns null if element has no styles", () => {
      const el: ElementPhysicsSnapshot = {
        selector: "div.card",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      };
      expect(validateGeistTokens(el, 0)).toBeNull();
    });

    it("returns null if element is not in Geist context and has no design-system attribute", () => {
      const el: ElementPhysicsSnapshot = {
        selector: "div.standard-card",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: {
          borderRadius: 7, // Not a Geist radius, but not Geist context
          fontFamily: "Arial, sans-serif",
        },
      };
      expect(validateGeistTokens(el, 0)).toBeNull();
    });

    it("identifies Geist context by data-design-system, fontFamily, or selector", () => {
      // By attribute
      const elAttr: ElementPhysicsSnapshot = {
        selector: "div.card",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        attributes: { "data-design-system": "geist" },
        computedStyles: { borderRadius: 8 }, // Allowed
      };
      expect(validateGeistTokens(elAttr, 0)).toBeNull();

      // By font family
      const elFont: ElementPhysicsSnapshot = {
        selector: "div.card",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: {
          fontFamily: "Geist Sans, sans-serif",
          borderRadius: 6, // Allowed
        },
      };
      expect(validateGeistTokens(elFont, 0)).toBeNull();

      // By selector
      const elSel: ElementPhysicsSnapshot = {
        selector: "div.geist-badge",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: { borderRadius: 9999 }, // Allowed full pill
      };
      expect(validateGeistTokens(elSel, 0)).toBeNull();
    });

    it("allows valid Geist token radii [0, 4, 6, 8, 12, 16, 24, 9999]", () => {
      const allowed = [0, 4, 6, 8, 12, 16, 24, 9999];
      for (const r of allowed) {
        const el: ElementPhysicsSnapshot = {
          selector: "div.geist-box",
          tagName: "DIV",
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          computedStyles: { borderRadius: r },
        };
        expect(validateGeistTokens(el, 0)).toBeNull();
      }

      // undefined radius
      const elUndef: ElementPhysicsSnapshot = {
        selector: "div.geist-box",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: {},
      };
      expect(validateGeistTokens(elUndef, 0)).toBeNull();
    });

    it("returns defect for non-standard border radius in Geist context", () => {
      const elBad: ElementPhysicsSnapshot = {
        selector: "div.geist-card",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: { borderRadius: 10 },
      };
      const defect = validateGeistTokens(elBad, 1);
      expect(defect).not.toBeNull();
      expect(defect?.id).toBe("cust-geist-tokens-1");
      expect(defect?.pillar).toBe("custom");
      expect(defect?.category).toBe("geist-tokens");
      expect(defect?.severity).toBe("minor");
      expect(defect?.metadata?.actualRadius).toBe(10);
    });
  });

  describe("Material Design 3 State Layers (validateMaterialStateLayers)", () => {
    it("returns null if element has no stateLayers", () => {
      const el: ElementPhysicsSnapshot = {
        selector: "button.btn",
        tagName: "BUTTON",
        bounds: { x: 0, y: 0, width: 100, height: 40 },
      };
      expect(validateMaterialStateLayers(el, 0)).toBeNull();
    });

    it("returns null when all state layers are within MD3 specs", () => {
      const el: ElementPhysicsSnapshot = {
        selector: "button.md3-button",
        tagName: "BUTTON",
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        stateLayers: {
          hover: 0.08,
          focus: 0.12,
          pressed: 0.12,
          dragged: 0.16,
        },
      };
      expect(validateMaterialStateLayers(el, 0)).toBeNull();
    });

    it("returns defect when hover opacity deviates from 6%-10%", () => {
      const elUnder: ElementPhysicsSnapshot = {
        selector: "button.md3-button-under",
        tagName: "BUTTON",
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        stateLayers: { hover: 0.04 },
      };
      const defUnder = validateMaterialStateLayers(elUnder, 1);
      expect(defUnder).not.toBeNull();
      expect(defUnder?.id).toBe("cust-md3-layers-1");
      expect(defUnder?.severity).toBe("moderate");
      expect(defUnder?.message).toContain("hover opacity 4%");

      const elOver: ElementPhysicsSnapshot = {
        selector: "button.md3-button-over",
        tagName: "BUTTON",
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        stateLayers: {
          focus: 0.2,
          pressed: 0.05,
          dragged: 0.25,
        },
      };
      const defOver = validateMaterialStateLayers(elOver, 2);
      expect(defOver).not.toBeNull();
      expect(defOver?.message).toContain("focus opacity 20%");
      expect(defOver?.message).toContain("pressed opacity 5%");
      expect(defOver?.message).toContain("dragged opacity 25%");
    });
  });

  describe("WAI-ARIA Focus Trap & Roving Tabindex (validateWaiAriaFocusTrap)", () => {
    it("returns null for non-dialog non-composite elements", () => {
      const el: ElementPhysicsSnapshot = {
        selector: "div.content",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      };
      expect(validateWaiAriaFocusTrap(el, 0)).toBeNull();
    });

    it("validates modal dialogs (role=dialog, alertdialog, tag=DIALOG)", () => {
      // Valid modal with aria-modal="true"
      const elModalValid: ElementPhysicsSnapshot = {
        selector: "div.modal-dialog",
        tagName: "DIV",
        role: "dialog",
        attributes: { "aria-modal": "true" },
        bounds: { x: 100, y: 100, width: 400, height: 300 },
      };
      expect(validateWaiAriaFocusTrap(elModalValid, 0)).toBeNull();

      // Valid modal with hasTrapFocus=true
      const elTrapValid: ElementPhysicsSnapshot = {
        selector: "dialog.native-modal",
        tagName: "DIALOG",
        hasTrapFocus: true,
        bounds: { x: 100, y: 100, width: 400, height: 300 },
      };
      expect(validateWaiAriaFocusTrap(elTrapValid, 0)).toBeNull();

      // Alert dialog missing both
      const elAlertDialog: ElementPhysicsSnapshot = {
        selector: "div.alert-box",
        tagName: "DIV",
        role: "alertdialog",
        bounds: { x: 100, y: 100, width: 400, height: 300 },
      };
      const defAlert = validateWaiAriaFocusTrap(elAlertDialog, 1);
      expect(defAlert).not.toBeNull();
      expect(defAlert?.id).toBe("cust-aria-trap-1");
      expect(defAlert?.severity).toBe("critical");
      expect(defAlert?.metadata?.role).toBe("alertdialog");

      // Dialog element missing both
      const elDialogTag: ElementPhysicsSnapshot = {
        selector: "dialog.flawed",
        tagName: "DIALOG",
        bounds: { x: 100, y: 100, width: 400, height: 300 },
      };
      const defTag = validateWaiAriaFocusTrap(elDialogTag, 2);
      expect(defTag).not.toBeNull();
      expect(defTag?.metadata?.role).toBe("DIALOG");
    });

    it("validates composite interactive widgets (tablist, menu, menubar, radiogroup, grid, tree)", () => {
      const roles = ["tablist", "menu", "menubar", "radiogroup", "grid", "tree"];

      for (const role of roles) {
        // Valid with roving tabindex
        const elRoving: ElementPhysicsSnapshot = {
          selector: `div.${role}-widget`,
          tagName: "DIV",
          role,
          hasRovingTabindex: true,
          bounds: { x: 0, y: 0, width: 300, height: 50 },
        };
        expect(validateWaiAriaFocusTrap(elRoving, 0)).toBeNull();

        // Valid with aria-activedescendant
        const elActiveDesc: ElementPhysicsSnapshot = {
          selector: `div.${role}-widget-desc`,
          tagName: "DIV",
          role,
          attributes: { "aria-activedescendant": "item-1" },
          bounds: { x: 0, y: 0, width: 300, height: 50 },
        };
        expect(validateWaiAriaFocusTrap(elActiveDesc, 0)).toBeNull();

        // Flawed: missing both
        const elFlawed: ElementPhysicsSnapshot = {
          selector: `div.${role}-flawed`,
          tagName: "DIV",
          role,
          bounds: { x: 0, y: 0, width: 300, height: 50 },
        };
        const def = validateWaiAriaFocusTrap(elFlawed, 3);
        expect(def).not.toBeNull();
        expect(def?.id).toBe("cust-aria-roving-3");
        expect(def?.severity).toBe("serious");
        expect(def?.metadata?.role).toBe(role);
      }
    });
  });

  describe("Custom Pillar Aggregate (validateCustom)", () => {
    it("evaluates empty elements list cleanly", () => {
      const ctx: ValidationContext = {
        screenId: "test",
        viewport: "desktop",
        elements: [],
      };
      const res = validateCustom(ctx);
      expect(res.pillar).toBe("custom");
      expect(res.passed).toBe(true);
      expect(res.defects.length).toBe(0);
      expect(res.evaluatedCount).toBe(0);
    });

    it("handles undefined slots and accumulates all custom defects across elements", () => {
      const elements: (ElementPhysicsSnapshot | undefined)[] = [
        undefined, // covers if (!el) continue
        {
          selector: "dialog.modal",
          tagName: "DIALOG",
          bounds: { x: 0, y: 0, width: 100, height: 100 },
        },
        {
          selector: "div.popover-overflow",
          tagName: "DIV",
          isFloating: true,
          bounds: { x: -10, y: 0, width: 100, height: 100 },
        },
        {
          selector: "button.md3-bad",
          tagName: "BUTTON",
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          stateLayers: { hover: 0.5 },
        },
        {
          selector: "h1.apple-bad",
          tagName: "H1",
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          computedStyles: {
            fontSize: 12,
            letterSpacing: 2.0,
            fontFamily: "SF Pro Text",
          },
        },
        {
          selector: "div.geist-bad",
          tagName: "DIV",
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          computedStyles: {
            fontFamily: "Geist Sans",
            borderRadius: 7,
          },
        },
      ];

      const ctx: ValidationContext = {
        screenId: "custom_screen",
        viewport: "desktop",
        elements: elements as unknown as ElementPhysicsSnapshot[],
      };

      const res = validateCustom(ctx);
      expect(res.pillar).toBe("custom");
      expect(res.passed).toBe(false);
      expect(res.evaluatedCount).toBe(elements.length);
      expect(res.defects.length).toBe(5);

      const categories = res.defects.map((d) => d.category);
      expect(categories).toContain("aria-focus-trap");
      expect(categories).toContain("floating-ui-collision");
      expect(categories).toContain("md3-state-layers");
      expect(categories).toContain("apple-hig-tracking");
      expect(categories).toContain("geist-tokens");
    });
  });
});
