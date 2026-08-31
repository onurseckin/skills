/**
 * @file defect-fixture.ts
 * Pure In-Memory RAM Fixtures & Builders for Mind Defects Test Suites (Zero Disk I/O)
 */

import type {
  DefectCategory,
  DefectEntry,
  DefectResolutionProof,
  DefectSeverity,
  DefectStatus,
} from "../../../../olt/scripts/src/mind/defects/index.ts";

export function createMockResolutionProof(
  overrides?: Partial<DefectResolutionProof>,
): DefectResolutionProof {
  return {
    task_id: "task-001",
    test_assertion: "expect(isResolved).toBe(true)",
    resolved_at: "2026-08-24T12:00:00.000Z",
    verified_by: "tester",
    remediation_notes: "Fixed null check",
    ...overrides,
  };
}

export function createMockDefectEntry(overrides?: Partial<DefectEntry>): DefectEntry {
  return {
    id: "def-001",
    type: "type_error",
    observation: "Job payload lacks mandatory customerId field during batch processing",
    status: "open" as DefectStatus,
    severity: "high" as DefectSeverity,
    category: "code_defect" as DefectCategory,
    timestamp: "2026-08-24T12:00:00.000Z",
    ...overrides,
  };
}

export function createSampleDefectsJsonl(count = 3): string {
  const entries: DefectEntry[] = [];
  for (let i = 1; i <= count; i++) {
    entries.push(
      createMockDefectEntry({
        id: `def-${i.toString().padStart(3, "0")}`,
        type: `error_type_${i}`,
        severity: i === 1 ? "critical" : i === 2 ? "high" : "low",
        status: i === 3 ? "resolved" : "open",
        resolution: i === 3 ? createMockResolutionProof() : undefined,
      }),
    );
  }
  return entries.map((e) => JSON.stringify(e)).join("\n");
}

export class InMemoryDefectStore {
  private readonly records: Map<string, DefectEntry> = new Map();

  public save(entry: DefectEntry): void {
    this.records.set(entry.id, entry);
  }

  public get(id: string): DefectEntry | undefined {
    return this.records.get(id);
  }

  public list(): readonly DefectEntry[] {
    return Array.from(this.records.values());
  }

  public clear(): void {
    this.records.clear();
  }

  public toJsonl(): string {
    return Array.from(this.records.values())
      .map((e) => JSON.stringify(e))
      .join("\n");
  }
}
