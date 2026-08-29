import type { FindingAdder } from "../channels/dom-violation-extractor.ts";

export const SUPERFICIAL_BOILERPLATE_PATTERNS: ReadonlySet<string> = new Set([
  "ok",
  "pass",
  "passed",
  "true",
  "yes",
  "n/a",
  "na",
  "none",
  "looks good",
  "test passed",
  "checked",
  "valid",
  "verified",
  "all good",
  "placeholder",
  "tbd",
  "as expected",
  "no issues",
  "done",
  "fine",
  "null",
  "undefined",
]);

export const METRIC_PATTERN: RegExp = /\b\d+(\.\d+)?(px|%|rem|em|ms|s|B|KB|MB|Lc|fps|:\d+)?\b/i;

export function auditCriterionSemanticDepth(
  detailsStr: string,
  evidenceStr: string,
  critId: string,
  manifestLabel: string,
  viewport: string | undefined,
  reportError: FindingAdder,
): void {
  // Details audit
  if (detailsStr.length === 0) {
    reportError(
      "boilerplate_evidence",
      "error",
      `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Missing or empty details.`,
      "Provide non-empty qualitative details for the evaluated criterion.",
      undefined,
      viewport,
    );
  } else if (SUPERFICIAL_BOILERPLATE_PATTERNS.has(detailsStr.toLowerCase())) {
    reportError(
      "boilerplate_evidence",
      "error",
      `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Contains superficial boilerplate details: '${detailsStr}'.`,
      "Provide non-boilerplate qualitative diagnosis for the evaluated criterion.",
      undefined,
      viewport,
    );
  } else if (detailsStr.length < 12) {
    reportError(
      "superficial_evidence",
      "error",
      `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Details ('${detailsStr}') is too brief (< 12 characters).`,
      "Expand qualitative details to provide meaningful diagnosis.",
      undefined,
      viewport,
    );
  }

  // Evidence audit
  if (evidenceStr.length === 0) {
    reportError(
      "boilerplate_evidence",
      "error",
      `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Missing or empty evidence.`,
      "Provide non-empty empirical proof for the evaluated criterion.",
      undefined,
      viewport,
    );
  } else if (SUPERFICIAL_BOILERPLATE_PATTERNS.has(evidenceStr.toLowerCase())) {
    reportError(
      "boilerplate_evidence",
      "error",
      `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Contains superficial boilerplate evidence: '${evidenceStr}'.`,
      "Provide non-boilerplate empirical proof for the evaluated criterion.",
      undefined,
      viewport,
    );
  } else if (evidenceStr.length < 12) {
    reportError(
      "superficial_evidence",
      "error",
      `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Evidence ('${evidenceStr}') is too brief (< 12 characters).`,
      "Provide detailed empirical measurement proof with specific quantitative values.",
      undefined,
      viewport,
    );
  } else if (!METRIC_PATTERN.test(evidenceStr)) {
    reportError(
      "missing_evidence_metrics",
      "error",
      `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Evidence lacks quantitative measurements (numbers, pixel dimensions, counts, or units).`,
      "Include specific quantitative measurements and metric numbers in evidence.",
      undefined,
      viewport,
    );
  }
}

export function auditCognitiveQuestionSemanticDepth(
  obs: string,
  ev: string,
  qId: string,
  manifestLabel: string,
  viewport: string | undefined,
  reportError: FindingAdder,
): void {
  if (obs.length === 0 || SUPERFICIAL_BOILERPLATE_PATTERNS.has(obs.toLowerCase())) {
    reportError(
      "boilerplate_evidence",
      "error",
      `Companion Manifest '${manifestLabel}' Cognitive Question '${qId}' Violation: Contains boilerplate observation: '${obs}'.`,
      "Provide detailed qualitative observation for cognitive questionnaire question.",
      undefined,
      viewport,
    );
  } else if (obs.length < 12) {
    reportError(
      "superficial_evidence",
      "error",
      `Companion Manifest '${manifestLabel}' Cognitive Question '${qId}' Violation: Observation ('${obs}') is too brief (< 12 characters).`,
      "Expand qualitative observation for cognitive questionnaire question to articulate UX rationale.",
      undefined,
      viewport,
    );
  }

  if (ev.length === 0 || SUPERFICIAL_BOILERPLATE_PATTERNS.has(ev.toLowerCase())) {
    reportError(
      "boilerplate_evidence",
      "error",
      `Companion Manifest '${manifestLabel}' Cognitive Question '${qId}' Violation: Contains boilerplate evidence: '${ev}'.`,
      "Provide empirical proof for cognitive questionnaire question.",
      undefined,
      viewport,
    );
  } else if (ev.length < 12) {
    reportError(
      "superficial_evidence",
      "error",
      `Companion Manifest '${manifestLabel}' Cognitive Question '${qId}' Violation: Evidence ('${ev}') is too brief (< 12 characters).`,
      "Provide detailed empirical measurement proof for cognitive questionnaire question.",
      undefined,
      viewport,
    );
  } else if (!METRIC_PATTERN.test(ev)) {
    reportError(
      "missing_evidence_metrics",
      "error",
      `Companion Manifest '${manifestLabel}' Cognitive Question '${qId}' Violation: Evidence lacks quantitative metrics: '${ev}'.`,
      "Include quantitative metrics in cognitive questionnaire evidence.",
      undefined,
      viewport,
    );
  }
}
