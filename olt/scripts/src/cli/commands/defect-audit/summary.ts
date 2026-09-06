import type {
  ApcaBadgeInfo,
  ApcaContrastCompliance,
  AuditedDefect,
  DefectAuditSummary,
} from "./types.ts";
import { getApcaBadgeInfo } from "./apca.ts";

export function computeDefectAuditSummary(
  allDefects: readonly AuditedDefect[],
): DefectAuditSummary {
  const byCategory: Record<string, number> = {};
  const byCapsule: Record<string, number> = {};
  let openCount = 0;
  let admittedCount = 0;
  let resolvedCount = 0;
  let declinedCount = 0;
  let criticalCount = 0;
  let warningCount = 0;

  for (const b of allDefects) {
    const cat =
      typeof (b.context as Record<string, unknown>)?.category === "string"
        ? String((b.context as Record<string, unknown>).category)
        : b.type;
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    byCapsule[b.source_capsule] = (byCapsule[b.source_capsule] ?? 0) + 1;

    if (b.status === "open") openCount += 1;
    else if (b.status === "admitted") admittedCount += 1;
    else if (b.status === "resolved") resolvedCount += 1;
    else if (b.status === "declined") declinedCount += 1;

    if (b.severity === "critical") criticalCount += 1;
    else if (b.severity === "warning") warningCount += 1;
  }

  const statusesToTest = [
    "critical",
    "warning",
    "open",
    "admitted",
    "resolved",
    "declined",
    "ignored",
  ];
  const badgeDetails: ApcaBadgeInfo[] = statusesToTest.map((s) => getApcaBadgeInfo(s));
  const compliantCount = badgeDetails.filter((b) => b.passes_apca).length;
  const minLc = Math.min(...badgeDetails.map((b) => b.lc));

  const apcaCompliance: ApcaContrastCompliance = {
    compliant_badges: compliantCount,
    total_badges: badgeDetails.length,
    min_lc_observed: minLc,
    passes_apca: compliantCount === badgeDetails.length,
    badge_details: badgeDetails,
  };

  return {
    total_defects: allDefects.length,
    open_count: openCount,
    admitted_count: admittedCount,
    resolved_count: resolvedCount,
    declined_count: declinedCount,
    critical_count: criticalCount,
    warning_count: warningCount,
    by_category: byCategory,
    by_capsule: byCapsule,
    apca_contrast_compliance: apcaCompliance,
  };
}
