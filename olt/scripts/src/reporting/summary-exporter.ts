import { CommandEvidence, truncateSemanticTrace } from "./evidence-collector";

export interface SummaryReport {
  taskId: string;
  evidence: CommandEvidence[];
}

export function exportSummaryWithTrunking(report: SummaryReport): string {
  const prunedEvidence = report.evidence.map((e) => truncateSemanticTrace(e));

  let output = `Summary Report for Task: ${report.taskId}\n`;
  output += "=".repeat(40) + "\n\n";

  for (const ev of prunedEvidence) {
    output += `SHA256: ${ev.sha256Hash}\n`;
    output += `Exit Code: ${ev.exitCode}\n`;
    output += `Timing: ${ev.timingMs}ms\n`;
    output += `Output:\n${ev.rawOutput}\n\n`;
  }

  return output;
}
