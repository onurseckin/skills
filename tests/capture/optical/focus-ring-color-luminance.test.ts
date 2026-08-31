import { describe, expect, it } from "bun:test";
import {
  calculateWcagLuminance,
  compositeColorOver,
  hslToRgb,
  NAMED_COLORS,
  parseCssColor,
  srgbChannelToLinear,
} from "../../../olt/scripts/src/capture/validator/mechanical/focus-ring-optical/color.ts";

describe("Focus Ring Optical Engine: Color Parsing & Luminance", () => {
  it("exports NAMED_COLORS map with standard colors", () => {
    expect(NAMED_COLORS.white).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(NAMED_COLORS.black).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(NAMED_COLORS.transparent).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(NAMED_COLORS.currentcolor).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(NAMED_COLORS.red).toEqual({ r: 239, g: 68, b: 68, a: 1 });
    expect(NAMED_COLORS.blue).toEqual({ r: 37, g: 99, b: 235, a: 1 });
    expect(NAMED_COLORS.slate).toEqual({ r: 100, g: 116, b: 139, a: 1 });
  });

  it("hslToRgb converts all 6 hue sectors, negative angles, and boundary conditions", () => {
    const red = hslToRgb(0, 100, 50);
    expect(red).toEqual({ r: 255, g: 0, b: 0 });

    const orange = hslToRgb(30, 100, 50);
    expect(orange.r).toBe(255);
    expect(orange.g).toBe(128);
    expect(orange.b).toBe(0);

    const yellow = hslToRgb(60, 100, 50);
    expect(yellow).toEqual({ r: 255, g: 255, b: 0 });

    const chartreuse = hslToRgb(90, 100, 50);
    expect(chartreuse.r).toBe(128);
    expect(chartreuse.g).toBe(255);
    expect(chartreuse.b).toBe(0);

    const green = hslToRgb(120, 100, 50);
    expect(green).toEqual({ r: 0, g: 255, b: 0 });

    const spring = hslToRgb(150, 100, 50);
    expect(spring.r).toBe(0);
    expect(spring.g).toBe(255);
    expect(spring.b).toBe(128);

    const cyan = hslToRgb(180, 100, 50);
    expect(cyan).toEqual({ r: 0, g: 255, b: 255 });

    const azure = hslToRgb(210, 100, 50);
    expect(azure.r).toBe(0);
    expect(azure.g).toBe(128);
    expect(azure.b).toBe(255);

    const blue = hslToRgb(240, 100, 50);
    expect(blue).toEqual({ r: 0, g: 0, b: 255 });

    const violet = hslToRgb(270, 100, 50);
    expect(violet.r).toBe(128);
    expect(violet.g).toBe(0);
    expect(violet.b).toBe(255);

    const magenta = hslToRgb(300, 100, 50);
    expect(magenta).toEqual({ r: 255, g: 0, b: 255 });

    const rose = hslToRgb(330, 100, 50);
    expect(rose.r).toBe(255);
    expect(rose.g).toBe(0);
    expect(rose.b).toBe(128);

    const negAngle = hslToRgb(-120, 100, 50);
    expect(negAngle).toEqual({ r: 0, g: 0, b: 255 });

    const wrapAngle = hslToRgb(480, 100, 50);
    expect(wrapAngle).toEqual({ r: 0, g: 255, b: 0 });

    const black = hslToRgb(0, 0, 0);
    expect(black).toEqual({ r: 0, g: 0, b: 0 });

    const white = hslToRgb(0, 0, 100);
    expect(white).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("parseCssColor parses all hex formats (#rgb, #rgba, #rrggbb, #rrggbbaa)", () => {
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("#000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseCssColor("#f0a")).toEqual({ r: 255, g: 0, b: 170, a: 1 });

    const hex4 = parseCssColor("#ff08");
    expect(hex4?.r).toBe(255);
    expect(hex4?.g).toBe(255);
    expect(hex4?.b).toBe(0);
    expect(hex4?.a).toBeCloseTo(0.5333, 3);

    expect(parseCssColor("#102030")).toEqual({ r: 16, g: 32, b: 48, a: 1 });

    const hex8 = parseCssColor("#10203080");
    expect(hex8?.r).toBe(16);
    expect(hex8?.g).toBe(32);
    expect(hex8?.b).toBe(48);
    expect(hex8?.a).toBeCloseTo(128 / 255, 4);
  });

  it("parseCssColor parses named colors and returns null on invalid strings", () => {
    expect(parseCssColor("red")).toEqual(NAMED_COLORS.red);
    expect(parseCssColor("  BLUE  ")).toEqual(NAMED_COLORS.blue);
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor(undefined)).toBeNull();
    expect(parseCssColor("not-a-color")).toBeNull();
    expect(parseCssColor("#invalid")).toBeNull();
  });

  it("parseCssColor parses rgb and rgba syntax with commas, spaces, slashes, and percentages", () => {
    expect(parseCssColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseCssColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseCssColor("rgba(10, 20, 30, 50%)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });

    expect(parseCssColor("rgb(255 128 0)")).toEqual({ r: 255, g: 128, b: 0, a: 1 });
    expect(parseCssColor("rgb(255 128 0 / 0.8)")).toEqual({ r: 255, g: 128, b: 0, a: 0.8 });
    expect(parseCssColor("rgb(255 128 0 / 75%)")).toEqual({ r: 255, g: 128, b: 0, a: 0.75 });

    expect(parseCssColor("rgb(300, 50, 100)")).toEqual({ r: 255, g: 50, b: 100, a: 1 });
  });

  it("parseCssColor parses hsl and hsla syntax", () => {
    const hsl1 = parseCssColor("hsl(120, 100%, 50%)");
    expect(hsl1).toEqual({ r: 0, g: 255, b: 0, a: 1 });

    const hsla1 = parseCssColor("hsla(120deg, 100%, 50%, 0.4)");
    expect(hsla1).toEqual({ r: 0, g: 255, b: 0, a: 0.4 });

    const hslaSlash = parseCssColor("hsl(240 100% 50% / 60%)");
    expect(hslaSlash).toEqual({ r: 0, g: 0, b: 255, a: 0.6 });
  });

  it("compositeColorOver blends foreground and background properly", () => {
    const solidFg = { r: 255, g: 0, b: 0, a: 1 };
    const bg = { r: 0, g: 0, b: 255, a: 1 };
    expect(compositeColorOver(solidFg, bg)).toEqual(solidFg);

    const semiFg = { r: 255, g: 0, b: 0, a: 0.5 };
    const blended = compositeColorOver(semiFg, bg);
    expect(blended.r).toBe(128);
    expect(blended.g).toBe(0);
    expect(blended.b).toBe(128);
    expect(blended.a).toBe(1);

    const semiBg = { r: 0, g: 255, b: 0, a: 0.5 };
    const blendedSemi = compositeColorOver(semiFg, semiBg);
    expect(blendedSemi.a).toBeCloseTo(0.75, 2);
  });

  it("srgbChannelToLinear and calculateWcagLuminance adhere to WCAG standards", () => {
    const lowLinear = srgbChannelToLinear(5);
    expect(lowLinear).toBeCloseTo(5 / 255 / 12.92, 5);

    const highLinear = srgbChannelToLinear(255);
    expect(highLinear).toBeCloseTo(1.0, 5);

    expect(calculateWcagLuminance({ r: 0, g: 0, b: 0, a: 1 })).toBe(0);
    expect(calculateWcagLuminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1.0, 4);

    const lumRed = calculateWcagLuminance({ r: 255, g: 0, b: 0, a: 1 });
    const lumGreen = calculateWcagLuminance({ r: 0, g: 255, b: 0, a: 1 });
    const lumBlue = calculateWcagLuminance({ r: 0, g: 0, b: 255, a: 1 });

    expect(lumRed).toBeCloseTo(0.2126, 3);
    expect(lumGreen).toBeCloseTo(0.7152, 3);
    expect(lumBlue).toBeCloseTo(0.0722, 3);
  });
});
