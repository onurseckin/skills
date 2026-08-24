import { describe, it, expect } from "bun:test";
import { LiveDefectDeduplicator } from "../../../olt/scripts/src/mind/defects/live-dedup.ts";
import type {
  DefectRecordInput,
  DefectResolutionProof,
} from "../../../olt/scripts/src/mind/defects/types.ts";

describe("mind/defects/live-dedup", () => {
  const baseDefect: DefectRecordInput = {
    id: "defect-001",
    type: "typecheck_failure",
    category: "code_defect",
    severity: "high",
    status: "open",
    observation: "Type 'number' is not assignable to type 'string'",
    agent_id: "agent-alpha",
    timestamp: "2026-08-24T10:00:00.000Z",
  };

  it("records new defects and triggers onNewDefect hook", () => {
    let newCaptured = false;
    const dedup = new LiveDefectDeduplicator({
      onNewDefect: (d) => {
        newCaptured = true;
      },
    });

    const res = dedup.record(baseDefect);
    expect(res.isNew).toBe(true);
    expect(res.occurrenceCount).toBe(1);
    expect(newCaptured).toBe(true);
    expect(dedup.size).toBe(1);
    expect(dedup.has("defect-001")).toBe(true);
    expect(dedup.get("defect-001")?.type).toBe("typecheck_failure");
  });

  it("deduplicates subsequent occurrences and triggers onDefectDeduplicated hook", () => {
    let dedupCount = 0;
    const dedup = new LiveDefectDeduplicator({
      onDefectDeduplicated: () => {
        dedupCount += 1;
      },
    });

    dedup.record(baseDefect);
    const res2 = dedup.record({
      ...baseDefect,
      timestamp: "2026-08-24T10:00:05.000Z",
    });

    expect(res2.isNew).toBe(false);
    expect(res2.occurrenceCount).toBe(2);
    expect(dedupCount).toBe(1);
    expect(dedup.size).toBe(1);
  });

  it("handles exact_dedup strategy", () => {
    const dedup = new LiveDefectDeduplicator({
      strategy: "exact_dedup",
    });

    dedup.record(baseDefect);
    const res2 = dedup.record(baseDefect);
    expect(res2.isNew).toBe(false);
    expect(res2.occurrenceCount).toBe(1);
  });

  it("handles windowed strategy with expiration", () => {
    let newCount = 0;
    const dedup = new LiveDefectDeduplicator({
      strategy: "windowed",
      windowMs: 5000,
      onNewDefect: () => {
        newCount += 1;
      },
    });

    dedup.record(baseDefect);
    const resOutside = dedup.record({
      ...baseDefect,
      timestamp: "2026-08-24T10:01:00.000Z", // 60s later > 5000ms
    });

    expect(resOutside.isNew).toBe(true);
    expect(newCount).toBe(2);
  });

  it("records many defects in batch", () => {
    const dedup = new LiveDefectDeduplicator();
    const batch = dedup.recordMany([
      baseDefect,
      { ...baseDefect, id: "defect-002", agent_id: "agent-beta" },
    ]);

    expect(batch.length).toBe(2);
    expect(dedup.getAll().length).toBe(2);
  });

  it("queries by status, category, and severity", () => {
    const dedup = new LiveDefectDeduplicator();
    dedup.record(baseDefect);
    dedup.record({
      id: "defect-002",
      type: "lease_boundary_error",
      category: "boundary_violation",
      severity: "critical",
      observation: "scope breach",
    });

    expect(dedup.getOpenDefects().length).toBe(2);
    expect(dedup.getResolvedDefects().length).toBe(0);
    expect(dedup.getByCategory("code_defect").length).toBe(1);
    expect(dedup.getByCategory("boundary_violation").length).toBe(1);
    expect(dedup.getBySeverity("CRITICAL").length).toBe(1);
    expect(dedup.getBySeverity("high").length).toBe(1);
  });

  it("resolves existing defects and rejects non-existing ones", () => {
    const dedup = new LiveDefectDeduplicator();
    dedup.record(baseDefect);

    const proof: DefectResolutionProof = {
      task_id: "task-remed-1",
      test_assertion: "passes",
      resolved_at: "2026-08-24T10:15:00.000Z",
      remediation_notes: "Fixed typing error",
      verified_by: "auditor",
    };

    const resolved = dedup.resolve("defect-001", proof);
    expect(resolved).not.toBeNull();
    expect(resolved?.status).toBe("resolved");
    expect(dedup.getResolvedDefects().length).toBe(1);

    const notFound = dedup.resolve("non-existent-id", proof);
    expect(notFound).toBeNull();
  });

  it("prunes old defects and evicts oldest when exceeding maxEntries", () => {
    const dedup = new LiveDefectDeduplicator({
      maxEntries: 2,
    });

    dedup.record({ ...baseDefect, id: "d1", agent_id: "a1", timestamp: "2026-08-24T00:00:00Z" });
    dedup.record({ ...baseDefect, id: "d2", agent_id: "a2", timestamp: "2026-08-24T00:01:00Z" });
    dedup.record({ ...baseDefect, id: "d3", agent_id: "a3", timestamp: "2026-08-24T00:02:00Z" });

    expect(dedup.size).toBe(2);
    expect(dedup.has("d1")).toBe(false); // d1 evicted
    expect(dedup.has("d2")).toBe(true);
    expect(dedup.has("d3")).toBe(true);

    const pruned = dedup.prune(60_000, Date.parse("2026-08-24T00:05:00Z"));
    expect(pruned).toBe(2);
    expect(dedup.size).toBe(0);
  });

  it("supports metrics, exportJsonl, importJsonl, and clear", () => {
    const dedup = new LiveDefectDeduplicator();
    dedup.record(baseDefect);

    const metrics = dedup.getMetrics();
    expect(metrics.total_recorded).toBe(1);
    expect(metrics.unique_defects).toBe(1);

    const jsonl = dedup.exportJsonl();
    expect(jsonl.trim().length).toBeGreaterThan(0);

    const dedup2 = new LiveDefectDeduplicator();
    const importedCount = dedup2.importJsonl(jsonl);
    expect(importedCount).toBe(1);
    expect(dedup2.size).toBe(1);

    dedup2.clear();
    expect(dedup2.size).toBe(0);
  });
});
