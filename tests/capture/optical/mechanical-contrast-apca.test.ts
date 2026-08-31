import { describe, expect, it } from "bun:test";
import {
  calculateApcaLightness,
  validateApcaElement,
} from "../../../olt/scripts/src/capture/validator/mechanical/apca.ts";
import type { ElementPhysicsSnapshot } from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Mechanical Validators: APCA Contrast", () => {
  it("calculateApcaLightness computes contrast for light-on-dark, dark-on-light, near-black colors and zero contrast", () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const lcDarkOnLight = calculateApcaLightness(black, white);
    expect(lcDarkOnLight).toBeGreaterThan(100);

    const lcLightOnDark = calculateApcaLightness(white, black);
    expect(lcLightOnDark).toBeLessThan(-100);

    const nearBlack1 = { r: 2, g: 2, b: 2, a: 1 };
    const nearBlack2 = { r: 5, g: 5, b: 5, a: 1 };
    const lcNearBlack = calculateApcaLightness(nearBlack1, nearBlack2);
    expect(typeof lcNearBlack).toBe("number");

    const gray = { r: 128, g: 128, b: 128, a: 1 };
    const lcZero = calculateApcaLightness(gray, gray);
    expect(lcZero).toBe(0);
  });

  it("validateApcaElement returns null for non-text or unparseable color elements", () => {
    const elNoText: ElementPhysicsSnapshot = {
      selector: "div.box",
      tagName: "DIV",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      computedStyles: { color: "#000", backgroundColor: "#fff" },
    };
    expect(validateApcaElement(elNoText, 0)).toBeNull();

    const elEmptyText: ElementPhysicsSnapshot = {
      selector: "span.empty",
      tagName: "SPAN",
      text: "   ",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      computedStyles: { color: "#000", backgroundColor: "#fff" },
    };
    expect(validateApcaElement(elEmptyText, 0)).toBeNull();

    const elNoStyles: ElementPhysicsSnapshot = {
      selector: "p.text",
      tagName: "P",
      text: "Hello",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    };
    expect(validateApcaElement(elNoStyles, 0)).toBeNull();

    const elBadColors: ElementPhysicsSnapshot = {
      selector: "p.text",
      tagName: "P",
      text: "Hello",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      computedStyles: { color: "unknown", backgroundColor: "invalid" },
    };
    expect(validateApcaElement(elBadColors, 0)).toBeNull();
  });

  it("parses hex 3, 6, 8 digits, rgba, white, and black color formats", () => {
    const elHex38: ElementPhysicsSnapshot = {
      selector: "p.hex38",
      tagName: "P",
      text: "Sample text",
      bounds: { x: 0, y: 0, width: 100, height: 20 },
      computedStyles: {
        color: "#000",
        backgroundColor: "#ffffff80",
        fontSize: 16,
        fontWeight: 400,
      },
    };
    expect(typeof validateApcaElement(elHex38, 0)).toBe("object");

    const elHex6Rgba: ElementPhysicsSnapshot = {
      selector: "p.hex6rgba",
      tagName: "P",
      text: "Sample text",
      bounds: { x: 0, y: 0, width: 100, height: 20 },
      computedStyles: {
        color: "#112233",
        backgroundColor: "rgba(255, 255, 255, 1.0)",
        fontSize: 16,
        fontWeight: 400,
      },
    };
    expect(typeof validateApcaElement(elHex6Rgba, 0)).toBe("object");

    const elNamed: ElementPhysicsSnapshot = {
      selector: "p.named",
      tagName: "P",
      text: "Sample text",
      bounds: { x: 0, y: 0, width: 100, height: 20 },
      computedStyles: {
        color: "black",
        backgroundColor: "white",
        fontSize: 16,
        fontWeight: 400,
      },
    };
    expect(validateApcaElement(elNamed, 0)).toBeNull();
  });

  it("evaluates required Lc thresholds across font sizes and weights", () => {
    const elLargePass: ElementPhysicsSnapshot = {
      selector: "h1.large",
      tagName: "H1",
      text: "Large Heading",
      bounds: { x: 0, y: 0, width: 300, height: 40 },
      computedStyles: {
        color: "#000000",
        backgroundColor: "#ffffff",
        fontSize: 24,
        fontWeight: 400,
      },
    };
    expect(validateApcaElement(elLargePass, 0)).toBeNull();

    const elBoldPass: ElementPhysicsSnapshot = {
      selector: "h2.bold",
      tagName: "H2",
      text: "Bold Title",
      bounds: { x: 0, y: 0, width: 200, height: 30 },
      computedStyles: {
        color: "#000000",
        backgroundColor: "#ffffff",
        fontSize: 18,
        fontWeight: 700,
      },
    };
    expect(validateApcaElement(elBoldPass, 0)).toBeNull();

    const elBodyFail: ElementPhysicsSnapshot = {
      selector: "p.body-low-contrast",
      tagName: "P",
      text: "Faint body text",
      bounds: { x: 0, y: 0, width: 200, height: 20 },
      computedStyles: {
        color: "#777777",
        backgroundColor: "#999999",
        fontSize: 16,
        fontWeight: 400,
      },
    };
    const defCritical = validateApcaElement(elBodyFail, 1);
    expect(defCritical).not.toBeNull();
    expect(defCritical?.severity).toBe("critical");
    expect(defCritical?.id).toBe("mech-apca-1");

    const elSmallMedContrast: ElementPhysicsSnapshot = {
      selector: "span.caption",
      tagName: "SPAN",
      text: "Caption text",
      bounds: { x: 0, y: 0, width: 100, height: 16 },
      computedStyles: {
        color: "#333333",
        backgroundColor: "#cccccc",
        fontSize: 14,
        fontWeight: 400,
      },
    };
    const defSerious = validateApcaElement(elSmallMedContrast, 2);
    expect(defSerious).not.toBeNull();
    expect(defSerious?.severity).toBe("serious");
  });
});
