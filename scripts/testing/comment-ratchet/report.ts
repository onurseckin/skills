import { serializeBaseline } from "./baseline.ts";
import type { CommentRatchetDelta, CommentRatchetReport } from "./contracts.ts";

function renderDeltaRows(deltas: readonly CommentRatchetDelta[]): string {
  const rows: string[] = [];
  rows.push("| File | Observed | Baseline | Delta |");
  rows.push("| :--- | :---: | :---: | :---: |");
  for (const delta of deltas) {
    const diffSign = delta.diff > 0 ? `+${delta.diff}` : `${delta.diff}`;
    rows.push(`| \`${delta.file}\` | ${delta.observed} | ${delta.baseline} | ${diffSign} |`);
  }
  return rows.join("\n");
}

export function renderMarkdownReport(report: CommentRatchetReport): string {
  const lines: string[] = [];
  lines.push("# Comment Ratchet Guard Report");
  lines.push("");
  lines.push(`- **Status**: ${report.passed ? "PASSED" : "FAILED"}`);
  lines.push(`- **Mode**: ${report.mode}`);
  lines.push(`- **Scanned Files**: ${report.scannedFiles}`);
  lines.push(`- **Files with Comments**: ${report.current.length}`);
  lines.push(`- **Total Comment Lines**: ${report.totalCommentLines}`);
  lines.push(`- **Total Comment Tokens**: ${report.totalComments}`);
  lines.push("");

  const violations: CommentRatchetDelta[] = [
    ...report.baselineDelta.added,
    ...report.baselineDelta.worsened,
  ];

  if (violations.length > 0) {
    lines.push("## Violations (New or Worsened Comments)");
    lines.push("");
    lines.push(renderDeltaRows(violations));
    lines.push("");
  }

  const improvements: CommentRatchetDelta[] = [
    ...report.baselineDelta.improved,
    ...report.baselineDelta.resolved,
  ];

  if (improvements.length > 0) {
    lines.push("## Improvements (Decreased or Eliminated Comments)");
    lines.push("");
    lines.push(renderDeltaRows(improvements));
    lines.push("");
  }

  if (violations.length === 0 && improvements.length === 0) {
    lines.push("No changes relative to baseline.");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function renderJsonReport(report: CommentRatchetReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderJsonlBaseline(report: CommentRatchetReport): string {
  return serializeBaseline(report.current, "jsonl");
}
