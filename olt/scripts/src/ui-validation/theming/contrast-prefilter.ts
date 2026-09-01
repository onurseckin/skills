import type { ContrastAuditTarget, ContrastAuditResult, SurfaceContrastReport } from "./types.ts";
import {
  calculateWcagContrastRatio,
  calculateApcaContrast,
  isWcagAaCompliant,
  isWcagAaaCompliant,
  isApcaCompliant,
} from "./contrast-math.ts";
export class MathematicalContrastPreFilter {
  /**
   * Audit a single element's color pair
   */
  public auditElement(target: ContrastAuditTarget): ContrastAuditResult {
    const wcagRatio = calculateWcagContrastRatio(target.foregroundColor, target.backgroundColor);
    const apcaLc = calculateApcaContrast(target.foregroundColor, target.backgroundColor);

    const isLarge = target.isLargeText || target.role === "headingText";
    const isUi = target.role === "border" || target.role === "icon";

    const wcagAaPassed = isWcagAaCompliant(wcagRatio, {
      isLargeText: isLarge,
      isUiComponent: isUi,
    });
    const wcagAaaPassed = isWcagAaaCompliant(wcagRatio, { isLargeText: isLarge });

    let apcaType: "body" | "large" | "subtle" | "fluent" = "body";
    if (isLarge) apcaType = "large";
    else if (target.role === "mutedText" || isUi) apcaType = "subtle";

    const apcaPassed = isApcaCompliant(apcaLc, apcaType);

    return {
      elementId: target.elementId,
      ...(target.role !== undefined ? { role: target.role } : {}),
      foregroundColor: target.foregroundColor,
      backgroundColor: target.backgroundColor,
      wcagRatio,
      apcaLc,
      wcagAaPassed,
      wcagAaaPassed,
      apcaPassed,
    };
  }

  /**
   * Sweep a batch of targets for a given permutation surface
   */
  public sweepSurface(
    permutationId: string,
    targets: readonly ContrastAuditTarget[],
  ): SurfaceContrastReport {
    const results = targets.map((t) => this.auditElement(t));
    const failedCount = results.filter((r) => !r.wcagAaPassed).length;
    const passedCount = results.length - failedCount;

    return {
      permutationId,
      auditedElementsCount: results.length,
      passedCount,
      failedCount,
      allPassed: failedCount === 0,
      results,
    };
  }
}

/**
 * ============================================================================
 * 3. Dedicated Round 4 Thematic Gating
 * ============================================================================
 */
