import { describe, it, expect } from "bun:test";
import {
  clampByte,
  clampAlpha,
  parseChannelValue,
  parseAlphaValue,
  parseHue,
  isValidColor,
  parseRgb,
  compositeRgb,
  calculateRelativeLuminance,
  calculateWcagContrast,
  calculateApcaContrast,
} from "../../../../olt/scripts/src/reporting/theme/index.ts";

describe("theme color-space core", () => {
  it("clamps bytes and alpha correctly", () => {
    expect(clampByte(-10)).toBe(0);
    expect(clampByte(300)).toBe(255);
    expect(clampByte(128.4)).toBe(128);
    expect(clampByte(NaN)).toBe(0);

    expect(clampAlpha(-0.5)).toBe(0);
    expect(clampAlpha(1.5)).toBe(1);
    expect(clampAlpha(0.75)).toBe(0.75);
    expect(clampAlpha(NaN)).toBe(1);
  });

  it("parses channel values and percentages", () => {
    expect(parseChannelValue("100")).toBe(100);
    expect(parseChannelValue("50%")).toBeCloseTo(127.5);
    expect(parseAlphaValue("50%")).toBe(0.5);
    expect(parseAlphaValue("0.8")).toBe(0.8);
    expect(parseAlphaValue(undefined)).toBe(1);
  });

  it("parses hues across different units", () => {
    expect(parseHue("180deg")).toBe(180);
    expect(parseHue("0.5turn")).toBe(180);
    expect(parseHue("200grad")).toBe(180);
    expect(parseHue("3.14159265rad")).toBeCloseTo(180, 1);
    expect(parseHue("270")).toBe(270);
    expect(parseHue("-90deg")).toBe(270);
  });

  it("validates colors correctly", () => {
    expect(isValidColor("red")).toBe(true);
    expect(isValidColor("#fff")).toBe(true);
    expect(isValidColor("#123456")).toBe(true);
    expect(isValidColor("#12345678")).toBe(true);
    expect(isValidColor("rgb(255, 0, 0)")).toBe(true);
    expect(isValidColor("rgba(255, 0, 0, 0.5)")).toBe(true);
    expect(isValidColor("hsl(120, 100%, 50%)")).toBe(true);
    expect(isValidColor("hsla(120, 100%, 50%, 0.3)")).toBe(true);
    expect(isValidColor("invalid-color")).toBe(false);
    expect(isValidColor("")).toBe(false);
  });

  it("parses hex, rgb, and hsl colors", () => {
    expect(parseRgb("white")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseRgb("black")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseRgb("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseRgb("rgb(0, 255, 0)")).toEqual({ r: 0, g: 255, b: 0, a: 1 });
    expect(parseRgb("hsl(0, 100%, 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("calculates relative luminance and contrast ratios", () => {
    const whiteLum = calculateRelativeLuminance({ r: 255, g: 255, b: 255 });
    const blackLum = calculateRelativeLuminance({ r: 0, g: 0, b: 0 });
    expect(whiteLum).toBeCloseTo(1.0);
    expect(blackLum).toBeCloseTo(0.0);

    const wcag = calculateWcagContrast("#ffffff", "#000000");
    expect(wcag).toBe(21);

    const apca = calculateApcaContrast("#ffffff", "#000000");
    expect(typeof apca).toBe("number");
    expect(Math.abs(apca)).toBeGreaterThan(50);
  });

  it("composites translucent colors", () => {
    const fg = { r: 255, g: 0, b: 0, a: 0.5 };
    const bg = { r: 0, g: 0, b: 255, a: 1 };
    const blended = compositeRgb(fg, bg);
    expect(blended.a).toBe(1);
    expect(blended.r).toBeGreaterThan(0);
    expect(blended.b).toBeGreaterThan(0);
  });

  it("calculates contrast accurately with dark mode canvas backing", () => {
    const translucentBg = "rgba(255, 255, 255, 0.1)";
    const text = "#ffffff";
    const contrastOnDark = calculateWcagContrast(text, translucentBg, "#000000");
    expect(contrastOnDark).toBeGreaterThan(5);

    const apcaOnDark = calculateApcaContrast(text, translucentBg, "#000000");
    expect(Math.abs(apcaOnDark)).toBeGreaterThan(40);
  });
});
