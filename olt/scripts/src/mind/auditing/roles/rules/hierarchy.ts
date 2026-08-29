import { basename, dirname, join, resolve } from "node:path";
import {
  getGlobalRoleRegistry,
  type DynamicRoleRegistry,
  type DynamicRoleContract,
  type DynamicRoleSpec,
} from "../../../roles/dynamic/index.ts";
import {
  calculatePersonaSimilarity,
  type PersonaSimilarityMetrics,
  type RoleAuditFinding,
  type RoleAuditOptions,
  type RoleAuditReport,
  type RoleAuditSeverity,
  type RoleAuditSummary,
  type NonDuplicateRoleSynthesisResult,
} from "../types.ts";
import { auditSingleRole } from "../contract-auditor.ts";

export function auditDynamicRoles(
  roles: readonly (DynamicRoleSpec | DynamicRoleContract)[],
  options: RoleAuditOptions = {},
): RoleAuditReport {
  const auditedAt = new Date().toISOString();
  const findings: RoleAuditFinding[] = [];
  const checkedRoles: string[] = [];
  const duplicatePairs: PersonaSimilarityMetrics[] = [];

  const checkDuplicates = options.checkDuplicates ?? true;
  const duplicateThreshold = options.duplicateSimilarityThreshold ?? 0.9;

  // Audit each role individually
  for (const role of roles) {
    const spec: DynamicRoleSpec = "spec" in role ? role.spec : role;
    checkedRoles.push(spec.name);
    const singleFindings = auditSingleRole(spec, options);
    findings.push(...singleFindings);
  }

  // Cross-role duplicate detection
  if (checkDuplicates) {
    const seenPairs = new Set<string>();

    for (let i = 0; i < roles.length; i++) {
      for (let j = i + 1; j < roles.length; j++) {
        const roleA = roles[i]!;
        const roleB = roles[j]!;
        const specA: DynamicRoleSpec = "spec" in roleA ? roleA.spec : roleA;
        const specB: DynamicRoleSpec = "spec" in roleB ? roleB.spec : roleB;

        const pairKey = [specA.name, specB.name].sort().join("::");
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        const similarity = calculatePersonaSimilarity(specA, specB);
        if (similarity.exactMatch || similarity.similarityScore >= duplicateThreshold) {
          duplicatePairs.push(similarity);

          const severity: RoleAuditSeverity = similarity.exactMatch ? "HIGH" : "MEDIUM";
          findings.push({
            id: `FIND-DUP-${specA.name}-${specB.name}`,
            roleName: specA.name,
            tier: specA.tier,
            category: "duplicate_persona",
            severity,
            title: similarity.exactMatch
              ? `Duplicate Persona Signature Detected (${specA.name} == ${specB.name})`
              : `High Persona Similarity Detected (${specA.name} ~ ${specB.name})`,
            description: `Roles '${specA.name}' and '${specB.name}' share identical or near-identical persona signatures (${Math.round(similarity.similarityScore * 100)}% similarity).`,
            recommendation:
              "Consolidate redundant roles into a single dynamic role or disambiguate specialization domains.",
            evidence: {
              roleA: specA.name,
              roleB: specB.name,
              similarityScore: similarity.similarityScore,
              exactMatch: similarity.exactMatch,
            },
          });
        }
      }
    }
  }

  // Tally summary metrics
  const criticalCount = findings.filter((f) => f.severity === "CRITICAL").length;
  const highCount = findings.filter((f) => f.severity === "HIGH").length;
  const mediumCount = findings.filter((f) => f.severity === "MEDIUM").length;
  const lowCount = findings.filter((f) => f.severity === "LOW").length;

  const flaggedRoleNames = new Set(findings.map((f) => f.roleName));
  const flaggedRolesCount = flaggedRoleNames.size;
  const passedRolesCount = Math.max(0, checkedRoles.length - flaggedRolesCount);
  const overallPassed = criticalCount === 0 && highCount === 0;

  const summary: RoleAuditSummary = {
    totalRoles: checkedRoles.length,
    totalRolesAudited: checkedRoles.length,
    validRoles: overallPassed ? checkedRoles.length : 0,
    invalidRoles: overallPassed ? 0 : checkedRoles.length,
    passedRolesCount,
    flaggedRolesCount,
    criticalFindings: criticalCount,
    criticalFindingsCount: criticalCount,
    highFindings: highCount,
    highFindingsCount: highCount,
    mediumFindingsCount: mediumCount,
    lowFindingsCount: lowCount,
    duplicateClustersCount: duplicatePairs.length,
    overallPassed,
  };

  const report: RoleAuditReport = {
    auditedAt,
    summary,
    findings,
    checkedRoles,
    duplicatePairs,
    markdownReport: "",
  };

  const markdownReport = formatRoleAuditMarkdown(report);
  return {
    ...report,
    markdownReport,
  };
}

export function runAutonomousMindRoleAudit(
  registry?: DynamicRoleRegistry,
  options?: RoleAuditOptions,
): RoleAuditReport {
  const reg = registry ?? getGlobalRoleRegistry();
  const roles = reg.list();
  return auditDynamicRoles(roles, options);
}

export function formatRoleAuditMarkdown(
  report: RoleAuditReport,
  options: { readonly compact?: boolean | undefined } = {},
): string {
  const lines: string[] = [];
  const statusEmoji = report.summary.overallPassed ? "🟢 PASS" : "🔴 ACTION REQUIRED";

  lines.push("### 🛡️ Mind Autonomous Role Audit Report");
  lines.push(`- **Status**: ${statusEmoji}`);
  lines.push(`- **Audited At**: \`${report.auditedAt}\``);
  lines.push(
    `- **Roles Audited**: ${report.summary.totalRolesAudited} (${report.summary.passedRolesCount} clean, ${report.summary.flaggedRolesCount} flagged)`,
  );
  lines.push(
    `- **Findings**: ${report.findings.length} (Critical: ${report.summary.criticalFindingsCount}, High: ${report.summary.highFindingsCount}, Medium: ${report.summary.mediumFindingsCount}, Low: ${report.summary.lowFindingsCount})`,
  );
  lines.push(`- **Duplicate Clusters**: ${report.summary.duplicateClustersCount}`);
  lines.push("");

  if (report.duplicatePairs.length > 0) {
    lines.push("#### 🔍 Persona Deduplication & Similarity Clusters");
    for (const dup of report.duplicatePairs) {
      const matchType = dup.exactMatch ? "EXACT DUPLICATE" : "HIGH SIMILARITY";
      lines.push(
        `- **[${matchType}]** \`${dup.roleA}\` ↔ \`${dup.roleB}\` (Similarity: ${Math.round(dup.similarityScore * 100)}%, Shared Commands: ${dup.sharedCommandsCount}, Shared Pillars: ${dup.sharedPillarsCount})`,
      );
    }
    lines.push("");
  }

  if (report.findings.length === 0) {
    lines.push(
      "✅ **Zero role audit findings.** All registered personas adhere strictly to 4-Tier boundaries, Anti-Boundary-Leak invariants, and Zero-Any type discipline.",
    );
    return lines.join("\n").trim();
  }

  if (!options.compact) {
    lines.push("#### ⚠️ Detailed Findings List");
    for (const f of report.findings) {
      lines.push(`##### [${f.severity}] ${f.title} (\`${f.id}\`)`);
      lines.push(
        `- **Role**: \`${f.roleName}\` (Tier ${f.tier}) | **Category**: \`${f.category}\``,
      );
      lines.push(`- **Description**: ${f.description}`);
      lines.push(`- **Remediation**: ${f.recommendation}`);
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

export function renderRoleAuditAsciiTable(report: RoleAuditReport): string {
  const checkedRoles = report.checkedRoles ?? [];
  if (checkedRoles.length === 0) {
    return "(no dynamic roles evaluated)";
  }

  const header = [
    "ROLE".padEnd(28),
    "TIER".padEnd(6),
    "STATUS".padEnd(10),
    "CRITICAL".padEnd(10),
    "HIGH".padEnd(8),
    "MEDIUM".padEnd(8),
  ].join(" | ");

  const divider = "-".repeat(header.length);
  const rows: string[] = [header, divider];

  for (const roleName of checkedRoles) {
    const roleFindings = report.findings.filter((f) => f.roleName === roleName);
    const crit = roleFindings.filter((f) => f.severity === "CRITICAL").length;
    const high = roleFindings.filter((f) => f.severity === "HIGH").length;
    const med = roleFindings.filter((f) => f.severity === "MEDIUM").length;

    const status = crit > 0 ? "FAIL" : high > 0 ? "WARN" : "OK";
    const tier = roleFindings[0]?.tier ?? 3;

    rows.push(
      [
        roleName.padEnd(28),
        `Tier ${tier}`.padEnd(6),
        status.padEnd(10),
        String(crit).padEnd(10),
        String(high).padEnd(8),
        String(med).padEnd(8),
      ].join(" | "),
    );
  }

  return rows.join("\n");
}

export function formatNonDuplicatePersonaSummary(result: NonDuplicateRoleSynthesisResult): string {
  const lines: string[] = [];
  lines.push(`### 🎭 Non-Duplicate Persona Synthesis: \`${result.contract.role}\``);
  lines.push(`- **Action**: \`${result.action}\``);
  lines.push(`- **Tier**: Tier ${result.contract.tier} (\`${result.contract.spec.archetype}\`)`);
  lines.push(`- **Deduplicated**: ${result.deduplicated ? "YES" : "NO"}`);
  lines.push(`- **Signature Hash**: \`${result.signature.signatureHash.slice(0, 16)}...\``);
  lines.push(`- **Message**: ${result.message}`);
  if (result.duplicateOfRole) {
    lines.push(`- **Reused / Similar Role**: \`${result.duplicateOfRole}\``);
  }
  if (result.disambiguatedFrom) {
    lines.push(`- **Disambiguated From**: \`${result.disambiguatedFrom}\``);
  }

  return lines.join("\n").trim();
}

export { CODE_EDIT_TOOLS } from "../../../../platform/index.ts";

export const GRAPH_MUTATION_COMMANDS: ReadonlySet<string> = new Set([
  "plan:init",
  "plan:enhance",
  "plan:add",
  "plan:compile",
  "plan:apply",
  "plan:replan",
  "plan:claim",
  "mind:init",
  "mind:candidate",
  "mind:admit",
]);

export const VALIDATION_COMMANDS: ReadonlySet<string> = new Set([
  "task:validate-start",
  "task:review",
  "task:probe",
  "task:reject",
  "critic:start",
  "critic:remediate",
  "gate:prove",
  "coordinator:pushback",
]);

export function isMindRole(role: string): boolean {
  const r = role.toLowerCase().trim();
  return r === "mind" || r.startsWith("mind-") || r.includes("mind");
}
