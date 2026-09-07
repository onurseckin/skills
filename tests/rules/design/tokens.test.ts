import { describe, expect, it } from "bun:test";
import { validateGeistTokens } from "../../../olt/scripts/src/capture/validator/custom/geist-tokens.ts";
import type { ElementPhysicsSnapshot } from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Design Rule: Geist Design Tokens", () => {
  it("returns null if element is not using Geist typography", () => {
    const elOther: ElementPhysicsSnapshot = {
      selector: "div.box",
      tagName: "DIV",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      computedStyles: { fontFamily: "Arial", borderRadius: 7 },
    };
    expect(validateGeistTokens(elOther, 0)).toBeNull();
  });

  it("passes when border radius conforms to Geist token scale (0, 4, 6, 8, 12, 16, 24, 9999)", () => {
    const validRadii = [0, 4, 6, 8, 12, 16, 24, 9999];
    for (const radius of validRadii) {
      const el: ElementPhysicsSnapshot = {
        selector: `div.r-${radius}`,
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: { fontFamily: "Geist Sans", borderRadius: radius },
      };
      expect(validateGeistTokens(el, 0)).toBeNull();
    }
  });

  it("detects off-token border radius values (e.g. 7px, 11px)", () => {
    const elBadRadius: ElementPhysicsSnapshot = {
      selector: "div.card-off-token",
      tagName: "DIV",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      computedStyles: { fontFamily: "Geist Sans", borderRadius: 7 },
    };
    const def = validateGeistTokens(elBadRadius, 1);
    expect(def).not.toBeNull();
    expect(def?.id).toBe("cust-geist-tokens-1");
    expect(def?.severity).toBe("minor");
    expect(def?.message).toContain("violates Vercel Geist token scale");
    expect(def?.metadata?.actualRadius).toBe(7);
  });

  it("activates validation via selector containing geist (e.g. div.geist-card) even without geist font", () => {
    const elSelector: ElementPhysicsSnapshot = {
      selector: "div.geist-card",
      tagName: "DIV",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      computedStyles: { fontFamily: "Inter", borderRadius: 10 },
    };
    const def = validateGeistTokens(elSelector, 2);
    expect(def).not.toBeNull();
    expect(def?.id).toBe("cust-geist-tokens-2");
    expect(def?.metadata?.actualRadius).toBe(10);
  });

  it("activates validation via data-design-system attribute", () => {
    const elAttr: ElementPhysicsSnapshot = {
      selector: "div.custom-box",
      tagName: "DIV",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      attributes: { "data-design-system": "geist" },
      computedStyles: { fontFamily: "Roboto", borderRadius: 5 },
    };
    const def = validateGeistTokens(elAttr, 3);
    expect(def).not.toBeNull();
    expect(def?.id).toBe("cust-geist-tokens-3");
    expect(def?.metadata?.actualRadius).toBe(5);
  });

  it("ignores zero and negative radius values without raising violation", () => {
    const elZero: ElementPhysicsSnapshot = {
      selector: "div.geist-zero",
      tagName: "DIV",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      computedStyles: { fontFamily: "Geist Sans", borderRadius: 0 },
    };
    expect(validateGeistTokens(elZero, 0)).toBeNull();

    const elNegative: ElementPhysicsSnapshot = {
      selector: "div.geist-negative",
      tagName: "DIV",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      computedStyles: { fontFamily: "Geist Sans", borderRadius: -1 },
    };
    expect(validateGeistTokens(elNegative, 0)).toBeNull();
  });
});
