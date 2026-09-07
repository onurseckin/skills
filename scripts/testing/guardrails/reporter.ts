/**
 * @file reporter.ts
 * Formats purity audit results for terminal output and markdown documentation.
 */

import type { PurityAuditResult, PurityAuditScope, PurityViolation } from "./types.ts";

export function describeVacuity(
  scope: PurityAuditScope,
  requestedFiles: number,
  scannedFiles: number,
): string | undefined {
  if (scope !== "explicit") return undefined;
  if (requestedFiles === 0) {
    return "an explicitly empty file list was supplied, so no test file was examined";
  }
  if (scannedFiles < requestedFiles) {
    return `${requestedFiles - scannedFiles} of ${requestedFiles} explicitly requested file(s) could not be read, so they were never examined`;
  }
  return undefined;
}

export function formatTerminalReport(
  scannedFiles: number,
  violations: readonly PurityViolation[],
  vacuityReason?: string,
): string {
  if (vacuityReason !== undefined) {
    return [
      `[purity-guard] \u274c Test purity audit is VACUOUS: ${vacuityReason}.`,
      "[purity-guard] A vacuous audit proves nothing and is never reported as a pass.",
      "[purity-guard] Pass no argument (or { all: true }) to audit the whole repository.",
    ].join("\n");
  }

  if (violations.length === 0) {
    return `[purity-guard] ✓ All ${scannedFiles} test file(s) passed purity audit with 0 violations.`;
  }

  const lines: string[] = [
    `[purity-guard] ❌ Test purity audit FAILED: ${violations.length} violation(s) found across ${scannedFiles} file(s).`,
    "",
  ];

  for (const v of violations) {
    lines.push(`  ❌ ${v.file}:${v.line}:${v.column} [${v.category}] ${v.message}`);
    if (v.snippet) {
      lines.push(`     Snippet: ${v.snippet.trim().slice(0, 100)}`);
    }
  }

  lines.push("");
  lines.push(
    "[purity-guard] Pure test invariant violated. Use VirtualMemoryFS and in-memory mocks.",
  );
  return lines.join("\n");
}

export function formatMarkdownReport(
  scannedFiles: number,
  violations: readonly PurityViolation[],
  vacuityReason?: string,
): string {
  const isVacuous = vacuityReason !== undefined;
  const status = isVacuous ? "VACUOUS" : violations.length === 0 ? "PASSED" : "FAILED";
  const lines: string[] = [
    "# Test Purity Guardrail Audit Report",
    "",
    `- **Status**: ${status}`,
    `- **Scanned Files**: ${scannedFiles}`,
    `- **Total Violations**: ${violations.length}`,
    "",
  ];

  if (isVacuous) {
    lines.push(`\u274c Audit was vacuous: ${vacuityReason}.`);
    lines.push("");
    lines.push("A vacuous audit examines nothing and therefore cannot be reported as a pass.");
    return lines.join("\n");
  }

  if (violations.length === 0) {
    lines.push("✓ All audited test files conform to pure in-memory test standards.");
    return lines.join("\n");
  }

  lines.push("| File | Line:Col | Category | Rule | Message |");
  lines.push("| :--- | :--- | :--- | :--- | :--- |");

  for (const v of violations) {
    const fileLink = `\`${v.file}\``;
    const loc = `${v.line}:${v.column}`;
    const safeMsg = v.message.replace(/\|/g, "\\|");
    lines.push(`| ${fileLink} | ${loc} | \`${v.category}\` | \`${v.rule}\` | ${safeMsg} |`);
  }

  lines.push("");
  lines.push("## Remediation Guidance");
  lines.push(
    "- **Filesystem**: Replace `node:fs` calls with `VirtualMemoryFS` from `olt/scripts/src/testing/virtual-fs`.",
  );
  lines.push(
    "- **Subprocess**: Replace `execSync`/`spawnSync`/`Bun.spawn`/`Bun.$` with in-memory virtual mocks or stubs.",
  );
  lines.push(
    "- **AST Scans**: Move static repository scans to `pre-commit` or linter rules rather than unit tests.",
  );
  lines.push(
    "- **Anti-Patterns**: Author substantive assertions testing domain invariants; eliminate empty test bodies.",
  );

  return lines.join("\n");
}

export function buildAuditResult(
  scannedFiles: number,
  violations: readonly PurityViolation[],
  scope: PurityAuditScope = "repository",
  requestedFiles: number = scannedFiles,
): PurityAuditResult {
  const vacuityReason = describeVacuity(scope, requestedFiles, scannedFiles);
  return {
    passed: vacuityReason === undefined && violations.length === 0,
    scope,
    requestedFiles,
    scannedFiles,
    vacuous: vacuityReason !== undefined,
    violations,
    terminalReport: formatTerminalReport(scannedFiles, violations, vacuityReason),
    markdownReport: formatMarkdownReport(scannedFiles, violations, vacuityReason),
  };
}
