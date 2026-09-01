import { afterEach } from "bun:test";
import { join } from "node:path";
import type {
  DefectEntry,
  DefectAuditReport,
} from "../../../olt/scripts/src/mind/defects/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | null = null;
let counter = 0;

export const SCRATCH_BASE = "/virtual/diagnostics";

export function setupVirtualDiagnosticsFS(): VirtualMemoryFS {
  cleanupVirtualDiagnosticsFS();
  vfs = new VirtualMemoryFS();
  session = createVirtualFSSession(vfs);
  return vfs;
}

export function cleanupVirtualDiagnosticsFS(): void {
  if (session) {
    session.cleanup();
    session = null;
  }
}

export function getVirtualDiagnosticsFS(): VirtualMemoryFS {
  return vfs;
}

afterEach(() => {
  cleanupVirtualDiagnosticsFS();
});

export function tempDir(prefix = "diag"): string {
  if (!session) {
    setupVirtualDiagnosticsFS();
  }
  counter += 1;
  const dir = join(SCRATCH_BASE, `${prefix}-${Date.now()}-${counter}`);
  vfs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function scratchRoot(callerPath = "diag-test", label = "test"): string {
  return tempDir(label);
}

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
