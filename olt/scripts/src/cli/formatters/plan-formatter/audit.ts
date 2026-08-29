import type { AuditFinding } from "../../../graph/plan-audit.ts";
import { enforceLineLimit } from "../line-limiter.ts";
import {
  nextActionsBlock,
  planAuditNextActions,
  planReviewNextActions,
  planValidateStartNextActions,
} from "../next-actions/index.ts";
import type { PlanAuditBriefParams, PlanReviewParams, PlanValidateStartParams } from "./types.ts";

const AUDIT_SEVERITY_MARK: Record<AuditFinding["severity"], string> = {
  blocking: "🛑 [BLOCKING]",
  advisory: "⚠️ [ADVISORY]",
};

export function formatPlanAuditBrief(params: PlanAuditBriefParams): string {
  const blocking = params.findings.filter((f) => f.severity === "blocking");
  const lines = [
    `### Plan Audit: ${params.runId} (audit revision ${params.revision})`,
    `- **Findings**: ${params.findings.length} (${blocking.length} blocking, ${params.findings.length - blocking.length} advisory)`,
  ];

  if (params.findings.length === 0) {
    lines.push("- **Result**: no invariant violations found in the current planning buffer");
  }
  for (const f of params.findings) {
    lines.push(`- ${AUDIT_SEVERITY_MARK[f.severity]} \`${f.invariant}\`: ${f.message}`);
  }
  for (const n of params.notEvaluated) {
    lines.push(`- ℹ️ [NOT EVALUATED] \`${n.invariant}\`: ${n.reason}`);
  }

  lines.push(
    blocking.length === 0
      ? "- **Next Step**: `plan:compile` may seal this plan; no blocking invariant is outstanding."
      : "- **Next Step**: fix the plan, or seal it anyway with `plan:compile --accept-audit <id>:<reason>` naming each blocking invariant above and why.",
  );
  lines.push(
    ...nextActionsBlock(
      planAuditNextActions(params.runId, blocking.length > 0, blocking[0]?.invariant),
    ),
  );
  return enforceLineLimit(lines.join("\n"), 30);
}

export function formatPlanValidateStartBrief(params: PlanValidateStartParams): string {
  const md = [
    `### Plan Validation Opened: ${params.runId} (Graph Revision ${params.graphRevision})`,
    `- **Validator**: \`${params.validator}\``,
    `- **Token**: \`${params.token}\` (bearer credential — never log or persist it)`,
    `- **Under Review**: ${params.totalTasks} compiled tasks`,
    `- **Answer in writing**: does the decomposition match the prompt's entity count; is every dependency edge justified by a read/write relationship; can each gate fail if its task does nothing; will any task's scope leave one agent straggling.`,
    `- **Next Step**: \`plan:review --status approved\` or \`--status changes_requested\` with the four answers.`,
    ...nextActionsBlock(planValidateStartNextActions(params.runId, params.validator, params.token)),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export function formatPlanReviewBrief(params: PlanReviewParams): string {
  const approved = params.status === "approved";
  const md = [
    `### Plan Validation ${approved ? "Approved" : "Rejected"}: ${params.runId} (Graph Revision ${params.graphRevision})`,
    `- **Validator**: \`${params.validator}\``,
    `- **Summary**: ${params.summary}`,
    `- **Coverage**: ${params.dependencyEdgesReviewed} dependency edge(s) and ${params.gateIdsReviewed} gate(s) named, verified against the compiled plan.`,
    approved
      ? "- **Dispatch**: implementers and repairers may now claim tasks under this graph revision."
      : `- **Findings**: ${params.findingsCount} — every implementer and repairer claim against graph revision ${params.graphRevision} is refused until a fresh compile passes plan:review.`,
    `- **Next Step**: ${approved ? "proceed to Phase 2 continuous dispatch." : "replan (plan:add / plan:compile) and dispatch a fresh plan-validator against the new revision."}`,
    ...nextActionsBlock(planReviewNextActions(params.runId, approved)),
  ].join("\n");
  return enforceLineLimit(md, 30);
}
