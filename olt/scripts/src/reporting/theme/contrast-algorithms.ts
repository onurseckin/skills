import { parseRgb, compositeRgb } from "./color-parser.ts";

export function calculateRelativeLuminance(rgb: {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}): number {
  const transform = (c: number): number => {
    const s = Math.max(0, Math.min(255, c)) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const rLin = transform(rgb.r);
  const gLin = transform(rgb.g);
  const bLin = transform(rgb.b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

export function calculateWcagContrast(fg: string, bg: string): number {
  const fgParsed = parseRgb(fg);
  const bgParsed = parseRgb(bg);

  const effectiveBg =
    bgParsed.a < 1 ? compositeRgb(bgParsed, { r: 255, g: 255, b: 255, a: 1 }) : bgParsed;

  const effectiveFg = fgParsed.a < 1 ? compositeRgb(fgParsed, effectiveBg) : fgParsed;

  const l1 = calculateRelativeLuminance(effectiveFg);
  const l2 = calculateRelativeLuminance(effectiveBg);

  const brighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  const ratio = (brighter + 0.05) / (darker + 0.05);
  const clamped = Math.max(1, Math.min(21, ratio));
  return Math.round(clamped * 100) / 100;
}

export function calculateApcaContrast(fg: string, bg: string): number {
  const fgParsed = parseRgb(fg);
  const bgParsed = parseRgb(bg);

  const effectiveBg =
    bgParsed.a < 1 ? compositeRgb(bgParsed, { r: 255, g: 255, b: 255, a: 1 }) : bgParsed;

  const effectiveFg = fgParsed.a < 1 ? compositeRgb(fgParsed, effectiveBg) : fgParsed;

  const toApcaY = (c: { readonly r: number; readonly g: number; readonly b: number }): number => {
    const rLin = Math.pow(Math.max(0, Math.min(255, c.r)) / 255, 2.4);
    const gLin = Math.pow(Math.max(0, Math.min(255, c.g)) / 255, 2.4);
    const bLin = Math.pow(Math.max(0, Math.min(255, c.b)) / 255, 2.4);
    return 0.2126729 * rLin + 0.7151522 * gLin + 0.072175 * bLin;
  };

  let yTxt = toApcaY(effectiveFg);
  let yBg = toApcaY(effectiveBg);

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

  if (Math.abs(contrast) < 0.1) {
    return 0;
  }

  const lc = contrast > 0 ? (contrast - 0.027) * 100 : (contrast + 0.027) * 100;
  return Math.round(lc * 100) / 100;
}
