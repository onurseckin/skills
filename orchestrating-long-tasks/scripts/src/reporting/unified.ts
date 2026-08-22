import { loadRun } from "../store/index.ts";
import type { WorkflowState } from "../workflow/types.ts";
import { enforceLineLimit } from "../cli/formatters/line-limiter.ts";
import { isRecord } from "../requirements/predicates.ts";

export interface LeaseMatrixRow {
  taskId: string;
  agentId: string;
  status: string;
}

export function generateLeasesReport(runRoot: string): {
  matrix: LeaseMatrixRow[];
  markdown: string;
} {
  const loaded = loadRun(runRoot);
  const state = loaded.state as unknown as WorkflowState;

  const tasks = Object.values(state.tasks ?? {});
  const branches = state.branches ?? [];
  const matrix: LeaseMatrixRow[] = [];

  for (const t of tasks) {
    if (t.lease) {
      matrix.push({
        taskId: String(t.id),
        agentId: String(t.lease.agent),
        status: String(t.status),
      });
    }
  }

  for (const b of branches) {
    for (const sub of b.sub_tasks) {
      if (sub.lease) {
        matrix.push({
          taskId: String(sub.id),
          agentId: String(sub.lease.agent),
          status: "open (sub_task)",
        });
      }
    }
  }

  matrix.sort((a, b) => a.taskId.localeCompare(b.taskId));

  const lines = [
    `### Active Leases Matrix: \`${loaded.manifest.run_id}\``,
    `- **Total Active Leases**: ${matrix.length}`,
    ...matrix.map((r) => `  - \`${r.taskId}\` leased by \`${r.agentId}\` [${r.status}]`),
  ];

  return { matrix, markdown: enforceLineLimit(lines.join("\n")) };
}

export interface DecisionAuditRow {
  requirementId: string;
  decision: string;
  rationale: string;
  actor: string;
}

export function generateDecisionsReport(runRoot: string): {
  decisions: DecisionAuditRow[];
  markdown: string;
} {
  const loaded = loadRun(runRoot);
  const state = loaded.state as unknown as WorkflowState;

  const requirements = state.requirements ?? [];
  const decisions: DecisionAuditRow[] = [];

  for (const req of requirements) {
    if (Array.isArray(req.authority_history)) {
      for (const entry of req.authority_history) {
        if (isRecord(entry) && typeof entry.decision === "string") {
          decisions.push({
            requirementId: String(req.id),
            decision: entry.decision,
            rationale: String(entry.rationale),
            actor: String(entry.actor),
          });
        }
      }
    }
  }

  const lines = [
    `### Authority Decisions Audit: \`${loaded.manifest.run_id}\``,
    `- **Total Decisions**: ${decisions.length}`,
    ...decisions.map(
      (d) =>
        `  - \`${d.requirementId}\`: ${d.decision.toUpperCase()} by \`${d.actor}\` (${d.rationale})`,
    ),
  ];

  return { decisions, markdown: enforceLineLimit(lines.join("\n")) };
}
