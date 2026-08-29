import { enforceLineLimit } from "../../formatters/line-limiter.ts";
import { renderApcaContrastBadge, renderAsciiDefectTable } from "./apca.ts";
import type { AuditedDefect, DefectAuditSummary } from "./types.ts";

export function formatDefectAuditReport(params: {
  readonly capsulesDir: string;
  readonly runRoot: string | null;
  readonly defects: readonly AuditedDefect[];
  readonly summary: DefectAuditSummary;
  readonly autoAdmittedCount: number;
  readonly autoAdmittedCandidates: readonly string[];
  readonly isAll?: boolean | undefined;
  readonly promotedCount?: number | undefined;
  readonly promotedDefects?: readonly string[] | undefined;
  readonly generatedTestsCount?: number | undefined;
}): string {
  const lines: string[] = [
    "### Defect Audit & Observability Report",
    `- **Capsules Directory**: \`${params.capsulesDir}\``,
    params.runRoot !== null
      ? `- **Active Run Root**: \`${params.runRoot}\``
      : "- **Active Run Root**: *none*",
    `- **Total Defects Discovered**: ${params.summary.total_defects}`,
    `- **Status Breakdown**: Open: ${params.summary.open_count} | Admitted: ${params.summary.admitted_count} | Resolved: ${params.summary.resolved_count} | Declined: ${params.summary.declined_count}`,
    `- **Severity**: Critical: ${params.summary.critical_count} | Warning: ${params.summary.warning_count}`,
    `- **APCA Perceived Contrast Compliance**: ${params.summary.apca_contrast_compliance.passes_apca ? "PASS (100% badges compliant)" : "FAIL"} (Min Lc=${params.summary.apca_contrast_compliance.min_lc_observed.toFixed(1)})`,
  ];

  if (params.autoAdmittedCount > 0) {
    lines.push(
      `- **Auto-Admitted Candidates**: ${params.autoAdmittedCount} candidate(s) created (\`${params.autoAdmittedCandidates.join("`, `")}\`)`,
    );
  }

  if (params.promotedCount !== undefined && params.promotedCount > 0) {
    lines.push(
      `- **Promoted to COMPLETED_DEFECTS**: ${params.promotedCount} defect(s) archived with verified proof`,
    );
  }

  if (params.generatedTestsCount !== undefined && params.generatedTestsCount > 0) {
    lines.push(`- **Regression Tests Generated**: ${params.generatedTestsCount} test(s) generated`);
  }

  lines.push("");
  lines.push("#### Discovered Defect Registry");
  lines.push(renderAsciiDefectTable(params.defects));

  lines.push("");
  lines.push("#### APCA Perceptual Contrast Matrix");
  lines.push(
    "| State / Severity | Badge Text | Foreground | Background | Perceived Lc | APCA Status |",
  );
  lines.push("| :--- | :--- | :--- | :--- | :--- | :--- |");
  for (const badge of params.summary.apca_contrast_compliance.badge_details) {
    lines.push(
      `| \`${badge.label}\` | \`${badge.badge_text}\` | \`${badge.fg_color}\` | \`${badge.bg_color}\` | ${badge.lc.toFixed(1)} | ${badge.passes_apca ? "✓ PASS" : "✗ FAIL"} |`,
    );
  }

  if (params.defects.length > 0) {
    lines.push("");
    lines.push("#### Forensic Details");
    for (const b of params.defects) {
      lines.push(`- **\`${b.id}\`** (\`${b.type}\` | ${b.severity})`);
      lines.push(`  - **Capsule**: \`${b.source_capsule}\``);
      lines.push(`  - **Status**: \`${b.status}\` ${renderApcaContrastBadge(b.status)}`);
      lines.push(`  - **PID / PPID**: ${b.pid} / ${b.ppid}`);
      lines.push(`  - **Observation**: ${b.observation}`);
      lines.push(`  - **Remediation**: ${b.remediation}`);
      if (b.candidate_id !== undefined && b.candidate_id !== null) {
        lines.push(`  - **Admitted Candidate ID**: \`${b.candidate_id}\``);
      }
    }
  }

  const maxLines = params.isAll === true ? 500 : 35;
  return enforceLineLimit(lines.join("\n"), maxLines);
}
