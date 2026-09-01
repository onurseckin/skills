import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DefectEntry } from "../../../olt/scripts/src/mind/defects/index.ts";
import { cleanupVirtualLoggingFS, setupVirtualLoggingFS } from "./virtual-fs-fixture.ts";

let initialized = false;

export function createLoggingSandbox(prefix: string = "logging-test-"): string {
  if (!initialized) {
    setupVirtualLoggingFS();
    initialized = true;
  }
  const dir = join("/virtual", `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function cleanupLoggingSandboxes(): void {
  cleanupVirtualLoggingFS();
  initialized = false;
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
