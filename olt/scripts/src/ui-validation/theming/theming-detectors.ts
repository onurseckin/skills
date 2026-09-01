import type {
  ThemeFlashDetectionInput,
  ThemeFlashReport,
  DarkDepthInput,
  DarkDepthReport,
  HighContrastBoundaryInput,
  HighContrastBoundaryReport,
} from "./types.ts";
import {
  parseColorToRgb,
  calculateRelativeLuminance,
  calculateWcagContrastRatio,
} from "./contrast-math.ts";
export function detectThemeFlash(input: ThemeFlashDetectionInput): ThemeFlashReport {
  const lumInit = calculateRelativeLuminance(input.initialHtmlBg);
  const lumLoaded = calculateRelativeLuminance(input.loadedThemeBg);
  const deltaLuminance = Math.round(Math.abs(lumInit - lumLoaded) * 1000) / 1000;

  const recommendations: string[] = [];
  let riskLevel: "none" | "low" | "high" = "none";

  if (!input.hasInlineThemeScript && deltaLuminance > 0.3) {
    riskLevel = "high";
    recommendations.push(
      "High Flash of Unstyled Theme (FOUT) risk detected! Add an inline blocking script in <head> to sync initial background before paint.",
    );
  } else if (deltaLuminance > 0.1) {
    riskLevel = "low";
    recommendations.push(
      "Mild background luminance shift during theme init. Consider setting matching static background on root <html> tag.",
    );
  }

  if (input.transitionDurationMs > 300) {
    recommendations.push(
      "Theme transition duration exceeds 300ms, which may cause sluggish color morphing during theme toggle.",
    );
  }

  return {
    flashRiskDetected: riskLevel !== "none",
    riskLevel,
    deltaLuminance,
    recommendations,
  };
}

export function calibrateDarkDepth(input: DarkDepthInput): DarkDepthReport {
  const bgL = calculateRelativeLuminance(input.backgroundHex);
  const surfL = calculateRelativeLuminance(input.surfaceHex);
  const elevL = calculateRelativeLuminance(input.elevatedHex);
  const overL = input.overlayHex ? calculateRelativeLuminance(input.overlayHex) : undefined;

  const issues: string[] = [];

  // In dark mode, background should be darkest, surface slightly lighter, elevated lighter still
  if (surfL <= bgL) {
    issues.push(
      `Dark mode surface (${input.surfaceHex}, lum=${surfL.toFixed(4)}) is not lighter than background (${input.backgroundHex}, lum=${bgL.toFixed(4)}).`,
    );
  }
  if (elevL <= surfL) {
    issues.push(
      `Dark mode elevated surface (${input.elevatedHex}, lum=${elevL.toFixed(4)}) is not lighter than surface (${input.surfaceHex}, lum=${surfL.toFixed(4)}).`,
    );
  }
  if (overL !== undefined && overL <= elevL) {
    issues.push(
      `Dark mode overlay surface (${input.overlayHex}, lum=${overL.toFixed(4)}) is not lighter than elevated surface (${input.elevatedHex}, lum=${elevL.toFixed(4)}).`,
    );
  }

  return {
    monotonicProgression: issues.length === 0,
    backgroundLuminance: Math.round(bgL * 10000) / 10000,
    surfaceLuminance: Math.round(surfL * 10000) / 10000,
    elevatedLuminance: Math.round(elevL * 10000) / 10000,
    ...(overL !== undefined ? { overlayLuminance: Math.round(overL * 10000) / 10000 } : {}),
    issues,
  };
}

export function validateHighContrastBoundaries(
  input: HighContrastBoundaryInput,
): HighContrastBoundaryReport {
  const issues: string[] = [];
  const contrastRatio = calculateWcagContrastRatio(input.borderColor, input.backgroundColor);

  if (input.borderWidthPx < 1) {
    issues.push(
      `Border width ${input.borderWidthPx}px is below 1px minimum in high-contrast mode.`,
    );
  }

  if (input.borderStyle === "none" || input.borderStyle === "hidden") {
    issues.push(
      `Border style '${input.borderStyle}' does not render a visible boundary in high-contrast mode.`,
    );
  }

  // High contrast mode requires minimum 7.0:1 AAA contrast on boundaries
  if (contrastRatio < 7.0) {
    issues.push(
      `Boundary contrast ratio ${contrastRatio}:1 is below 7.0:1 AAA high-contrast accessibility threshold.`,
    );
  }

  return {
    boundarySharp: issues.length === 0,
    contrastRatio,
    issues,
  };
}

/**
 * ============================================================================
 * 5. Unified Permutation Staging Engine & Singletons
 * ============================================================================
 */
