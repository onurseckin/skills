import type { StructuredFinding, VisualMetricsReport } from "./dual-channel-types.ts";

export type FindingAdder = (
  category: StructuredFinding["category"],
  severity: StructuredFinding["severity"],
  message: string,
  remediation: string,
  affectedSelector?: string,
  viewport?: string,
) => void;

const DEFAULT_SUBPIXEL_TOLERANCE = 0.5;

function sanitizeSelector(selector?: string): string {
  if (typeof selector === "string" && selector.trim().length > 0) {
    return selector.trim();
  }
  return "(unspecified element)";
}

export function extractDomViolations(
  report: VisualMetricsReport,
  addFinding: FindingAdder,
  globalTolerance?: number,
): void {
  const effectiveTolerance =
    globalTolerance ?? report.subpixelTolerance ?? DEFAULT_SUBPIXEL_TOLERANCE;

  if (report.renderCacheReset === false) {
    addFinding(
      "render_cache",
      "error",
      "Render Cache Reset Invariant Violation: Layout render cache was not reset prior to visual metrics capture.",
      "Reset in-memory layout caches and local persistent storage before capturing layout geometry.",
    );
  }

  for (const vp of report.viewports) {
    const vpTolerance = vp.subpixelTolerance ?? effectiveTolerance;

    if (vp.renderCacheReset === false) {
      addFinding(
        "render_cache",
        "error",
        `Render Cache Reset Invariant Violation: Render cache was not reset for viewport '${vp.viewport}'.`,
        "Reset layout cache prior to viewport rendering.",
        undefined,
        vp.viewport,
      );
    }

    if (vp.overflowViolations) {
      for (const ov of vp.overflowViolations) {
        const selector = sanitizeSelector(ov.selector);
        const overflow =
          typeof ov.overflowX === "number" && !isNaN(ov.overflowX)
            ? ov.overflowX
            : typeof ov.scrollWidth === "number" && typeof ov.clientWidth === "number"
              ? ov.scrollWidth - ov.clientWidth
              : NaN;

        if (isNaN(overflow) || isNaN(ov.scrollWidth) || isNaN(ov.clientWidth)) {
          addFinding(
            "overflow",
            "error",
            `Malformed overflow dimension detected on '${selector}' in viewport '${vp.viewport}'.`,
            "Ensure layout metrics produce valid numerical dimensions.",
            selector,
            vp.viewport,
          );
        } else if (overflow >= vpTolerance) {
          addFinding(
            "overflow",
            "error",
            ov.message ||
              `Horizontal layout overflow detected: scrollWidth (${ov.scrollWidth}px) > clientWidth (${ov.clientWidth}px) with overflow ${overflow}px >= tolerance ${vpTolerance}px.`,
            "Ensure parent containers and flex/grid items have proper bounds (e.g., min-width: 0, overflow-x: hidden).",
            selector,
            vp.viewport,
          );
        }
      }
    }

    if (vp.clippingViolations) {
      for (const cv of vp.clippingViolations) {
        const selector = sanitizeSelector(cv.selector);
        const clipping =
          typeof cv.scrollHeight === "number" && typeof cv.clientHeight === "number"
            ? cv.scrollHeight - cv.clientHeight
            : NaN;

        if (isNaN(clipping) || isNaN(cv.scrollHeight) || isNaN(cv.clientHeight)) {
          addFinding(
            "clipping",
            "error",
            `Malformed clipping dimension detected on '${selector}' in viewport '${vp.viewport}'.`,
            "Ensure element height metrics are valid numbers.",
            selector,
            vp.viewport,
          );
        } else if (clipping >= vpTolerance) {
          addFinding(
            "clipping",
            "error",
            cv.message ||
              `Text clipping detected: scrollHeight (${cv.scrollHeight}px) > clientHeight (${cv.clientHeight}px).`,
            "Adjust line-height, padding, or container height to prevent text clipping and descending glyph cutoffs.",
            selector,
            vp.viewport,
          );
        }
      }
    }

    if (vp.stackingViolations) {
      for (const sv of vp.stackingViolations) {
        const topSel = sanitizeSelector(sv.topElementSelector);
        const botSel = sanitizeSelector(sv.bottomElementSelector);
        addFinding(
          "stacking",
          "error",
          sv.message || `Z-index stacking context collision between '${topSel}' and '${botSel}'.`,
          "Enforce strict z-index stacking hierarchy and isolate stacking contexts.",
          `${topSel} / ${botSel}`,
          vp.viewport,
        );
      }
    }

    if (vp.contrastViolations) {
      for (const ctv of vp.contrastViolations) {
        const selector = sanitizeSelector(ctv.selector);
        if (isNaN(ctv.contrastRatio) || isNaN(ctv.requiredRatio)) {
          addFinding(
            "contrast",
            "error",
            `Malformed contrast ratio calculation on '${selector}'.`,
            "Verify color luminance calculation produces finite positive ratios.",
            selector,
            vp.viewport,
          );
        } else {
          addFinding(
            "contrast",
            "error",
            ctv.message ||
              `WCAG ${ctv.wcagLevel} contrast ratio violation: ratio ${ctv.contrastRatio}:1 is below required ${ctv.requiredRatio}:1.`,
            "Adjust text color or background color to meet WCAG AA contrast ratio standards.",
            selector,
            vp.viewport,
          );
        }
      }
    }

    if (vp.orphanViolations) {
      for (const orph of vp.orphanViolations) {
        const selector = sanitizeSelector(orph.selector);
        if (isNaN(orph.x) || isNaN(orph.y) || orph.x < 0 || orph.y < 0) {
          addFinding(
            "orphan",
            "error",
            `Malformed or negative layout coordinates (${orph.x}, ${orph.y}) on '${selector}'.`,
            "Ensure element positioning produces valid, non-negative coordinates.",
            selector,
            vp.viewport,
          );
        } else if (orph.x === 0 && orph.y === 0) {
          addFinding(
            "orphan",
            "error",
            orph.message ||
              `Origin Orphan Invariant Violation: Unpositioned element stuck at origin coordinates (0, 0).`,
            "Provide explicit layout coordinates or layout constraints so element does not render stuck at (0, 0).",
            selector,
            vp.viewport,
          );
        }
      }
    }
  }
}
