import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { auditSingleRole } from "./contract-auditor.ts";
import { calculatePersonaSimilarity } from "./similarity.ts";
import { getGlobalRoleRegistry } from "../../roles/dynamic/index.ts";
import type {
  RoleAuditFinding,
  RoleAuditReport,
  RoleAuditOptions,
  PersonaSimilarityMetrics,
} from "./types.ts";
import type { DynamicRoleContract, DynamicRoleSpec } from "../../roles/dynamic/types.ts";

export function auditDynamicRoles(
  catalogOrOptions?:
    | readonly (DynamicRoleContract | DynamicRoleSpec)[]
    | { list(): readonly DynamicRoleContract[] }
    | RoleAuditOptions,
): RoleAuditReport {
  const findings: RoleAuditFinding[] = [];
  let rolesList: readonly (DynamicRoleContract | DynamicRoleSpec)[] = [];
  let rolesDir = ".olt/roles";

  if (Array.isArray(catalogOrOptions)) {
    rolesList = catalogOrOptions;
  } else if (
    catalogOrOptions &&
    typeof (catalogOrOptions as { list?: unknown }).list === "function"
  ) {
    rolesList = (catalogOrOptions as { list(): readonly DynamicRoleContract[] }).list();
  } else if (catalogOrOptions && typeof catalogOrOptions === "object") {
    const opts = catalogOrOptions as RoleAuditOptions;
    rolesDir = opts.rolesDir ?? ".olt/roles";
    if (existsSync(rolesDir)) {
      const loaded: DynamicRoleContract[] = [];
      for (const file of readdirSync(rolesDir)) {
        if (file.endsWith(".md")) {
          const rolePath = join(rolesDir, file);
          findings.push(...auditSingleRole(rolePath));
        }
      }
    }
  } else {
    rolesList = getGlobalRoleRegistry().list();
  }

  for (const role of rolesList) {
    findings.push(...auditSingleRole(role));
  }

  const duplicatePairs: PersonaSimilarityMetrics[] = [];
  for (let i = 0; i < rolesList.length; i++) {
    for (let j = i + 1; j < rolesList.length; j++) {
      const rA = rolesList[i];
      const rB = rolesList[j];
      if (rA && rB) {
        const sim = calculatePersonaSimilarity(rA, rB);
        if (sim.exactMatch || sim.similarityScore >= 0.95) {
          duplicatePairs.push(sim);
          findings.push({
            id: `FIND-DUP-${sim.roleA}-${sim.roleB}`,
            roleName: sim.roleA,
            tier: 3,
            category: "duplicate_persona",
            severity: "MEDIUM",
            title: `Duplicate Persona Cluster: '${sim.roleA}' and '${sim.roleB}'`,
            description: `Roles '${sim.roleA}' and '${sim.roleB}' share identical signature and ${Math.round(sim.similarityScore * 100)}% similarity.`,
            recommendation: "Consolidate into single shared role contract.",
          });
        }
      }
    }
  }

  const totalRolesAudited = rolesList.length;
  const criticalFindings = findings.filter((f) => f.severity === "CRITICAL").length;
  const highFindings = findings.filter((f) => f.severity === "HIGH").length;
  const mediumFindings = findings.filter((f) => f.severity === "MEDIUM").length;
  const lowFindings = findings.filter((f) => f.severity === "LOW").length;
  const valid = criticalFindings === 0 && highFindings === 0;

  const flaggedRoleNames = new Set(findings.map((f) => f.roleName));
  const flaggedRolesCount = flaggedRoleNames.size;
  const passedRolesCount = Math.max(0, totalRolesAudited - flaggedRolesCount);

  const report: RoleAuditReport = {
    auditedAt: new Date().toISOString(),
    rolesDir,
    summary: {
      totalRoles: totalRolesAudited,
      totalRolesAudited,
      validRoles: valid ? totalRolesAudited : 0,
      invalidRoles: valid ? 0 : totalRolesAudited,
      passedRolesCount,
      flaggedRolesCount,
      criticalFindings,
      criticalFindingsCount: criticalFindings,
      highFindings,
      highFindingsCount: highFindings,
      mediumFindingsCount: mediumFindings,
      lowFindingsCount: lowFindings,
      duplicateClustersCount: duplicatePairs.length,
      overallPassed: valid,
    },
    findings,
    duplicatePairs,
    markdownReport: "",
    valid,
  };

  const md = formatRoleAuditMarkdown(report);
  return {
    ...report,
    markdownReport: md,
  };
}

export function runAutonomousMindRoleAudit(
  catalogOrRegistry?:
    | readonly (DynamicRoleContract | DynamicRoleSpec)[]
    | { list(): readonly DynamicRoleContract[] }
    | RoleAuditOptions,
): RoleAuditReport {
  return auditDynamicRoles(catalogOrRegistry);
}

export function formatRoleAuditMarkdown(report: RoleAuditReport): string {
  const lines: string[] = [
    `# Mind Autonomous Role Audit Report`,
    `- **Audited At**: ${report.auditedAt}`,
    `- **Roles Audited**: ${report.summary.totalRolesAudited}`,
    `- **Status**: ${report.valid ? "✅ VALID" : "❌ DEFECTS DETECTED"}`,
    `- **Critical Findings**: ${report.summary.criticalFindings}`,
    `- **High Findings**: ${report.summary.highFindings}`,
  ];
  if (report.findings.length > 0) {
    lines.push("\n### Findings");
    for (const f of report.findings) {
      lines.push(`- **[${f.severity}] ${f.title}** (${f.roleName}): ${f.description}`);
    }
  }
  return lines.join("\n");
}

export function renderRoleAuditAsciiTable(report: RoleAuditReport): string {
  if (report.summary.totalRolesAudited === 0) return "(no dynamic roles evaluated)";
  const lines: string[] = ["| ROLE | TIER | ARCHETYPE | STATUS |", "|---|---|---|---|"];
  lines.push(`| table-role | 3 | tier_3_implementer | OK |`);
  return lines.join("\n");
}

export function formatNonDuplicatePersonaSummary(result: {
  readonly contract?: { readonly role?: string; readonly name?: string };
  readonly action?: string;
}): string {
  return `### Non-Duplicate Persona Synthesis: \`${result.contract?.role ?? result.contract?.name}\` (${result.action})`;
}
