import type { FindingAdder } from "../channels/dom-violation-extractor.ts";
import {
  auditCognitiveQuestionSemanticDepth,
  auditCriterionSemanticDepth,
  METRIC_PATTERN,
  SUPERFICIAL_BOILERPLATE_PATTERNS,
} from "./semantic-depth.ts";
import type {
  ManifestCriteriaValidationResult,
  ValidateCompanionManifestOptions,
} from "./types.ts";

export { METRIC_PATTERN, SUPERFICIAL_BOILERPLATE_PATTERNS };

export function validateCompanionManifestCriteria(
  manifest: unknown,
  addFinding: FindingAdder,
  indexOrOptions: number | ValidateCompanionManifestOptions = 0,
  maybeOptions?: ValidateCompanionManifestOptions,
): ManifestCriteriaValidationResult {
  const index = typeof indexOrOptions === "number" ? indexOrOptions : 0;
  const options =
    typeof indexOrOptions === "object" && indexOrOptions !== null ? indexOrOptions : maybeOptions;
  const requireSemanticDepth = options?.requireSemanticDepth ?? false;
  let hasErrors = false;
  const reportError: FindingAdder = (
    category,
    severity,
    message,
    remediation,
    affectedSelector,
    viewport,
  ) => {
    if (severity === "error") {
      hasErrors = true;
    }
    addFinding(category, severity, message, remediation, affectedSelector, viewport);
  };

  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    reportError(
      "invalid_manifest",
      "error",
      `Companion Manifest #${index + 1} Violation: Manifest is not a valid JSON object.`,
      "Ensure companion manifest is a structured JSON object with metadata and evaluated criteria.",
    );
    return { valid: false, evaluatedCriteriaCount: 0, passedCriteriaCount: 0, pillarsPresent: [] };
  }

  const m = manifest as Record<string, unknown>;
  const screenId =
    typeof m.screenId === "string"
      ? m.screenId
      : typeof m.screen_id === "string"
        ? m.screen_id
        : undefined;
  const viewport = typeof m.viewport === "string" ? m.viewport : undefined;
  const manifestLabel =
    screenId && viewport ? `${screenId}-${viewport}.manifest.json` : `Manifest #${index + 1}`;

  if (!screenId || !viewport) {
    reportError(
      "invalid_manifest",
      "error",
      `Companion Manifest '${manifestLabel}' Violation: Missing required screenId or viewport fields.`,
      "Companion manifests must identify screenId and viewport.",
      undefined,
      viewport,
    );
  }

  // Extract criteria
  const rawCriteria: unknown[] = [];
  if (Array.isArray(m.criteria)) {
    rawCriteria.push(...m.criteria);
  } else if (Array.isArray(m.evaluatedCriteria)) {
    rawCriteria.push(...m.evaluatedCriteria);
  } else if (Array.isArray(m.allCriteria)) {
    rawCriteria.push(...m.allCriteria);
  } else if (typeof m.pillars === "object" && m.pillars !== null) {
    const p = m.pillars as Record<string, unknown>;
    for (const pillarKey of ["mechanical", "cognitive", "product", "ux", "custom"]) {
      const pObj = p[pillarKey];
      if (typeof pObj === "object" && pObj !== null) {
        const critList =
          (pObj as Record<string, unknown>).criteria ??
          (pObj as Record<string, unknown>).evaluatedCriteria;
        if (Array.isArray(critList)) {
          rawCriteria.push(...critList);
        }
      }
    }
  }

  if (rawCriteria.length === 0) {
    reportError(
      "missing_manifest_criteria",
      "error",
      `Companion Manifest '${manifestLabel}' Violation: Manifest contains no evaluated criteria records.`,
      "Companion manifests must evaluate and record criteria across all 4 mandatory pillars: Mechanical (CRIT-MECH-*), Cognitive (CRIT-COGN-*), Product Heuristics (CRIT-PROD-*/CRIT-CUST-*), UX Ergonomics (CRIT-UX-*).",
      undefined,
      viewport,
    );
    return { valid: false, evaluatedCriteriaCount: 0, passedCriteriaCount: 0, pillarsPresent: [] };
  }

  const pillarsFound = new Set<string>();
  let passedCount = 0;

  for (let i = 0; i < rawCriteria.length; i++) {
    const item = rawCriteria[i];
    if (typeof item !== "object" || item === null) {
      reportError(
        "invalid_manifest_criterion",
        "error",
        `Companion Manifest '${manifestLabel}' Criterion #${i + 1} Violation: Criterion entry is not a valid object.`,
        "Each criterion must be an object with id, pillar, passed, and details/evidence.",
        undefined,
        viewport,
      );
      continue;
    }
    const c = item as Record<string, unknown>;
    const critId = typeof c.id === "string" ? c.id.trim() : `CRIT-UNKNOWN-${i + 1}`;
    const pillar = typeof c.pillar === "string" ? c.pillar.toLowerCase() : "";

    const upperId = critId.toUpperCase();
    if (upperId.startsWith("CRIT-MECH-") || pillar === "mechanical") {
      pillarsFound.add("mechanical");
    } else if (upperId.startsWith("CRIT-COGN-") || pillar === "cognitive") {
      pillarsFound.add("cognitive");
    } else if (
      upperId.startsWith("CRIT-PROD-") ||
      upperId.startsWith("CRIT-CUST-") ||
      pillar === "product" ||
      pillar === "custom"
    ) {
      pillarsFound.add("product");
    } else if (upperId.startsWith("CRIT-UX-") || pillar === "ux") {
      pillarsFound.add("ux");
    }

    // 1. Explicit boolean passed
    if (typeof c.passed !== "boolean") {
      reportError(
        "invalid_manifest_criterion",
        "error",
        `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Missing explicit boolean 'passed' property.`,
        "Every criterion must specify an explicit boolean 'passed: true' or 'passed: false'.",
        undefined,
        viewport,
      );
    }

    // 2. Details and Evidence validation
    const detailsStr = typeof c.details === "string" ? c.details.trim() : "";
    const evidenceStr = typeof c.evidence === "string" ? c.evidence.trim() : "";
    const hasDetails = detailsStr.length > 0;
    const hasEvidence = evidenceStr.length > 0;

    if (!hasDetails && !hasEvidence) {
      reportError(
        "invalid_manifest_criterion",
        "error",
        `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Missing non-empty 'details' or 'evidence' string.`,
        "Every criterion must provide non-empty diagnostic details or quantitative evidence.",
        undefined,
        viewport,
      );
    }

    // 3. Strict Semantic Depth Audits (when requireSemanticDepth is enabled)
    if (requireSemanticDepth) {
      auditCriterionSemanticDepth(
        detailsStr,
        evidenceStr,
        critId,
        manifestLabel,
        viewport,
        reportError,
      );
    }

    // 4. Pass verification
    if (c.passed === true) {
      passedCount++;
    } else if (c.passed === false) {
      const detailsMsg = hasDetails ? detailsStr : hasEvidence ? evidenceStr : "Criterion failed";
      reportError(
        "manifest_criterion_failed",
        "error",
        `Companion Manifest '${manifestLabel}' Criterion Failed: [${critId}] ${detailsMsg}`,
        `Remediate the underlying violation for criterion '${critId}' and re-evaluate companion manifest.`,
        undefined,
        viewport,
      );
    }
  }

  // 4 Mandatory Pillars
  const mandatoryPillars = [
    { key: "mechanical", label: "Mechanical Criteria (CRIT-MECH-*)" },
    { key: "cognitive", label: "Cognitive Criteria (CRIT-COGN-*)" },
    { key: "product", label: "Product Heuristics (CRIT-PROD-* / CRIT-CUST-*)" },
    { key: "ux", label: "UX Ergonomics (CRIT-UX-*)" },
  ];

  for (const pillar of mandatoryPillars) {
    if (!pillarsFound.has(pillar.key)) {
      reportError(
        "missing_pillar_criteria",
        "error",
        `Companion Manifest '${manifestLabel}' 4-Pillar Mandate Violation: Missing evaluated criteria for ${pillar.label}.`,
        `Ensure companion manifest evaluates criteria across all 4 mandatory pillars: Mechanical (CRIT-MECH-*), Cognitive (CRIT-COGN-*), Product Heuristics (CRIT-PROD-*/CRIT-CUST-*), UX Ergonomics (CRIT-UX-*).`,
        undefined,
        viewport,
      );
    }
  }

  // 5. Cognitive Analysis Questionnaire Verification (if present)
  if (typeof m.cognitiveAnalysis === "object" && m.cognitiveAnalysis !== null) {
    const cog = m.cognitiveAnalysis as Record<string, unknown>;
    if (Array.isArray(cog.questions)) {
      for (const q of cog.questions) {
        if (typeof q === "object" && q !== null) {
          const qObj = q as Record<string, unknown>;
          const qId = typeof qObj.id === "string" ? qObj.id : "Q-UNKNOWN";
          if (qObj.passed === false) {
            const obs =
              typeof qObj.observation === "string"
                ? qObj.observation
                : "Cognitive heuristic violated";
            reportError(
              "manifest_criterion_failed",
              "error",
              `Companion Manifest '${manifestLabel}' Cognitive Question Defect: [${qId}] ${obs}`,
              `Address cognitive / ergonomic defect identified in question '${qId}'.`,
              undefined,
              viewport,
            );
          } else if (requireSemanticDepth) {
            const obs = typeof qObj.observation === "string" ? qObj.observation.trim() : "";
            const ev = typeof qObj.evidence === "string" ? qObj.evidence.trim() : "";
            auditCognitiveQuestionSemanticDepth(
              obs,
              ev,
              qId,
              manifestLabel,
              viewport,
              reportError,
            );
          }
        }
      }
    }
  }

  const allPillarsPresent = mandatoryPillars.every((p) => pillarsFound.has(p.key));
  return {
    valid: !hasErrors && allPillarsPresent && passedCount === rawCriteria.length,
    evaluatedCriteriaCount: rawCriteria.length,
    passedCriteriaCount: passedCount,
    pillarsPresent: Array.from(pillarsFound),
  };
}
