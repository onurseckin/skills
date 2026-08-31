import { describe, expect, it } from "bun:test";
import { validateFloatingUiCollision } from "../../../olt/scripts/src/capture/validator/custom/floating-ui-collision.ts";
import type { ElementPhysicsSnapshot } from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Design Rule: Floating UI Collision", () => {
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
      bounds: { x: 100, y: -2, width: 150, height: 50 },
    };
    const defTop = validateFloatingUiCollision(elTop, 2, vp);
    expect(defTop).not.toBeNull();
    expect(defTop?.message).toContain("top edge");

    const elRight: ElementPhysicsSnapshot = {
      selector: "div.popover-right",
      tagName: "DIV",
      isFloating: true,
      bounds: { x: 900, y: 100, width: 150, height: 50 },
    };
    const defRight = validateFloatingUiCollision(elRight, 3, vp);
    expect(defRight).not.toBeNull();
    expect(defRight?.message).toContain("right edge");

    const elBottom: ElementPhysicsSnapshot = {
      selector: "div.popover-bottom",
      tagName: "DIV",
      isFloating: true,
      bounds: { x: 100, y: 550, width: 150, height: 60 },
    };
    const defBottom = validateFloatingUiCollision(elBottom, 4, vp);
    expect(defBottom).not.toBeNull();
    expect(defBottom?.message).toContain("bottom edge");
  });

  it("handles default 1280x800 viewport if not specified", () => {
    const el: ElementPhysicsSnapshot = {
      selector: "div.popover-default",
      tagName: "DIV",
      isFloating: true,
      bounds: { x: 1200, y: 100, width: 100, height: 50 },
    };
    const def = validateFloatingUiCollision(el, 5);
    expect(def).not.toBeNull();
    expect(def?.message).toContain("right edge");
  });
});
