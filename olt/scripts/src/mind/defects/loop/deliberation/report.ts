import { join } from "node:path";
import type { DefectDeliberationRound } from "./types.ts";

export function formatDeliberationReport(
  round: DefectDeliberationRound,
  options?: { readonly maxLines?: number | undefined },
): string {
  const maxLines =
    options !== undefined && options.maxLines !== undefined ? options.maxLines : 50;
  const lines: string[] = [
    `### Mind Defect Deliberation - Round ${round.round_number}`,
    `- **Status**: \`${round.status}\``,
    `- **Total Defects**: \`${round.defect_ids.length}\``,
    `- **Resolved**: \`${round.synthesis.resolved_defect_ids.length}\``,
    `- **Unresolved**: \`${round.synthesis.unresolved_defect_ids.length}\``,
    `- **Recommendation**: \`${round.synthesis.recommendation}\``,
    "",
    "#### Root Cause Hypotheses",
    ...round.hypotheses.map(
      (h) =>
        `- [${h.defect_id}] (${h.category}) confidence ${h.confidence.toFixed(2)}: ${h.root_cause}`,
    ),
    "",
    "#### Remediation Actions",
    ...round.actions.map(
      (a) =>
        `- [${a.action_id}] for ${a.defect_id} (${a.action_type}): ${a.description} -> gate: \`${a.prescribed_test}\``,
    ),
    "",
    "#### Empirical Resolution Proofs",
    ...(round.proofs.length > 0
      ? round.proofs.map((p) => `- [${p.task_id}]: \`${p.test_assertion}\` (${p.resolved_at})`)
      : ["_No resolution proofs submitted for this round._"]),
  ];
  return lines.slice(0, maxLines).join("\n");
}
