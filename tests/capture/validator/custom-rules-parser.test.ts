import { describe, expect, it } from "bun:test";
import {
  getExpectedAppleTracking,
  validateAppleOpticalTracking,
} from "../../../olt/scripts/src/capture/validator/custom/apple-optical-tracking.ts";
import { validateGeistTokens } from "../../../olt/scripts/src/capture/validator/custom/geist-tokens.ts";
import type { ElementPhysicsSnapshot } from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Custom Validators: Apple Optical Tracking & Geist Tokens", () => {
  describe("Apple Optical Tracking (validateAppleOpticalTracking & getExpectedAppleTracking)", () => {
    it("returns correct expected tracking ranges for all font size brackets", () => {
      const b1 = getExpectedAppleTracking(11);
      expect(b1.min).toBe(-0.05);
      expect(b1.max).toBe(0.4);
      expect(b1.expected).toBe(0.1);

      const b1Boundary = getExpectedAppleTracking(13);
      expect(b1Boundary.min).toBe(-0.05);
      expect(b1Boundary.max).toBe(0.4);

      const b2 = getExpectedAppleTracking(14);
      expect(b2.min).toBe(-0.5);
      expect(b2.max).toBe(0.2);
      expect(b2.expected).toBe(-0.2);

      const b2Boundary = getExpectedAppleTracking(20);
      expect(b2Boundary.min).toBe(-0.5);
      expect(b2Boundary.max).toBe(0.2);

      const b3 = getExpectedAppleTracking(21);
      expect(b3.min).toBe(-1.0);
      expect(b3.max).toBe(0.0);
      expect(b3.expected).toBe(-0.5);

      const b3Boundary = getExpectedAppleTracking(34);
      expect(b3Boundary.min).toBe(-1.0);
      expect(b3Boundary.max).toBe(0.0);

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
          letterSpacing: 2.0,
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
            letterSpacing: -0.5,
            fontFamily: font,
          },
        };
        expect(validateAppleOpticalTracking(elApple, 0)).toBeNull();
      }

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
          letterSpacing: 1.5,
          fontFamily: "Inter, sans-serif",
        },
      };
      const defect = validateAppleOpticalTracking(elCustomDs, 1);
      expect(defect).not.toBeNull();
      expect(defect?.category).toBe("apple-hig-tracking");
    });

    it("returns defect when actual tracking is below min or above max", () => {
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
          borderRadius: 7,
          fontFamily: "Arial, sans-serif",
        },
      };
      expect(validateGeistTokens(el, 0)).toBeNull();
    });

    it("identifies Geist context by data-design-system, fontFamily, or selector", () => {
      const elAttr: ElementPhysicsSnapshot = {
        selector: "div.card",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        attributes: { "data-design-system": "geist" },
        computedStyles: { borderRadius: 8 },
      };
      expect(validateGeistTokens(elAttr, 0)).toBeNull();

      const elFont: ElementPhysicsSnapshot = {
        selector: "div.card",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: {
          fontFamily: "Geist Sans, sans-serif",
          borderRadius: 6,
        },
      };
      expect(validateGeistTokens(elFont, 0)).toBeNull();

      const elSel: ElementPhysicsSnapshot = {
        selector: "div.geist-badge",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: { borderRadius: 9999 },
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
});
