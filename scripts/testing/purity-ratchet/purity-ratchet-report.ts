import { serializeBaseline } from "./purity-ratchet-baseline.ts";
import type { PurityRatchetDelta, PurityRatchetReport } from "./purity-ratchet-contracts.ts";

function renderDeltaLines(label: string, deltas: readonly PurityRatchetDelta[]): readonly string[] {
  if (deltas.length === 0) return [];
  const lines = ["", `## ${label}`, ""];
  for (const delta of deltas) {
    lines.push(
      `- \`${delta.file}\` — ${delta.rule}: ${delta.baseline} baselined, ${delta.observed} observed`,
    );
  }
  return lines;
}

export function renderMarkdownReport(report: PurityRatchetReport): string {
  const status = report.passed ? "passed" : "failed";
  const lines = [
    "# Purity ratchet report",
    "",
    `Status: ${status}`,
    `Mode: ${report.mode}`,
    `Scanned files: ${report.scannedFiles}`,
    `Violations: ${report.totalViolations}`,
    `Files with violations: ${new Set(report.current.map((entry) => entry.file)).size}`,
    `Added: ${report.baselineDelta.added.length}`,
    `Worsened: ${report.baselineDelta.worsened.length}`,
    `Resolved: ${report.baselineDelta.resolved.length}`,
    ...renderDeltaLines("Added violations (blocking)", report.baselineDelta.added),
    ...renderDeltaLines("Worsened violations (blocking)", report.baselineDelta.worsened),
    ...renderDeltaLines("Resolved violations (never blocking)", report.baselineDelta.resolved),
  ];
  if (!report.passed) {
    lines.push("");
    lines.push(
      "New purity violations were introduced. Fix them, or regenerate the baseline only for a deliberate, reviewed backlog change.",
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderJsonReport(report: PurityRatchetReport): string {
  return `${JSON.stringify({ schema: "olt-purity-ratchet-report/v1", ...report }, null, 2)}\n`;
}

export function renderJsonlBaseline(report: PurityRatchetReport): string {
  return serializeBaseline(report.current);
}
