/**
 * @file semantic-depth.ts
 * Semantic depth and anti-boilerplate evidence auditing for criteria and manifests
 */

import type { EvaluatedCriterion } from "../../capture/validator/types.ts";
import { SUPERFICIAL_BOILERPLATE_PATTERNS } from "./constants.ts";
import type {
  ManifestSemanticDepthResult,
  SemanticDepthAuditResult,
  SemanticDepthDefect,
} from "./types.ts";

/**
 * Evaluates semantic depth of a single criterion, flagging superficial or boilerplate details and evidence.
 */
export function auditCriterionSemanticDepth(criterion: {
  readonly id?: string | undefined;
  readonly pillar?: string | undefined;
  readonly name?: string | undefined;
  readonly details?: string | undefined;
  readonly evidence?: string | undefined;
}): SemanticDepthAuditResult {
  const critId = criterion.id ?? "unknown-criterion";
  const pillar = criterion.pillar;
  const details = typeof criterion.details === "string" ? criterion.details.trim() : "";
  const evidence = typeof criterion.evidence === "string" ? criterion.evidence.trim() : "";
  const defects: SemanticDepthDefect[] = [];

  // Check details boilerplate
  if (details.length === 0) {
    defects.push({
      id: `semantic-details-empty-${critId}`,
      category: "boilerplate_evidence",
      severity: "serious",
      criterionId: critId,
      pillar,
      message: `Criterion '${critId}' details is empty or missing.`,
      details,
      evidence,
    });
  } else if (SUPERFICIAL_BOILERPLATE_PATTERNS.has(details.toLowerCase())) {
    defects.push({
      id: `semantic-details-boilerplate-${critId}`,
      category: "boilerplate_evidence",
      severity: "serious",
      criterionId: critId,
      pillar,
      message: `Criterion '${critId}' contains superficial boilerplate details: '${details}'.`,
      details,
      evidence,
    });
  } else if (details.length < 12) {
    defects.push({
      id: `semantic-details-superficial-${critId}`,
      category: "superficial_evidence",
      severity: "moderate",
      criterionId: critId,
      pillar,
      message: `Criterion '${critId}' details ('${details}') is too brief (< 12 characters) to provide meaningful qualitative diagnosis.`,
      details,
      evidence,
    });
  }

  // Check evidence boilerplate & quantitative metrics
  const metricMatches = evidence.match(/\b\d+(\.\d+)?(px|%|rem|em|ms|s|B|KB|MB|Lc|fps)?\b/gi);
  const metricsFound = metricMatches ? Array.from(new Set(metricMatches)) : [];

  if (evidence.length === 0) {
    defects.push({
      id: `semantic-evidence-empty-${critId}`,
      category: "boilerplate_evidence",
      severity: "serious",
      criterionId: critId,
      pillar,
      message: `Criterion '${critId}' evidence is empty or missing.`,
      details,
      evidence,
    });
  } else if (SUPERFICIAL_BOILERPLATE_PATTERNS.has(evidence.toLowerCase())) {
    defects.push({
      id: `semantic-evidence-boilerplate-${critId}`,
      category: "boilerplate_evidence",
      severity: "serious",
      criterionId: critId,
      pillar,
      message: `Criterion '${critId}' contains superficial boilerplate evidence: '${evidence}'.`,
      details,
      evidence,
    });
  } else if (evidence.length < 12) {
    defects.push({
      id: `semantic-evidence-superficial-${critId}`,
      category: "superficial_evidence",
      severity: "moderate",
      criterionId: critId,
      pillar,
      message: `Criterion '${critId}' evidence ('${evidence}') is too brief (< 12 characters) to provide empirical validation proof.`,
      details,
      evidence,
    });
  } else if (metricsFound.length === 0) {
    defects.push({
      id: `semantic-evidence-no-metrics-${critId}`,
      category: "missing_evidence_metrics",
      severity: "minor",
      criterionId: critId,
      pillar,
      message: `Criterion '${critId}' evidence lacks quantitative measurements (numbers, pixel dimensions, counts, or units).`,
      details,
      evidence,
    });
  }

  const qualitativeDepthScore =
    details.length >= 30 ? 1.0 : details.length >= 15 ? 0.6 : details.length > 0 ? 0.3 : 0.0;
  const quantitativeDepthScore =
    metricsFound.length >= 2
      ? 1.0
      : metricsFound.length === 1
        ? 0.7
        : evidence.length >= 30
          ? 0.5
          : 0.1;

  const combinedDepthScore = Number(
    (qualitativeDepthScore * 0.4 + quantitativeDepthScore * 0.6).toFixed(2),
  );
  const isDeep = combinedDepthScore >= 0.5 && defects.length === 0;

  return {
    isDeep,
    qualitativeDepthScore,
    quantitativeDepthScore,
    combinedDepthScore,
    defects,
    metricsFound,
  };
}

/**
 * Audits semantic depth across all criteria of a companion manifest.
 */
export function auditManifestSemanticDepth(manifest: unknown): ManifestSemanticDepthResult {
  if (!manifest || typeof manifest !== "object") {
    return {
      passed: false,
      averageDepthScore: 0,
      evaluatedCount: 0,
      deepCount: 0,
      superficialCount: 0,
      defects: [
        {
          id: "semantic-manifest-invalid",
          category: "boilerplate_evidence",
          severity: "serious",
          criterionId: "manifest",
          message: "Manifest is invalid or null.",
        },
      ],
    };
  }

  const m = manifest as { readonly criteria?: readonly unknown[] };
  const rawCriteria = Array.isArray(m.criteria) ? m.criteria : [];
  const defects: SemanticDepthDefect[] = [];
  let totalScore = 0;
  let deepCount = 0;
  let evaluatedCount = 0;

  for (const c of rawCriteria) {
    if (c && typeof c === "object") {
      evaluatedCount++;
      const audit = auditCriterionSemanticDepth(c as EvaluatedCriterion);
      totalScore += audit.combinedDepthScore;
      if (audit.isDeep) {
        deepCount++;
      }
      defects.push(...audit.defects);
    }
  }

  const averageDepthScore =
    evaluatedCount > 0 ? Number((totalScore / evaluatedCount).toFixed(2)) : 0;
  const superficialCount = evaluatedCount - deepCount;
  const passed = defects.length === 0 && evaluatedCount > 0;

  return {
    passed,
    averageDepthScore,
    evaluatedCount,
    deepCount,
    superficialCount,
    defects,
  };
}
