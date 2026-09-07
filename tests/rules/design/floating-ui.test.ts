import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { validateFloatingUiCollision } from "../../../olt/scripts/src/capture/validator/custom/floating-ui-collision.ts";
import type { ElementPhysicsSnapshot } from "../../../olt/scripts/src/capture/validator/types.ts";
import { cleanupVirtualRulesFS, setupVirtualRulesFS } from "../fixture.ts";

describe("Design Rule: Floating UI Collision", () => {
  beforeEach(() => {
    setupVirtualRulesFS();
  });

  afterEach(() => {
    cleanupVirtualRulesFS();
  });

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

  it("accumulates multi-axis collisions simultaneously (e.g. right and bottom edges)", () => {
    const vp = { width: 1000, height: 600 };
    const elCorner: ElementPhysicsSnapshot = {
      selector: "div.popover-corner",
      tagName: "DIV",
      isFloating: true,
      bounds: { x: 950, y: 560, width: 100, height: 100 },
    };
    const def = validateFloatingUiCollision(elCorner, 50, vp);
    expect(def).not.toBeNull();
    expect(def?.message).toContain("right edge");
    expect(def?.message).toContain("bottom edge");
    expect(def?.metadata?.overflows).toContain("right edge");
    expect(def?.metadata?.overflows).toContain("bottom edge");
  });

  it("detects collisions at zero and negative coordinates", () => {
    const vp = { width: 1000, height: 600 };
    // x = 0 is < 8, so must trigger left edge
    const elZero: ElementPhysicsSnapshot = {
      selector: "div.popover-zero",
      tagName: "DIV",
      isFloating: true,
      bounds: { x: 0, y: 50, width: 100, height: 50 },
    };
    const defZero = validateFloatingUiCollision(elZero, 60, vp);
    expect(defZero).not.toBeNull();
    expect(defZero?.message).toContain("left edge (0px < 8px)");

    // Negative coordinates: x = -15, y = -20
    const elNegative: ElementPhysicsSnapshot = {
      selector: "div.popover-negative",
      tagName: "DIV",
      isFloating: true,
      bounds: { x: -15, y: -20, width: 100, height: 50 },
    };
    const defNeg = validateFloatingUiCollision(elNegative, 61, vp);
    expect(defNeg).not.toBeNull();
    expect(defNeg?.message).toContain("left edge (-15px < 8px)");
    expect(defNeg?.message).toContain("top edge (-20px < 8px)");
  });

  it("enforces exact 8px boundary padding threshold", () => {
    const vp = { width: 1000, height: 600 };

    // Exactly at threshold: bounds.x = 8 passes
    const elExactEdge: ElementPhysicsSnapshot = {
      selector: "div.popover-exact",
      tagName: "DIV",
      isFloating: true,
      bounds: { x: 8, y: 8, width: 100, height: 50 },
    };
    expect(validateFloatingUiCollision(elExactEdge, 10, vp)).toBeNull();

    // 1px below threshold: bounds.x = 7 fails
    const elViolatingEdge: ElementPhysicsSnapshot = {
      selector: "div.popover-sub-threshold",
      tagName: "DIV",
      isFloating: true,
      bounds: { x: 7, y: 8, width: 100, height: 50 },
    };
    const def = validateFloatingUiCollision(elViolatingEdge, 11, vp);
    expect(def).not.toBeNull();
    expect(def?.message).toContain("left edge");
  });

  it("evaluates clippingBounds container confinement", () => {
    const vp = { width: 1280, height: 800 };
    const clippingContainer = { x: 100, y: 100, width: 400, height: 400 };

    // Fully contained within clipping container
    const elContained: ElementPhysicsSnapshot = {
      selector: "div.popover-inside",
      tagName: "DIV",
      isFloating: true,
      bounds: { x: 150, y: 150, width: 100, height: 100 },
      clippingBounds: clippingContainer,
    };
    expect(validateFloatingUiCollision(elContained, 20, vp)).toBeNull();

    // Spills outside clipping container on the right
    const elClipped: ElementPhysicsSnapshot = {
      selector: "div.popover-overflows-clip",
      tagName: "DIV",
      isFloating: true,
      bounds: { x: 450, y: 150, width: 100, height: 100 },
      clippingBounds: clippingContainer,
    };
    const defClip = validateFloatingUiCollision(elClipped, 21, vp);
    expect(defClip).not.toBeNull();
    expect(defClip?.message).toContain("clipping boundary overflow");
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
