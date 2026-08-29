import type { ThemeMode, ThemeContrastElementResult, ThemeRegressionFinding } from "./types.ts";
import { getRequiredThreshold } from "./thresholds.ts";

export function checkThemeRegressions(
  selector: string,
  themeResults: Partial<Record<ThemeMode, ThemeContrastElementResult>>,
  anyLargeText: boolean,
  generateFindingId: (prefix: string) => string,
): readonly ThemeRegressionFinding[] {
  const findings: ThemeRegressionFinding[] = [];
  const lightRes = themeResults.light;
  const darkRes = themeResults.dark;
  const hcLightRes = themeResults["high-contrast-light"];
  const hcDarkRes = themeResults["high-contrast-dark"];

  if (lightRes !== undefined && darkRes !== undefined) {
    const lightAa = lightRes.evaluations.find((e) => e.standard === "wcag-aa");
    const darkAa = darkRes.evaluations.find((e) => e.standard === "wcag-aa");
    const lightAaPassed = lightAa !== undefined ? lightAa.passed : lightRes.wcagRatio >= 4.5;
    const darkAaPassed = darkAa !== undefined ? darkAa.passed : darkRes.wcagRatio >= 4.5;

    if (lightAaPassed && !darkAaPassed) {
      findings.push({
        id: generateFindingId("REGRESS-DARK"),
        selector,
        theme: "dark",
        standard: "wcag-aa",
        severity: "serious",
        message: `Dark mode contrast regression: selector "${selector}" passes in light mode (CR: ${lightRes.wcagRatio.toFixed(2)}:1), but regresses and fails in dark mode (CR: ${darkRes.wcagRatio.toFixed(2)}:1).`,
        foregroundColor: darkRes.foregroundColor,
        backgroundColor: darkRes.backgroundColor,
        contrastRatio: darkRes.wcagRatio,
        requiredThreshold: getRequiredThreshold("wcag-aa", anyLargeText),
        details:
          "Dark mode color palette fails to preserve adequate contrast compared to light theme baseline.",
      });
    }
  }

  if (hcLightRes !== undefined && lightRes !== undefined) {
    if (hcLightRes.wcagRatio < lightRes.wcagRatio) {
      findings.push({
        id: generateFindingId("REGRESS-HC"),
        selector,
        theme: "high-contrast-light",
        standard: "wcag-aa",
        severity: "moderate",
        message: `High-contrast light mode inverted contrast: selector "${selector}" has lower contrast in high-contrast mode (${hcLightRes.wcagRatio.toFixed(2)}:1) than standard light mode (${lightRes.wcagRatio.toFixed(2)}:1).`,
        foregroundColor: hcLightRes.foregroundColor,
        backgroundColor: hcLightRes.backgroundColor,
        contrastRatio: hcLightRes.wcagRatio,
        requiredThreshold: lightRes.wcagRatio,
        details:
          "High-contrast theme mode must yield higher or equal luminance contrast relative to standard themes.",
      });
    }
  }

  if (hcDarkRes !== undefined && darkRes !== undefined) {
    if (hcDarkRes.wcagRatio < darkRes.wcagRatio) {
      findings.push({
        id: generateFindingId("REGRESS-HCDARK"),
        selector,
        theme: "high-contrast-dark",
        standard: "wcag-aa",
        severity: "moderate",
        message: `High-contrast dark mode inverted contrast: selector "${selector}" has lower contrast in high-contrast dark mode (${hcDarkRes.wcagRatio.toFixed(2)}:1) than standard dark mode (${darkRes.wcagRatio.toFixed(2)}:1).`,
        foregroundColor: hcDarkRes.foregroundColor,
        backgroundColor: hcDarkRes.backgroundColor,
        contrastRatio: hcDarkRes.wcagRatio,
        requiredThreshold: darkRes.wcagRatio,
        details:
          "High-contrast theme mode must yield higher or equal luminance contrast relative to standard themes.",
      });
    }
  }

  return findings;
}
