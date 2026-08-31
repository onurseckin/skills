import {
  ALL_4_VIEWPORT_TIERS,
  MIN_SCREENSHOT_BYTES,
  MIN_TOUCH_HITBOX_PT,
  MIN_VISUAL_ENTROPY_SCORE,
} from "./constants.ts";
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
  for (const o of input.overflowElements ?? []) {
    if (o.viewport && ALL_4_VIEWPORT_TIERS.includes(o.viewport as UiViewportTier)) {
      recordedViewports.add(o.viewport as UiViewportTier);
    }
  }

  const isFullMatrixRequired =
    input.requireAllViewports === true ||
    input.viewports !== undefined ||
    (input.screenshots !== undefined && input.screenshots.length > 0) ||
    (input.journeys !== undefined && input.journeys.length > 0);

  const missingViewports = isFullMatrixRequired
    ? targetViewports.filter((vp) => !recordedViewports.has(vp))
    : [];

  const { evaluations: touchEvals, failures: touchFailures } = inspectAllTouchHitboxes(
    input.touchTargets ?? [],
    input.minTouchDimension ?? MIN_TOUCH_HITBOX_PT,
  );

  const { evaluations: overflowEvals, violations: overflowViolations } = inspectAllOverflowElements(
    input.overflowElements ?? [],
  );

  const validScreenshots = (input.screenshots ?? []).filter((s) => {
    if (s.sizeBytes < MIN_SCREENSHOT_BYTES) return false;
    if (s.isBlank === true) return false;
    if (s.entropyScore !== undefined && s.entropyScore < MIN_VISUAL_ENTROPY_SCORE) return false;
    return true;
  });

  const screenshotDefects = (input.screenshots ?? []).length - validScreenshots.length;
  const journeyFailures = (input.journeys ?? []).filter((j) => !j.passed);

  const lifecycleViolations: string[] = [];
  if (input.lifecycleInvariants) {
    if (input.lifecycleInvariants.fontsReady === false) {
      lifecycleViolations.push(
        "Browser lifecycle invariant violation: document.fonts.ready was not resolved before capture",
      );
    }
    if (input.lifecycleInvariants.networkIdle === false) {
      lifecycleViolations.push(
        "Browser lifecycle invariant violation: network was not idle during render stabilization",
      );
    }
    if (input.lifecycleInvariants.layoutQuiet === false) {
      lifecycleViolations.push(
        "Browser lifecycle invariant violation: layout quiet window not reached",
      );
    }
    if (input.lifecycleInvariants.freshContextPerViewport === false) {
      lifecycleViolations.push(
        "Browser lifecycle invariant violation: fresh browser context per viewport was not isolated",
      );
    }
    if (input.lifecycleInvariants.hydrationComplete === false) {
      lifecycleViolations.push(
        "Browser lifecycle invariant violation: async hydration incomplete before assertions",
      );
    }
  }

  const totalDefects =
    touchFailures.length +
    overflowViolations.length +
    journeyFailures.length +
    missingViewports.length +
    screenshotDefects +
    lifecycleViolations.length;

  const passed =
    touchFailures.length === 0 &&
    overflowViolations.length === 0 &&
    journeyFailures.length === 0 &&
    missingViewports.length === 0 &&
    screenshotDefects === 0 &&
    lifecycleViolations.length === 0;

  const summaryParts: string[] = [];
  summaryParts.push(
    `UI Mechanic: ${touchEvals.length} touch hitboxes inspected (${touchFailures.length} defect(s)), ${overflowEvals.length} overflow checks (${overflowViolations.length} defect(s))`,
  );
  if (missingViewports.length > 0) {
    summaryParts.push(`Missing viewports: ${missingViewports.join(", ")}`);
  }
  if (lifecycleViolations.length > 0) {
    summaryParts.push(`Lifecycle violations: ${lifecycleViolations.length}`);
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
    lifecycleViolations,
    totalDefects,
    summary: summaryParts.join(". "),
  };
}
