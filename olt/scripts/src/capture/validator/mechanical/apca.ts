import type { ElementPhysicsSnapshot, ValidationDefect } from "../types.ts";
import { generateRemediations } from "../synthesis/remediation-generator.ts";

interface ParsedRGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function parseColor(colorStr?: string): ParsedRGB | null {
  if (!colorStr) return null;
  const trimmed = colorStr.trim().toLowerCase();

  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const h0 = hex[0];
      const h1 = hex[1];
      const h2 = hex[2];
      if (h0 !== undefined && h1 !== undefined && h2 !== undefined) {
        const r = parseInt(h0 + h0, 16);
        const g = parseInt(h1 + h1, 16);
        const b = parseInt(h2 + h2, 16);
        return { r, g, b, a: 1 };
      }
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b, a: 1 };
    }
    if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = parseInt(hex.slice(6, 8), 16) / 255;
      return { r, g, b, a };
    }
  }

  const rgbaMatch = trimmed.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/,
  );
  if (rgbaMatch) {
    const m1 = rgbaMatch[1];
    const m2 = rgbaMatch[2];
    const m3 = rgbaMatch[3];
    const m4 = rgbaMatch[4];
    if (m1 !== undefined && m2 !== undefined && m3 !== undefined) {
      const r = parseInt(m1, 10);
      const g = parseInt(m2, 10);
      const b = parseInt(m3, 10);
      const a = m4 !== undefined ? parseFloat(m4) : 1;
      return { r, g, b, a };
    }
  }

  if (trimmed === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (trimmed === "black") return { r: 0, g: 0, b: 0, a: 1 };

  return null;
}

function sRgbToY(color: ParsedRGB): number {
  const rLin = Math.pow(color.r / 255, 2.4);
  const gLin = Math.pow(color.g / 255, 2.4);
  const bLin = Math.pow(color.b / 255, 2.4);
  return 0.2126729 * rLin + 0.7151522 * gLin + 0.072175 * bLin;
}

export function calculateApcaLightness(textColor: ParsedRGB, bgColor: ParsedRGB): number {
  let yTxt = sRgbToY(textColor);
  let yBg = sRgbToY(bgColor);

  const blackThresh = 0.022;
  const expBlack = 1.414;

  if (yTxt < blackThresh) {
    yTxt += Math.pow(blackThresh - yTxt, expBlack);
  }
  if (yBg < blackThresh) {
    yBg += Math.pow(blackThresh - yBg, expBlack);
  }

  const scaleFactor = 1.14;
  let contrast = 0;

  if (yBg > yTxt) {
    const yBgExp = Math.pow(yBg, 0.56);
    const yTxtExp = Math.pow(yTxt, 0.57);
    contrast = (yBgExp - yTxtExp) * scaleFactor;
  } else {
    const yBgExp = Math.pow(yBg, 0.65);
    const yTxtExp = Math.pow(yTxt, 0.62);
    contrast = (yBgExp - yTxtExp) * scaleFactor;
  }

  if (Math.abs(contrast) < 0.1) return 0;
  return contrast > 0 ? (contrast - 0.027) * 100 : (contrast + 0.027) * 100;
}

function getRequiredLc(fontSize: number, fontWeight: number): number {
  const isBold = fontWeight >= 700;
  if (fontSize >= 24 || (fontSize >= 18 && isBold)) {
    return 60;
  }
  if (fontSize >= 16) {
    return 75;
  }
  return 90;
}

export function validateApcaElement(
  element: ElementPhysicsSnapshot,
  index: number,
): ValidationDefect | null {
  const styles = element.computedStyles;
  if (!styles || !element.text || element.text.trim().length === 0) {
    return null;
  }

  const textRgb = parseColor(styles.color);
  const bgRgb = parseColor(styles.backgroundColor);
  if (!textRgb || !bgRgb) {
    return null;
  }

  const lc = calculateApcaLightness(textRgb, bgRgb);
  const absLc = Math.abs(lc);
  const fontSize = styles.fontSize ?? 16;
  const fontWeight = styles.fontWeight ?? 400;
  const requiredLc = getRequiredLc(fontSize, fontWeight);

  if (absLc < requiredLc) {
    const severity = absLc < 45 ? "critical" : "serious";
    return {
      id: `mech-apca-${index}`,
      pillar: "mechanical",
      category: "apca-contrast",
      elementSelector: element.selector,
      message: `APCA contrast Lc=${absLc.toFixed(1)} is below required threshold Lc=${requiredLc} for fontSize=${fontSize}px fontWeight=${fontWeight}.`,
      severity,
      remediations: generateRemediations("apca-contrast"),
      metadata: {
        actualLc: Number(absLc.toFixed(1)),
        requiredLc,
        fontSize,
        fontWeight,
      },
    };
  }

  return null;
}
