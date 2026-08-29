import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";
import type { ElementThemePair } from "../theme/types.ts";

export interface DualChannelUiCheckOptions {
  readonly themeElements?: readonly ElementThemePair[] | undefined;
  readonly checkTerminalChannels?: boolean | undefined;
  readonly asciiChannelSample?: string | undefined;
  readonly ansiChannelSample?: string | undefined;
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function parseColor(color: string): Rgb | null {
  if (typeof color !== "string") return null;
  const str = color.trim().toLowerCase();
  if (str === "") return null;

  if (str.startsWith("#")) {
    const hex = str.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0]! + hex[0]!, 16),
        g: parseInt(hex[1]! + hex[1]!, 16),
        b: parseInt(hex[2]! + hex[2]!, 16),
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
  }

  const rgbMatch = str.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/u);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1]!, 10),
      g: parseInt(rgbMatch[2]!, 10),
      b: parseInt(rgbMatch[3]!, 10),
    };
  }

  if (str === "white") return { r: 255, g: 255, b: 255 };
  if (str === "black") return { r: 0, g: 0, b: 0 };
  return null;
}

function sRgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * sRgbToLinear(rgb.r) + 0.7152 * sRgbToLinear(rgb.g) + 0.0722 * sRgbToLinear(rgb.b);
}

function calculateWcagContrast(fg: Rgb, bg: Rgb): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function checkDualChannelUi(
  options: DualChannelUiCheckOptions = {},
): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];

  // 1. Evaluate Theme Contrast Matrix
  if (options.themeElements && options.themeElements.length > 0) {
    for (const pair of options.themeElements) {
      const fgRgb = parseColor(pair.foregroundColor);
      const bgRgb = parseColor(pair.backgroundColor);

      if (!fgRgb || !bgRgb) {
        findings.push({
          code: "DUAL_CHANNEL_CONTRAST_SYNTAX",
          severity: "ERROR",
          engine: "checkDualChannelUi",
          message: `Invalid color expression in selector "${pair.selector}" (${pair.theme} mode): foreground="${pair.foregroundColor}", background="${pair.backgroundColor}"`,
          details: { selector: pair.selector, theme: pair.theme },
        });
        continue;
      }

      const ratio = calculateWcagContrast(fgRgb, bgRgb);
      const isLarge = pair.isLargeText ?? false;
      const required = isLarge ? 3.0 : 4.5;

      if (ratio < required) {
        findings.push({
          code: "DUAL_CHANNEL_CONTRAST_DEFECT",
          severity: ratio < 3.0 ? "ERROR" : "WARN",
          engine: "checkDualChannelUi",
          message: `Theme contrast defect on "${pair.selector}" in ${pair.theme} mode: required ${required.toFixed(1)}:1, found ${ratio.toFixed(2)}:1`,
          details: {
            selector: pair.selector,
            theme: pair.theme,
            contrastRatio: ratio,
            requiredThreshold: required,
          },
        });
      }
    }
  }

  // 2. Validate Terminal Dual-Channel (ASCII fallback + ANSI color channel)
  if (options.checkTerminalChannels ?? true) {
    if (options.asciiChannelSample !== undefined && options.asciiChannelSample.length === 0) {
      findings.push({
        code: "TERMINAL_ASCII_CHANNEL_MISSING",
        severity: "ERROR",
        engine: "checkDualChannelUi",
        message: "Terminal ASCII channel output is empty; plain non-ANSI fallback required",
      });
    }
    if (options.ansiChannelSample !== undefined && options.ansiChannelSample.length === 0) {
      findings.push({
        code: "TERMINAL_ANSI_CHANNEL_MISSING",
        severity: "ERROR",
        engine: "checkDualChannelUi",
        message: "Terminal ANSI channel output is empty; styled output stream required",
      });
    }
  }

  return {
    engine: "checkDualChannelUi",
    passed: findings.filter((f) => f.severity === "ERROR").length === 0,
    findings,
  };
}
