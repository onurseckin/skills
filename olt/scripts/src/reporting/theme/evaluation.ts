import {
  THEME_MODES,
  CONTRAST_STANDARDS,
  type ThemeMode,
  type ContrastStandard,
  type ElementThemePair,
  type ContrastEvaluation,
  type ThemeContrastElementResult,
  type ThemeContrastMatrix,
  type RegressionSeverity,
  type ThemeRegressionFinding,
  type MultiThemeComparisonReport,
} from "./types.ts";
import {
  isValidColor,
  parseRgb,
  compositeRgb,
  calculateWcagContrast,
  calculateApcaContrast,
} from "./color-space.ts";
import { resolveIsLargeText, getRequiredThreshold, evaluateSingleStandard } from "./thresholds.ts";
import { checkThemeRegressions } from "./regression-detector.ts";

export { resolveIsLargeText, getRequiredThreshold, evaluateSingleStandard };

export function evaluateThemeContrastMatrix(
  elements: readonly ElementThemePair[],
  standards: readonly ContrastStandard[] = CONTRAST_STANDARDS,
): MultiThemeComparisonReport {
  const evaluatedStandards: readonly ContrastStandard[] =
    standards.length === 0 ? CONTRAST_STANDARDS : standards;

  const selectorMap = new Map<string, ElementThemePair[]>();
  const discoveredThemes = new Set<ThemeMode>();

  for (const pair of elements) {
    discoveredThemes.add(pair.theme);
    const existing = selectorMap.get(pair.selector);
    if (existing !== undefined) {
      existing.push(pair);
    } else {
      selectorMap.set(pair.selector, [pair]);
    }
  }

  const evaluatedThemes =
    discoveredThemes.size > 0 ? Array.from(discoveredThemes) : [...THEME_MODES];

  const matrices: ThemeContrastMatrix[] = [];
  const findings: ThemeRegressionFinding[] = [];
  let totalChecks = 0;
  let passedChecks = 0;
  let failedChecks = 0;

  const themeCheckStats: Record<ThemeMode, { passed: number; total: number }> = {
    light: { passed: 0, total: 0 },
    dark: { passed: 0, total: 0 },
    "high-contrast-light": { passed: 0, total: 0 },
    "high-contrast-dark": { passed: 0, total: 0 },
  };

  let findingCounter = 0;
  const generateFindingId = (prefix: string): string => {
    findingCounter += 1;
    return `TRF-${prefix}-${findingCounter.toString().padStart(3, "0")}`;
  };

  for (const [selector, pairs] of selectorMap.entries()) {
    const themeResults: Partial<Record<ThemeMode, ThemeContrastElementResult>> = {};
    let elementOverallPassed = true;
    let anyLargeText = false;
    let elementName: string | undefined = undefined;

    const pairByTheme = new Map<ThemeMode, ElementThemePair>();
    for (const p of pairs) {
      pairByTheme.set(p.theme, p);
      if (p.element !== undefined && elementName === undefined) {
        elementName = p.element;
      }
      if (resolveIsLargeText(p.isLargeText, p.fontSize, p.fontWeight)) {
        anyLargeText = true;
      }
    }

    for (const theme of evaluatedThemes) {
      const pair = pairByTheme.get(theme);

      if (pair === undefined) {
        findings.push({
          id: generateFindingId("MISSING"),
          selector,
          theme,
          standard: "wcag-aa",
          severity: "moderate",
          message: `Incomplete theme pair: selector "${selector}" is missing definitions for theme mode "${theme}".`,
          foregroundColor: "none",
          backgroundColor: "none",
          contrastRatio: 0,
          requiredThreshold: getRequiredThreshold("wcag-aa", anyLargeText),
          details: `Missing theme pair leads to unverified accessibility compliance when users switch to ${theme} mode.`,
        });
        elementOverallPassed = false;
        continue;
      }

      const fgValid = isValidColor(pair.foregroundColor);
      const bgValid = isValidColor(pair.backgroundColor);

      if (!fgValid || !bgValid) {
        const invalidDetails =
          !fgValid && !bgValid
            ? `Both foreground "${pair.foregroundColor}" and background "${pair.backgroundColor}" are invalid color expressions.`
            : !fgValid
              ? `Foreground color "${pair.foregroundColor}" is an invalid color expression.`
              : `Background color "${pair.backgroundColor}" is an invalid color expression.`;

        findings.push({
          id: generateFindingId("SYNTAX"),
          selector,
          theme,
          standard: "wcag-aa",
          severity: "critical",
          message: `Invalid color expression in selector "${selector}" (${theme} mode): ${invalidDetails}`,
          foregroundColor: pair.foregroundColor,
          backgroundColor: pair.backgroundColor,
          contrastRatio: 0,
          requiredThreshold: getRequiredThreshold("wcag-aa", anyLargeText),
          details: invalidDetails,
        });
        elementOverallPassed = false;
        continue;
      }

      const isLarge = resolveIsLargeText(pair.isLargeText, pair.fontSize, pair.fontWeight);
      const wcagRatio = calculateWcagContrast(pair.foregroundColor, pair.backgroundColor);
      const apcaLc = calculateApcaContrast(pair.foregroundColor, pair.backgroundColor);

      const fgRgb = parseRgb(pair.foregroundColor);
      const bgRgb = parseRgb(pair.backgroundColor);
      const effectiveBg =
        bgRgb.a < 1 ? compositeRgb(bgRgb, { r: 255, g: 255, b: 255, a: 1 }) : bgRgb;
      const effectiveFg = fgRgb.a < 1 ? compositeRgb(fgRgb, effectiveBg) : fgRgb;

      const evaluations: ContrastEvaluation[] = [];
      let themePassed = true;

      for (const standard of evaluatedStandards) {
        const evalResult = evaluateSingleStandard(standard, wcagRatio, apcaLc, isLarge);
        evaluations.push(evalResult);
        totalChecks += 1;
        themeCheckStats[theme].total += 1;

        if (evalResult.passed) {
          passedChecks += 1;
          themeCheckStats[theme].passed += 1;
        } else {
          failedChecks += 1;
          themePassed = false;
          elementOverallPassed = false;

          let severity: RegressionSeverity = "serious";
          if (theme.startsWith("high-contrast")) {
            severity = "critical";
          } else if (standard === "wcag-aaa") {
            severity = "minor";
          } else if (wcagRatio < 3.0) {
            severity = "critical";
          }

          findings.push({
            id: generateFindingId("FAIL"),
            selector,
            theme,
            standard,
            severity,
            message: `Contrast failure for "${selector}" in "${theme}" mode under ${standard.toUpperCase()}: required ${evalResult.requiredThreshold.toFixed(1)}, found ${evalResult.contrastRatio.toFixed(2)}.`,
            foregroundColor: pair.foregroundColor,
            backgroundColor: pair.backgroundColor,
            contrastRatio: evalResult.contrastRatio,
            requiredThreshold: evalResult.requiredThreshold,
            details: evalResult.note,
          });
        }
      }

      themeResults[theme] = {
        foregroundColor: pair.foregroundColor,
        backgroundColor: pair.backgroundColor,
        effectiveForeground: effectiveFg,
        effectiveBackground: effectiveBg,
        wcagRatio,
        apcaLc,
        evaluations,
        passed: themePassed,
      };
    }

    const regressions = checkThemeRegressions(
      selector,
      themeResults,
      anyLargeText,
      generateFindingId,
    );
    for (const r of regressions) {
      findings.push(r);
    }

    matrices.push({
      selector,
      ...(elementName !== undefined ? { element: elementName } : {}),
      themes: themeResults,
      overallPassed: elementOverallPassed,
      isLargeText: anyLargeText,
    });
  }

  const themePassRates: Partial<Record<ThemeMode, number>> = {};
  for (const t of evaluatedThemes) {
    const stats = themeCheckStats[t];
    themePassRates[t] =
      stats.total > 0 ? Math.round((stats.passed / stats.total) * 1000) / 10 : 100;
  }

  const passRate = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 1000) / 10 : 100;

  return {
    timestamp: new Date().toISOString(),
    totalElements: selectorMap.size,
    evaluatedThemes,
    evaluatedStandards,
    matrices,
    findings,
    summary: {
      totalChecks,
      passedChecks,
      failedChecks,
      passRate,
      themePassRates,
    },
    overallPassed: failedChecks === 0 && findings.length === 0,
  };
}
