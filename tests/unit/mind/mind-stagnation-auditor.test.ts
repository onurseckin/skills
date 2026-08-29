import { describe, expect, it } from "bun:test";
import {
  auditMindPreplanningStagnation,
  MIND_PREPLANNING_STAGNATION,
} from "../../../olt/scripts/src/mind/auditing/mind-stagnation-auditor.ts";
import type {
  RawBacklogItem,
  RawDefectItem,
} from "../../../olt/scripts/src/mind/preplanning/types.ts";

describe("Active Anti-Passivity: Mind Pre-Planning Stagnation Auditor (Task 3.1)", () => {
  const nowMs = 1756465000000;

  it("reports healthy when no unplanned backlog or defect items exist", () => {
    const plannedBacklog: readonly RawBacklogItem[] = [
      { id: "item-1", title: "Task 1", status: "PLANNED", plan_path: "docs/planning/p1/PLAN.md" },
    ];
    const resolvedDefects: readonly RawDefectItem[] = [
      { id: "def-1", title: "Defect 1", status: "RESOLVED" },
    ];

    const result = auditMindPreplanningStagnation({
      explicitBacklog: plannedBacklog,
      explicitDefects: resolvedDefects,
      nowMs,
    });

    expect(result.is_stagnant).toBe(false);
    expect(result.pending_backlog_count).toBe(0);
    expect(result.open_defects_count).toBe(0);
    expect(result.error_code).toBeUndefined();
    expect(result.findings[0]).toContain("pipeline is healthy");
  });

  it("flags MIND_PREPLANNING_STAGNATION when unplanned items exist and Mind idled past threshold", () => {
    const openBacklog: readonly RawBacklogItem[] = [
      { id: "item-pending-1", title: "Unplanned Task", status: "PENDING" },
      { id: "item-pending-2", title: "Unplanned Task 2", status: "PENDING" },
    ];
    const openDefects: readonly RawDefectItem[] = [
      { id: "def-open-1", title: "Unplanned Defect", status: "OPEN" },
    ];

    // Last preplan was 300s ago (> 180s default threshold)
    const lastPreplanTimestamp = new Date(nowMs - 300_000).toISOString();

    const result = auditMindPreplanningStagnation({
      explicitBacklog: openBacklog,
      explicitDefects: openDefects,
      lastPreplanTimestamp,
      nowMs,
    });

    expect(result.is_stagnant).toBe(true);
    expect(result.pending_backlog_count).toBe(2);
    expect(result.open_defects_count).toBe(1);
    expect(result.error_code).toBe(MIND_PREPLANNING_STAGNATION);
    expect(result.recommended_remediation).toBe("RUN_PREPLANNING_FACTORY");
    expect(result.idle_duration_seconds).toBe(300);
    expect(result.findings.some((f) => f.includes("stagnated"))).toBe(true);
  });

  it("allows recent arrivals within threshold window without flagging stagnation", () => {
    const openBacklog: readonly RawBacklogItem[] = [
      { id: "item-new-1", title: "Fresh Task", status: "PENDING" },
    ];

    // Last preplan was 30s ago (< 180s threshold)
    const lastPreplanTimestamp = new Date(nowMs - 30_000).toISOString();

    const result = auditMindPreplanningStagnation({
      explicitBacklog: openBacklog,
      explicitDefects: [],
      lastPreplanTimestamp,
      nowMs,
    });

    expect(result.is_stagnant).toBe(false);
    expect(result.pending_backlog_count).toBe(1);
    expect(result.idle_duration_seconds).toBe(30);
    expect(result.error_code).toBeUndefined();
  });
});
