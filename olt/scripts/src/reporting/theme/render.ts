/**
 * @file render.ts
 * Visual Markdown and ASCII report formatting for theme contrast evaluations.
 */

import type { MultiThemeComparisonReport } from "./types.ts";

/**
 * Renders a clean ASCII / Unicode visual table report for multi-theme contrast compliance.
 */
export function formatThemeContrastMatrixMarkdown(report: MultiThemeComparisonReport): string {
  const lines: string[] = [];

  const statusText = report.overallPassed ? "PASS" : "FAIL";
  const passRateStr = `${report.summary.passRate.toFixed(1)}%`;
  const checksStr = `${report.summary.passedChecks}/${report.summary.totalChecks} checks passed`;

  lines.push("# Multi-Theme Contrast & Dynamic Color Scheme Visual Report");
  lines.push("");
  lines.push("```text");
  lines.push("┌────────────────────────────────────────────────────────────────────────┐");
  lines.push("│ Multi-Theme Contrast Compliance Summary                                │");
  lines.push("├────────────────────────────────────────────────────────────────────────┤");
  lines.push(`│ Overall Status       : ${statusText.padEnd(52)}│`);
  lines.push(`│ Total UI Elements    : ${report.totalElements.toString().padEnd(52)}│`);
  lines.push(`│ Evaluated Themes     : ${report.evaluatedThemes.join(", ").padEnd(52)}│`);
  lines.push(`│ Evaluated Standards  : ${report.evaluatedStandards.join(", ").padEnd(52)}│`);
  lines.push(`│ Total Matrix Checks  : ${report.summary.totalChecks.toString().padEnd(52)}│`);
  lines.push(`│ Overall Pass Rate    : ${(passRateStr + " (" + checksStr + ")").padEnd(52)}│`);
  lines.push(`│ Total Regressions    : ${report.findings.length.toString().padEnd(52)}│`);
  lines.push("└────────────────────────────────────────────────────────────────────────┘");
  lines.push("```");
  lines.push("");

  lines.push("## Theme-Specific Compliance Rates");
  lines.push("");
  for (const theme of report.evaluatedThemes) {
    const rate = report.summary.themePassRates[theme];
    const rateFormatted = rate !== undefined ? `${rate.toFixed(1)}%` : "N/A";
    const indicator = rate !== undefined && rate >= 100 ? "✓" : "✗";
    lines.push(`- **${theme}**: ${rateFormatted} [${indicator}]`);
  }
  lines.push("");

  lines.push("## High-Level Element Contrast Matrix");
  lines.push("");

  // Construct High-Level ASCII Matrix
  const headers = ["Selector", ...report.evaluatedThemes, "Status"];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => ":---").join(" | ")} |`);

  for (const matrix of report.matrices) {
    const row: string[] = [matrix.selector];
    for (const theme of report.evaluatedThemes) {
      const res = matrix.themes[theme];
      if (res === undefined) {
        row.push("MISSING (✗)");
      } else {
        const glyph = res.passed ? "✓" : "✗";
        row.push(`${res.wcagRatio.toFixed(1)}:1 (${glyph})`);
      }
    }
    row.push(matrix.overallPassed ? "PASS" : "FAIL");
    lines.push(`| ${row.join(" | ")} |`);
  }
  lines.push("");

  lines.push("## Detailed Multi-Theme Evaluations");
  lines.push("");
  lines.push(
    "| Selector | Theme | FG Color | BG Color | WCAG CR | APCA Lc | WCAG AA | WCAG AAA | APCA | Status |",
  );
  lines.push("| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |");

  for (const matrix of report.matrices) {
    for (const theme of report.evaluatedThemes) {
      const res = matrix.themes[theme];
      if (res === undefined) {
        lines.push(
          `| \`${matrix.selector}\` | ${theme} | *none* | *none* | N/A | N/A | ✗ FAIL | ✗ FAIL | ✗ FAIL | FAIL |`,
        );
        continue;
      }

      const aaEval = res.evaluations.find((e) => e.standard === "wcag-aa");
      const aaaEval = res.evaluations.find((e) => e.standard === "wcag-aaa");
      const apcaEval = res.evaluations.find((e) => e.standard === "apca");

      const aaCell = aaEval ? (aaEval.passed ? "✓ PASS" : "✗ FAIL") : "-";
      const aaaCell = aaaEval ? (aaaEval.passed ? "✓ PASS" : "✗ FAIL") : "-";
      const apcaCell = apcaEval ? (apcaEval.passed ? "✓ PASS" : "✗ FAIL") : "-";

      const statusCell = res.passed ? "PASS" : "FAIL";

      lines.push(
        `| \`${matrix.selector}\` | ${theme} | \`${res.foregroundColor}\` | \`${res.backgroundColor}\` | ${res.wcagRatio.toFixed(2)}:1 | ${res.apcaLc.toFixed(1)} | ${aaCell} | ${aaaCell} | ${apcaCell} | ${statusCell} |`,
      );
    }
  }
  lines.push("");

  if (report.findings.length > 0) {
    lines.push(`## Contrast Regressions & Findings (${report.findings.length})`);
    lines.push("");
    for (const f of report.findings) {
      const sevTag = f.severity.toUpperCase();
      lines.push(`- **[${sevTag}]** \`${f.selector}\` (\`${f.theme}\` mode): ${f.message}`);
      if (f.details !== undefined && f.details !== "") {
        lines.push(`  - *Details*: ${f.details}`);
      }
      if (f.foregroundColor !== "none") {
        lines.push(
          `  - *Palette*: FG=\`${f.foregroundColor}\`, BG=\`${f.backgroundColor}\` (Measured CR: ${f.contrastRatio.toFixed(2)}:1, Required: ${f.requiredThreshold.toFixed(2)})`,
        );
      }
    }
    lines.push("");
  } else {
    lines.push("## Contrast Regressions & Findings");
    lines.push("");
    lines.push("No contrast regressions or color scheme defects detected across evaluated themes.");
    lines.push("");
  }

  return lines.join("\n");
}
