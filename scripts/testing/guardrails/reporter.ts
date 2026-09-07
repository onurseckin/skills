/**
 * @file reporter.ts
 * Formats purity audit results for terminal output and markdown documentation.
 */

import type { PurityAuditResult, PurityViolation } from "./types.ts";

export function formatTerminalReport(
  scannedFiles: number,
  violations: readonly PurityViolation[],
): string {
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
): string {
  const status = violations.length === 0 ? "PASSED" : "FAILED";
  const lines: string[] = [
    "# Test Purity Guardrail Audit Report",
    "",
    `- **Status**: ${status}`,
    `- **Scanned Files**: ${scannedFiles}`,
    `- **Total Violations**: ${violations.length}`,
    "",
  ];

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
): PurityAuditResult {
  return {
    passed: violations.length === 0,
    scannedFiles,
    violations,
    terminalReport: formatTerminalReport(scannedFiles, violations),
    markdownReport: formatMarkdownReport(scannedFiles, violations),
  };
}
