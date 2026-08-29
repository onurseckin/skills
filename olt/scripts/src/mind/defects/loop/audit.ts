import {
  defectAuditCommand,
  type DefectAuditCommandResult,
} from "../../../cli/commands/defect-audit.ts";
import type { CommandContext, Flags } from "../../../cli/options.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import { parseDefectsJsonl } from "../sync/lifecycle-sync.ts";
import { categorizeDefect } from "../core/sanitizer.ts";
import type { DefectCategory, DefectEntry } from "../core/types.ts";

export interface DefectAuditReport {
  readonly total_defects: number;
  readonly open_count: number;
  readonly resolved_count: number;
  readonly wontfix_count: number;
  readonly by_category: Readonly<Record<DefectCategory, number>>;
  readonly by_severity?: Readonly<Record<string, number>> | undefined;
  readonly capsules_audited: readonly string[];
  readonly defects: readonly DefectEntry[];
  readonly generated_at?: string | undefined;
}

export function auditDefectLog(
  defectsOrCapsules?: readonly (DefectEntry | string)[] | string,
): DefectAuditReport {
  let rawDefects: DefectEntry[] = [];
  const capsulesAudited: string[] = [];

  if (typeof defectsOrCapsules === "string") {
    defectsOrCapsules = [defectsOrCapsules];
  }

  if (Array.isArray(defectsOrCapsules)) {
    for (const item of defectsOrCapsules) {
      if (typeof item === "string") {
        const root = item;
        if (existsSync(root)) {
          capsulesAudited.push(root);
          const candidates = [
            join(root, "defects.jsonl"),
            join(root, ".olt", "defects.jsonl"),
            join(root, "evidence", "defects.jsonl"),
          ];
          for (const cand of candidates) {
            if (existsSync(cand)) {
              rawDefects.push(...parseDefectsJsonl(readFileSync(cand, "utf-8")));
            }
          }
        }
      } else if (item && typeof item === "object") {
        rawDefects.push(item as DefectEntry);
      }
    }
  }

  // Deduplicate by ID, prioritizing resolved status updates
  const defectMap = new Map<string, DefectEntry>();
  for (const b of rawDefects) {
    const existing = defectMap.get(b.id);
    if (!existing) {
      defectMap.set(b.id, b);
    } else {
      if (existing.status !== "resolved" && b.status === "resolved") {
        defectMap.set(b.id, b);
      } else if (b.count && (!existing.count || b.count > existing.count)) {
        defectMap.set(b.id, { ...existing, count: b.count, last_seen_at: b.last_seen_at });
      }
    }
  }
  const uniqueDefects = Array.from(defectMap.values());

  let openCount = 0;
  let resolvedCount = 0;
  let wontfixCount = 0;

  const byCategory: Record<DefectCategory, number> = {
    boundary_violation: 0,
    model_reasoning_error: 0,
    code_defect: 0,
    documentation: 0,
    security_risk: 0,
    modularity_violation: 0,
  };

  const bySeverity: Record<string, number> = {};

  for (const b of uniqueDefects) {
    const status = (b.status || "open").toLowerCase().trim();
    if (status === "resolved" || status === "completed") resolvedCount += 1;
    else if (status === "wontfix" || status === "wont_fix") wontfixCount += 1;
    else openCount += 1;

    const cat: DefectCategory = categorizeDefect(b);
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;

    const sev = b.severity || "warning";
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
  }

  return {
    total_defects: uniqueDefects.length,
    open_count: openCount,
    resolved_count: resolvedCount,
    wontfix_count: wontfixCount,
    by_category: byCategory,
    by_severity: bySeverity,
    capsules_audited: capsulesAudited,
    defects: uniqueDefects,
    generated_at: new Date().toISOString(),
  };
}

export function formatDefectAuditBrief(
  report: DefectAuditReport,
  options?: { readonly maxLines?: number | undefined } | number,
): string {
  const maxLines = typeof options === "number" ? options : (options?.maxLines ?? 30);
  const lines: string[] = [
    "### Defect Audit & Remediation Brief",
    `- **Total Defects**: \`${report.total_defects}\` (Open: \`${report.open_count}\`, Resolved: \`${report.resolved_count}\`, Wontfix: \`${report.wontfix_count}\`)`,
    `- **By Category**: \`code_defect: ${report.by_category.code_defect}\`, \`model_reasoning_error: ${report.by_category.model_reasoning_error}\`, \`boundary_violation: ${report.by_category.boundary_violation}\``,
    "",
  ];

  if (report.defects.length === 0) {
    lines.push("_No defect records detected across audited capsules._");
  } else {
    lines.push("#### Recorded Defects");
    for (const b of report.defects) {
      const statusIcon =
        b.status === "resolved" ? "✅ resolved" : b.status === "open" ? "⚠️ open" : "⏹ wontfix";
      lines.push(
        `- \`${b.id}\` [${statusIcon}] (${b.category}/${b.severity}): ${b.observation || b.type}`,
      );
    }
  }

  if (lines.length > maxLines) {
    const truncated = lines.slice(0, maxLines - 1);
    truncated.push("... (truncated)");
    return truncated.join("\n");
  }

  return lines.join("\n");
}

export function logBoundaryViolationDefect(params: {
  readonly violation_type: string;
  readonly observation: string;
  readonly remediation?: string | undefined;
  readonly role?: string | undefined;
  readonly agent_id?: string | undefined;
  readonly timestamp?: string | undefined;
}): DefectEntry {
  if (!params.observation || !params.observation.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Boundary violation defect requires non-empty observation",
    );
  }
  if (!params.violation_type || !params.violation_type.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Boundary violation defect requires non-empty violation_type",
    );
  }

  const timestamp = params.timestamp?.trim() || new Date().toISOString();
  const id = `defect-boundary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    type: params.violation_type,
    category: "boundary_violation",
    severity: "critical",
    status: "open",
    observation: params.observation,
    remediation: params.remediation || "Constrain agent execution to declared boundary role rules",
    agent_id: params.agent_id,
    timestamp,
    first_seen_at: timestamp,
    last_seen_at: timestamp,
    count: 1,
  };
}

export function executeDefectAudit(
  flags: Flags,
  context?: CommandContext,
): DefectAuditCommandResult {
  return defectAuditCommand(flags, context);
}
