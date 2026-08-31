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
    testPath: "tests/unit/mind/defects/lifecycle-and-resolution.test.ts",
    testSuite: "DefectLifecycleSuite",
    passTimestamp: Date.now(),
    executionDurationMs: 42,
    assertionCount: 5,
    verificationHash: "sha256-mock-verified-resolution-hash-999",
    ...overrides,
  };
}

export function createMockDefectEntry(overrides?: Partial<DefectEntry>): DefectEntry {
  return {
    id: "def-001",
    title: "Unexpected null reference in queue processor",
    description: "Job payload lacks mandatory customerId field during batch processing",
    status: "open" as DefectStatus,
    severity: "P1" as DefectSeverity,
    category: "code_defect" as DefectCategory,
    detectedAt: Date.now() - 3600_000,
    ...overrides,
  };
}

export function createSampleDefectsJsonl(count = 3): string {
  const entries: DefectEntry[] = [];
  for (let i = 1; i <= count; i++) {
    entries.push(
      createMockDefectEntry({
        id: `def-${i.toString().padStart(3, "0")}`,
        title: `Sample Defect ${i}`,
        severity: i === 1 ? "P0" : i === 2 ? "P1" : "P2",
        status: i === 3 ? "resolved" : "open",
        proof: i === 3 ? createMockResolutionProof() : undefined,
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
