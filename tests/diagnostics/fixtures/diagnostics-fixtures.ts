import type {
  DefectEntry,
  DefectAuditReport,
} from "../../../olt/scripts/src/mind/defects/index.ts";

export function createSampleDefectRecord(partial: Partial<DefectEntry> = {}): DefectEntry {
  return {
    id: partial.id ?? "defect-sample-01",
    type: partial.type ?? "main_thread_direct_execution",
    severity: partial.severity ?? "critical",
    timestamp: partial.timestamp ?? "2026-08-22T09:30:00.000Z",
    category: partial.category ?? "boundary_violation",
    status: partial.status ?? "open",
    observation: partial.observation ?? "Direct execution observed",
    remediation: partial.remediation ?? "Delegate to subagent",
    ...partial,
  };
}

export function createSampleAuditReport(defects: DefectEntry[] = []): DefectAuditReport {
  return {
    total_defects: defects.length,
    open_count: defects.filter((d) => d.status === "open").length,
    resolved_count: defects.filter((d) => d.status === "resolved").length,
    wontfix_count: 0,
    by_category: { boundary_violation: 1, code_defect: 0, model_reasoning_error: 0 },
    by_severity: { critical: 1, warning: 0 },
    defects,
    capsules_audited: ["/capsules/gen-1"],
    generated_at: "2026-08-22T10:00:00.000Z",
  };
}
