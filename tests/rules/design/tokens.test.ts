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

  it("passes when border radius conforms to Geist token scale (0, 4, 6, 8, 12, 16, 9999)", () => {
    const validRadii = [0, 4, 6, 8, 12, 16, 9999];
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
  });
});
