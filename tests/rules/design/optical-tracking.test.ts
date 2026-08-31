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
});
