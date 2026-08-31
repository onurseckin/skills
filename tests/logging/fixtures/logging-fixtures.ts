import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DefectEntry } from "../../../olt/scripts/src/mind/defects/index.ts";

const tempRoots: string[] = [];

export function createLoggingSandbox(prefix: string = "logging-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

export function cleanupLoggingSandboxes(): void {
  for (const r of tempRoots) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
  tempRoots.length = 0;
}

export function createSampleDefectRecord(partial: Partial<DefectEntry> = {}): DefectEntry {
  return {
    id: partial.id ?? "defect-log-sample-01",
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
