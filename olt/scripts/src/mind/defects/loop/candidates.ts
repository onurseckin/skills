import { categorizeDefect } from "../core/sanitizer.ts";
import type { DefectEntry } from "../core/types.ts";

export interface MindCandidateProposal {
  readonly id: string;
  readonly kind: "proposal" | "defect";
  readonly statement: string;
  readonly rationale: string;
  readonly charter_goal_ids: readonly string[];
  readonly write_scope: readonly string[];
  readonly status: string;
  readonly disposition: string;
  readonly defect_id?: string | null | undefined;
  readonly evidence_class: string;
  readonly created_at?: string | undefined;
}

export function formulateDefectCandidates(
  defects: readonly DefectEntry[],
  charterGoals: readonly string[] = ["G1", "G2"],
): MindCandidateProposal[] {
  if (!Array.isArray(defects)) return [];
  if (defects.length === 0) return [];
  const goals =
    Array.isArray(charterGoals) && charterGoals.length > 0 ? charterGoals : ["G1", "G2"];
  const openDefects = defects.filter((b) => b.status === "open");
  const proposals: MindCandidateProposal[] = [];

  for (const b of openDefects) {
    const sanitizedId = b.id.startsWith("defect-") ? b.id.slice("defect-".length) : b.id;
    const candidateId = `cand-defect-${sanitizedId}`;
    const category =
      b.category !== undefined && b.category !== "" ? b.category : categorizeDefect(b);
    const kind: "proposal" | "defect" = category === "code_defect" ? "defect" : "proposal";

    let matchedGoals: string[] = [];
    if (category === "boundary_violation") {
      matchedGoals = goals.filter((g) => {
        if (g === "G2") return true;
        if (g.toLowerCase().includes("invariant")) return true;
        return false;
      });
      if (matchedGoals.length === 0) matchedGoals = goals.slice(0, 1);
    } else if (category === "model_reasoning_error") {
      matchedGoals = goals.filter((g) => {
        if (g === "G1") return true;
        if (g === "G2") return true;
        return false;
      });
      if (matchedGoals.length === 0) matchedGoals = goals.slice(0, 1);
    } else {
      matchedGoals = goals.filter((g) => {
        if (g === "G1") return true;
        if (g.toLowerCase().includes("type")) return true;
        return false;
      });
      if (matchedGoals.length === 0) matchedGoals = goals.slice(0, 1);
    }

    const obs =
      b.observation !== undefined && b.observation !== ""
        ? b.observation
        : b.description !== undefined && b.description !== ""
          ? b.description
          : b.type !== undefined && b.type !== ""
            ? b.type
            : "unknown defect";
    const rem =
      b.remediation !== undefined && b.remediation !== ""
        ? b.remediation
        : "Remediate defect violation";
    const statement = `Remediate ${category.replace(/_/g, " ")} defect: ${obs}`;
    const sev = b.severity !== undefined && b.severity !== "" ? b.severity : "warning";
    const rationale = `Defect [${b.id}] (${sev}): ${rem}`;

    proposals.push({
      id: candidateId,
      kind,
      statement,
      rationale,
      charter_goal_ids: matchedGoals,
      write_scope: ["olt/scripts/src/mind/"],
      status: "needs_authority",
      disposition: "actionable",
      defect_id: b.id,
      evidence_class: "agent_reported",
      created_at: b.timestamp,
    });
  }

  return proposals;
}
