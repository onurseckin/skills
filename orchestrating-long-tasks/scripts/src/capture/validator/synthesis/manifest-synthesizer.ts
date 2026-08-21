import type {
  CodeRemediation,
  CompanionManifestV2,
  ValidationContext,
  ValidationDefect,
  ValidationVerdict,
} from "../types.ts";
import { validateMechanical } from "../mechanical/index.ts";
import { validateCognitive } from "../cognitive/index.ts";
import { validateCustom } from "../custom/index.ts";

export function synthesizeCompanionManifest(ctx: ValidationContext): CompanionManifestV2 {
  const mechanicalResult = validateMechanical(ctx);
  const cognitiveResult = validateCognitive(ctx);
  const customResult = validateCustom(ctx);

  const allDefects: readonly ValidationDefect[] = [
    ...mechanicalResult.defects,
    ...cognitiveResult.defects,
    ...customResult.defects,
  ];

  let criticalCount = 0;
  let seriousCount = 0;
  let moderateCount = 0;
  let minorCount = 0;

  for (const defect of allDefects) {
    if (defect.severity === "critical") criticalCount++;
    else if (defect.severity === "serious") seriousCount++;
    else if (defect.severity === "moderate") moderateCount++;
    else if (defect.severity === "minor") minorCount++;
  }

  const totalDefects = allDefects.length;

  // STRICT INVARIANT: 100% remove numeric scores/points.
  // Strict binary certification:
  // "CERTIFIED" only if totalDefects === 0.
  // "DEFECTS_FOUND" if any defect exists.
  const verdict: ValidationVerdict = totalDefects === 0 ? "CERTIFIED" : "DEFECTS_FOUND";

  // Collect unique remediations across all defects
  const remediationSummaryMap = new Map<string, CodeRemediation>();
  for (const defect of allDefects) {
    for (const rem of defect.remediations) {
      const key = `${defect.category}-${rem.framework}`;
      if (!remediationSummaryMap.has(key)) {
        remediationSummaryMap.set(key, rem);
      }
    }
  }

  return {
    version: "2.0",
    screenId: ctx.screenId,
    viewport: ctx.viewport,
    timestamp: new Date().toISOString(),
    verdict,
    totalDefects,
    criticalCount,
    seriousCount,
    moderateCount,
    minorCount,
    pillars: {
      mechanical: mechanicalResult,
      cognitive: cognitiveResult,
      custom: customResult,
    },
    allDefects,
    remediationSummary: Array.from(remediationSummaryMap.values()),
  };
}

export function isCertifiedManifest(manifest: CompanionManifestV2): boolean {
  return manifest.verdict === "CERTIFIED" && manifest.totalDefects === 0;
}
