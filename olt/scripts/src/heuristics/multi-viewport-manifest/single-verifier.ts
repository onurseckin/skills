/**
 * @file single-verifier.ts
 * Single viewport companion manifest and screenshot artifact verification
 */

import type {
  CompanionManifestV2,
  EvaluatedCriterion,
  PillarValidationResult,
} from "../../capture/validator/types.ts";
import { MANDATORY_PILLARS, MINIMUM_SCREENSHOT_BYTES } from "./constants.ts";
import { computePhysicalViewportMetrics } from "./metrics.ts";
import { normalizePillar } from "./pillars.ts";
import { auditCriterionSemanticDepth } from "./semantic-depth.ts";
import type {
  MandatoryPillar,
  MultiViewportDefect,
  ScreenshotArtifact,
  SingleViewportAudit,
  SingleViewportAuditOptions,
} from "./types.ts";

/**
 * Validates a single viewport companion manifest and its corresponding screenshot.
 */
export function auditSingleViewportManifest(
  viewport: string,
  manifest: unknown,
  screenshot?: ScreenshotArtifact,
  options?: SingleViewportAuditOptions,
): SingleViewportAudit {
  const defects: MultiViewportDefect[] = [];
  const effectiveDpr = options?.devicePixelRatio ?? options?.dpr ?? screenshot?.dpr;
  const physicalMetrics = computePhysicalViewportMetrics(viewport, effectiveDpr);

  // Check screenshot bytes
  let screenshotSizeBytes = 0;
  let hasValidScreenshot = false;

  if (screenshot) {
    if (screenshot.sizeBytes !== undefined) {
      screenshotSizeBytes = screenshot.sizeBytes;
    } else if (screenshot.buffer !== undefined) {
      screenshotSizeBytes = screenshot.buffer.length;
    }

    if (screenshotSizeBytes < MINIMUM_SCREENSHOT_BYTES) {
      defects.push({
        id: `screenshot-undersized-${viewport}`,
        category: "undersized_screenshot",
        severity: "critical",
        viewport,
        message: `Screenshot for viewport '${viewport}' is ${screenshotSizeBytes} bytes, which is below the minimum required ${MINIMUM_SCREENSHOT_BYTES} bytes (rejecting dummy stubs).`,
        metadata: {
          sizeBytes: screenshotSizeBytes,
          minimumRequired: MINIMUM_SCREENSHOT_BYTES,
        },
      });
    } else {
      hasValidScreenshot = true;
    }
  } else {
    defects.push({
      id: `screenshot-missing-${viewport}`,
      category: "missing_screenshot",
      severity: "critical",
      viewport,
      message: `Missing required screenshot artifact for viewport '${viewport}'.`,
    });
  }

  // Validate manifest structure
  if (!manifest || typeof manifest !== "object") {
    defects.push({
      id: `manifest-invalid-${viewport}`,
      category: "invalid_manifest",
      severity: "critical",
      viewport,
      message: `Manifest for viewport '${viewport}' is invalid or not an object.`,
    });

    return {
      viewport,
      passed: false,
      hasValidScreenshot,
      screenshotSizeBytes,
      coveredPillars: [],
      missingPillars: [...MANDATORY_PILLARS],
      totalCriteriaCount: 0,
      passedCriteriaCount: 0,
      dpr: physicalMetrics.dpr,
      physicalMetrics,
      defects,
    };
  }

  const manifestObj = manifest as Partial<CompanionManifestV2> & Record<string, unknown>;

  // Extract criteria
  const rawCriteria = Array.isArray(manifestObj.criteria) ? manifestObj.criteria : [];
  const criteriaList: EvaluatedCriterion[] = [];

  for (const c of rawCriteria) {
    if (c && typeof c === "object") {
      criteriaList.push(c as EvaluatedCriterion);
    }
  }

  // Also check pillars object if criteria array is empty or partial
  const pillarObj = manifestObj.pillars as
    | Record<string, PillarValidationResult | undefined>
    | undefined;

  const coveredPillarsSet = new Set<MandatoryPillar>();

  // Detect covered pillars from criteria
  for (const crit of criteriaList) {
    const norm = normalizePillar(crit.pillar);
    if (norm) {
      coveredPillarsSet.add(norm);
    }
  }

  // Detect covered pillars from pillar objects
  if (pillarObj) {
    for (const key of Object.keys(pillarObj)) {
      const norm = normalizePillar(key);
      if (norm && pillarObj[key]) {
        coveredPillarsSet.add(norm);
      }
    }
  }

  const coveredPillars: MandatoryPillar[] = Array.from(coveredPillarsSet);
  const missingPillars: MandatoryPillar[] = MANDATORY_PILLARS.filter(
    (p) => !coveredPillarsSet.has(p),
  );

  if (missingPillars.length > 0) {
    for (const mp of missingPillars) {
      defects.push({
        id: `manifest-missing-pillar-${viewport}-${mp}`,
        category: "missing_pillar",
        severity: "critical",
        viewport,
        pillar: mp,
        message: `Companion manifest for viewport '${viewport}' is missing certification for mandatory pillar '${mp}'.`,
      });
    }
  }

  let passedCriteriaCount = 0;

  // Validate each criterion for explicit boolean passed, non-empty details, non-empty evidence
  for (let i = 0; i < criteriaList.length; i++) {
    const crit = criteriaList[i];
    if (!crit) continue;

    const critId = crit.id || `crit-${i}`;

    // 1. Explicit boolean check
    if (typeof crit.passed !== "boolean") {
      defects.push({
        id: `manifest-crit-non-bool-${viewport}-${critId}`,
        category: "missing_boolean_passed",
        severity: "critical",
        viewport,
        criterionId: critId,
        pillar: crit.pillar,
        message: `Criterion '${critId}' in viewport '${viewport}' missing explicit boolean 'passed' property.`,
      });
    } else if (crit.passed === true) {
      passedCriteriaCount++;
    } else {
      defects.push({
        id: `manifest-crit-failed-${viewport}-${critId}`,
        category: "criterion_failed",
        severity: "serious",
        viewport,
        criterionId: critId,
        pillar: crit.pillar,
        message: `Criterion '${critId}' in viewport '${viewport}' failed: ${crit.details ?? crit.name}`,
      });
    }

    // 2. Non-empty details & evidence check
    const details = typeof crit.details === "string" ? crit.details.trim() : "";
    const evidence = typeof crit.evidence === "string" ? crit.evidence.trim() : "";

    if (details.length === 0 && evidence.length === 0) {
      defects.push({
        id: `manifest-crit-empty-evidence-${viewport}-${critId}`,
        category: "empty_details_evidence",
        severity: "serious",
        viewport,
        criterionId: critId,
        pillar: crit.pillar,
        message: `Criterion '${critId}' in viewport '${viewport}' has both empty 'details' and empty 'evidence'.`,
      });
    }

    // 3. Optional strict semantic depth verification
    if (options?.requireSemanticDepth) {
      const depthAudit = auditCriterionSemanticDepth(crit);
      for (const d of depthAudit.defects) {
        defects.push({
          id: `manifest-depth-${viewport}-${d.id}`,
          category:
            d.category === "boilerplate_evidence" ? "boilerplate_evidence" : "superficial_evidence",
          severity: d.severity,
          viewport,
          criterionId: critId,
          pillar: crit.pillar,
          message: d.message,
        });
      }
    }
  }

  const passed = defects.length === 0;

  return {
    viewport,
    passed,
    hasValidScreenshot,
    screenshotSizeBytes,
    coveredPillars,
    missingPillars,
    totalCriteriaCount: criteriaList.length,
    passedCriteriaCount,
    dpr: physicalMetrics.dpr,
    physicalMetrics,
    defects,
  };
}
