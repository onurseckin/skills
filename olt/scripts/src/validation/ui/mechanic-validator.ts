import { ALL_4_VIEWPORT_TIERS, MIN_SCREENSHOT_BYTES, MIN_TOUCH_HITBOX_PT } from "./constants.ts";
import { inspectAllTouchHitboxes } from "./hitbox-detector.ts";
import { inspectAllOverflowElements } from "./overflow-detector.ts";
import type { UiMechanicInspectionInput, UiMechanicReport, UiViewportTier } from "./types.ts";

export function validateUiMechanic(input: UiMechanicInspectionInput): UiMechanicReport {
  const targetViewports = input.viewports ?? ALL_4_VIEWPORT_TIERS;
  const recordedViewports = new Set<UiViewportTier>();

  for (const s of input.screenshots ?? []) {
    if (s.viewport && ALL_4_VIEWPORT_TIERS.includes(s.viewport as UiViewportTier)) {
      recordedViewports.add(s.viewport as UiViewportTier);
    }
  }
  for (const j of input.journeys ?? []) {
    recordedViewports.add(j.viewport);
  }

  const missingViewports = targetViewports.filter((vp) => !recordedViewports.has(vp));

  const { evaluations: touchEvals, failures: touchFailures } = inspectAllTouchHitboxes(
    input.touchTargets ?? [],
    input.minTouchDimension ?? MIN_TOUCH_HITBOX_PT,
  );

  const { evaluations: overflowEvals, violations: overflowViolations } =
    inspectAllOverflowElements(input.overflowElements ?? []);

  const validScreenshots = (input.screenshots ?? []).filter(
    (s) => s.sizeBytes >= MIN_SCREENSHOT_BYTES,
  );

  const journeyFailures = (input.journeys ?? []).filter((j) => !j.passed);

  const totalDefects =
    touchFailures.length +
    overflowViolations.length +
    journeyFailures.length +
    (missingViewports.length > 0 && (input.screenshots?.length ?? 0) > 0
      ? missingViewports.length
      : 0);

  const passed =
    touchFailures.length === 0 &&
    overflowViolations.length === 0 &&
    journeyFailures.length === 0;

  const summaryParts: string[] = [];
  summaryParts.push(
    `UI Mechanic: ${touchEvals.length} touch hitboxes inspected (${touchFailures.length} defect(s)), ${overflowEvals.length} overflow checks (${overflowViolations.length} defect(s))`,
  );
  if (missingViewports.length > 0) {
    summaryParts.push(`Missing viewports: ${missingViewports.join(", ")}`);
  }
  summaryParts.push(
    `Playwright journeys: ${(input.journeys ?? []).length} (${journeyFailures.length} failed), Screenshots: ${validScreenshots.length} valid (>= 1024B)`,
  );

  return {
    passed,
    viewportsCovered: Array.from(recordedViewports),
    missingViewports,
    touchTargetEvaluations: touchEvals,
    touchTargetFailures: touchFailures,
    overflowEvaluations: overflowEvals,
    overflowViolations,
    journeyResults: input.journeys ?? [],
    validScreenshotsCount: validScreenshots.length,
    totalDefects,
    summary: summaryParts.join(". "),
  };
}
