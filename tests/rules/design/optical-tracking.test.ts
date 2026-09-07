import { describe, expect, it } from "bun:test";
import {
  getExpectedAppleTracking,
  validateAppleOpticalTracking,
} from "../../../olt/scripts/src/capture/validator/custom/apple-optical-tracking.ts";
import type { ElementPhysicsSnapshot } from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Design Rule: Apple Optical Tracking", () => {
  it("returns correct expected tracking ranges for font size brackets", () => {
    const b1 = getExpectedAppleTracking(11);
    expect(b1.min).toBe(-0.05);
    expect(b1.max).toBe(0.4);
    expect(b1.expected).toBe(0.1);

    const b2 = getExpectedAppleTracking(16);
    expect(b2.min).toBe(-0.5);
    expect(b2.max).toBe(0.2);
    expect(b2.expected).toBe(-0.2);

    const b3 = getExpectedAppleTracking(24);
    expect(b3.min).toBe(-1.0);
    expect(b3.max).toBe(0.0);
    expect(b3.expected).toBe(-0.5);

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
  });

  it("passes when letter-spacing falls within expected brackets for SF Pro Text", () => {
    const elValid: ElementPhysicsSnapshot = {
      selector: "p.body",
      tagName: "P",
      bounds: { x: 0, y: 0, width: 200, height: 40 },
      computedStyles: {
        fontSize: 16,
        letterSpacing: -0.2,
        fontFamily: "SF Pro Text",
      },
    };
    expect(validateAppleOpticalTracking(elValid, 0)).toBeNull();
  });

  it("detects tracking violations when letter-spacing diverges significantly", () => {
    const elBad: ElementPhysicsSnapshot = {
      selector: "h1.heading",
      tagName: "H1",
      bounds: { x: 0, y: 0, width: 400, height: 60 },
      computedStyles: {
        fontSize: 48,
        letterSpacing: 2.0,
        fontFamily: "SF Pro Display",
      },
    };
    const def = validateAppleOpticalTracking(elBad, 1);
    expect(def).not.toBeNull();
    expect(def?.id).toBe("cust-apple-tracking-1");
    expect(def?.severity).toBe("minor");
    expect(def?.message).toContain("Apple HIG optical tracking mismatch");
  });

  it("handles exact font size bracket boundaries (13px, 20px, 34px, 35px)", () => {
    const at13 = getExpectedAppleTracking(13);
    expect(at13.min).toBe(-0.05);
    expect(at13.max).toBe(0.4);
    expect(at13.expected).toBe(0.1);

    const at20 = getExpectedAppleTracking(20);
    expect(at20.min).toBe(-0.5);
    expect(at20.max).toBe(0.2);
    expect(at20.expected).toBe(-0.2);

    const at34 = getExpectedAppleTracking(34);
    expect(at34.min).toBe(-1.0);
    expect(at34.max).toBe(0.0);
    expect(at34.expected).toBe(-0.5);

    const at35 = getExpectedAppleTracking(35);
    expect(at35.min).toBe(-2.0);
    expect(at35.max).toBe(-0.2);
    expect(at35.expected).toBe(-1.0);
  });

  it("returns null for non-Apple font families unless data-design-system is explicitly set", () => {
    const nonAppleFonts = ["Roboto", "Times New Roman", "Inter", "Helvetica"];
    for (const font of nonAppleFonts) {
      const el: ElementPhysicsSnapshot = {
        selector: `p.${font.toLowerCase().replace(/\s+/g, "-")}`,
        tagName: "P",
        bounds: { x: 0, y: 0, width: 200, height: 40 },
        computedStyles: {
          fontSize: 48,
          letterSpacing: 2.0, // divergent, but non-Apple font
          fontFamily: font,
        },
      };
      expect(validateAppleOpticalTracking(el, 0)).toBeNull();
    }
  });

  it("triggers validation on non-Apple font when data-design-system is set to apple-hig", () => {
    const elOverride: ElementPhysicsSnapshot = {
      selector: "p.inter-apple-hig",
      tagName: "P",
      bounds: { x: 0, y: 0, width: 200, height: 40 },
      attributes: {
        "data-design-system": "apple-hig",
      },
      computedStyles: {
        fontSize: 48,
        letterSpacing: 2.0,
        fontFamily: "Inter",
      },
    };
    const def = validateAppleOpticalTracking(elOverride, 5);
    expect(def).not.toBeNull();
    expect(def?.id).toBe("cust-apple-tracking-5");
    expect(def?.category).toBe("apple-hig-tracking");
  });
});
