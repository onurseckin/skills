import { computeDoctorEnginePassed } from "../types.ts";
import { detectSuperficialChecklists } from "./checklist-detector.ts";
import { detectSyntheticJsonEvasion } from "./synthetic-json-detector.ts";
import {
  OPTICAL_DOCTOR_ENGINE_NAME,
  type OpticalDoctorCheckOptions,
  type OpticalDoctorCheckResult,
  type OpticalDoctorFinding,
  type OpticalReviewHealth,
  type OpticalReviewToolCall,
} from "./types.ts";
import { detectViewportReviewDefects } from "./viewport-review-detector.ts";

export function checkOpticalDoctor(
  options: OpticalDoctorCheckOptions = {},
): OpticalDoctorCheckResult {
  const findings: OpticalDoctorFinding[] = [];
  const reviewProse = options.reviewProse ?? "";

  // 1. Check for synthetic JSON evasion
  const jsonFindings = detectSyntheticJsonEvasion(reviewProse);
  for (const f of jsonFindings) {
    findings.push(f);
  }

  // 2. Check for superficial checklist parroting and formulaic boilerplate
  const checklistFindings = detectSuperficialChecklists(reviewProse);
  for (const f of checklistFindings) {
    findings.push(f);
  }

  // 3. Check for 4-viewport review integrity, word count, and image files
  const viewportFindings = detectViewportReviewDefects(options);
  for (const f of viewportFindings) {
    findings.push(f);
  }

  const passed = computeDoctorEnginePassed(findings);

  return {
    engine: OPTICAL_DOCTOR_ENGINE_NAME,
    passed,
    findings,
  };
}

export function verifyOpticalReview(
  turnLogToolCalls: readonly OpticalReviewToolCall[],
  reviewProse: string,
  requiredViewportPaths?: readonly string[],
): OpticalReviewHealth {
  const result = checkOpticalDoctor({
    toolCalls: turnLogToolCalls,
    reviewProse,
    requiredViewportPaths,
  });

  const violations = result.findings.map((f) =>
    f.details?.ruleId !== undefined
      ? `${f.code}: ${f.message} [${String(f.details.ruleId)}]`
      : `${f.code}: ${f.message}`,
  );

  return {
    healthy: result.passed,
    violations,
  };
}
