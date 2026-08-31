import { describe, expect, it } from "bun:test";
import { validateFloatingUiCollision } from "../../../olt/scripts/src/capture/validator/custom/floating-ui-collision.ts";
import { validateMaterialStateLayers } from "../../../olt/scripts/src/capture/validator/custom/material-state-layers.ts";
import { validateWaiAriaFocusTrap } from "../../../olt/scripts/src/capture/validator/custom/wai-aria-focus-trap.ts";
import type { ElementPhysicsSnapshot } from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Custom Validators: Floating UI, MD3 Layers & WAI-ARIA Focus Trap", () => {
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

      const elTop: ElementPhysicsSnapshot = {
        selector: "div.popover-top",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 100, y: 2, width: 150, height: 50 },
      };
      const defTop = validateFloatingUiCollision(elTop, 2, vp);
      expect(defTop).not.toBeNull();
      expect(defTop?.message).toContain("top edge");

      const elRight: ElementPhysicsSnapshot = {
        selector: "div.popover-right",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 900, y: 100, width: 100, height: 50 },
      };
      const defRight = validateFloatingUiCollision(elRight, 3, vp);
      expect(defRight).not.toBeNull();
      expect(defRight?.message).toContain("right edge");

      const elBottom: ElementPhysicsSnapshot = {
        selector: "div.popover-bottom",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 100, y: 560, width: 150, height: 50 },
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
        bounds: { x: 1250, y: 100, width: 50, height: 50 },
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
        clippingBounds: { x: 60, y: 40, width: 300, height: 300 },
      };
      const defX = validateFloatingUiCollision(elClippedX, 6);
      expect(defX).not.toBeNull();
      expect(defX?.message).toContain("clipping boundary overflow");

      const elClippedY: ElementPhysicsSnapshot = {
        selector: "div.popover-clipped-y",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 100, y: 30, width: 100, height: 100 },
        clippingBounds: { x: 50, y: 50, width: 300, height: 300 },
      };
      const defY = validateFloatingUiCollision(elClippedY, 7);
      expect(defY).not.toBeNull();

      const elClippedW: ElementPhysicsSnapshot = {
        selector: "div.popover-clipped-w",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 100, y: 100, width: 300, height: 100 },
        clippingBounds: { x: 50, y: 50, width: 300, height: 300 },
      };
      const defW = validateFloatingUiCollision(elClippedW, 8);
      expect(defW).not.toBeNull();

      const elClippedH: ElementPhysicsSnapshot = {
        selector: "div.popover-clipped-h",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 100, y: 100, width: 100, height: 300 },
        clippingBounds: { x: 50, y: 50, width: 300, height: 300 },
      };
      const defH = validateFloatingUiCollision(elClippedH, 9);
      expect(defH).not.toBeNull();
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
      const elModalValid: ElementPhysicsSnapshot = {
        selector: "div.modal-dialog",
        tagName: "DIV",
        role: "dialog",
        attributes: { "aria-modal": "true" },
        bounds: { x: 100, y: 100, width: 400, height: 300 },
      };
      expect(validateWaiAriaFocusTrap(elModalValid, 0)).toBeNull();

      const elTrapValid: ElementPhysicsSnapshot = {
        selector: "dialog.native-modal",
        tagName: "DIALOG",
        hasTrapFocus: true,
        bounds: { x: 100, y: 100, width: 400, height: 300 },
      };
      expect(validateWaiAriaFocusTrap(elTrapValid, 0)).toBeNull();

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
        const elRoving: ElementPhysicsSnapshot = {
          selector: `div.${role}-widget`,
          tagName: "DIV",
          role,
          hasRovingTabindex: true,
          bounds: { x: 0, y: 0, width: 300, height: 50 },
        };
        expect(validateWaiAriaFocusTrap(elRoving, 0)).toBeNull();

        const elActiveDesc: ElementPhysicsSnapshot = {
          selector: `div.${role}-widget-desc`,
          tagName: "DIV",
          role,
          attributes: { "aria-activedescendant": "item-1" },
          bounds: { x: 0, y: 0, width: 300, height: 50 },
        };
        expect(validateWaiAriaFocusTrap(elActiveDesc, 0)).toBeNull();

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
});
