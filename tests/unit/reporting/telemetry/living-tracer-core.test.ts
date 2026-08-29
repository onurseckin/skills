import { describe, expect, it } from "bun:test";
import type { HarnessEvent } from "../../../../olt/scripts/src/core/contracts/index.ts";
import {
  buildDynamicDagState,
  buildLivingTracerReport,
  buildStepTraceEntries,
  createSproutedRepairBranch,
  formatDuration,
  formatSeq,
  renderAsciiTimeline,
  renderDynamicDagAscii,
  type DynamicTaskState,
} from "../../../../olt/scripts/src/reporting/living-tracer/index.ts";

describe("reporting/living-tracer core suite", () => {
  it("formats sequence numbers and durations accurately", () => {
    expect(formatSeq(5)).toBe("#005");
    expect(formatSeq(123)).toBe("#123");
    expect(formatDuration(500)).toBe("00:00.50");
    expect(formatDuration(65000)).toBe("01:05.00");
  });

  it("creates sprouted repair branches correctly", () => {
    const parentTask: DynamicTaskState = {
      id: "task-10",
      label: "Implement Feature",
      status: "failed",
      role: "implementer",
      dependencies: [],
      writeScope: ["src/"],
      assignedAgent: "impl_13",
      origin: "initial",
      createdAtSeq: 1,
      updatedAtSeq: 5,
      round: 0,
      attempt: 1,
      executionState: "[FAILED]",
      activeTool: null,
    };

    const branch = createSproutedRepairBranch(parentTask, "task-10", 0, 6, "Rejected by validator");
    expect(branch.repairTask.id).toBe("task-10-repair-r1");
    expect(branch.validatorTask.id).toBe("val-task-10-r1");
    expect(branch.nextRound).toBe(1);
  });

  it("builds dynamic DAG state and living tracer report from events", () => {
    const events: HarnessEvent[] = [
      {
        schema: "harness-event-v1",
        sequence: 1,
        timestamp: "2026-08-29T10:00:00.000Z",
        actor: "coordinator",
        kind: "task_created",
        payload: { task_id: "T1", effort: 50 },
      },
      {
        schema: "harness-event-v1",
        sequence: 2,
        timestamp: "2026-08-29T10:00:01.000Z",
        actor: "impl_13",
        kind: "task_started",
        payload: { task_id: "T1" },
      },
      {
        schema: "harness-event-v1",
        sequence: 3,
        timestamp: "2026-08-29T10:00:02.000Z",
        actor: "impl_13",
        kind: "task_completed",
        payload: { task_id: "T1" },
      },
    ];

    const dagState = buildDynamicDagState(events);
    expect(dagState.tasks.size).toBe(1);

    const steps = buildStepTraceEntries(events);
    expect(steps.length).toBe(3);

    const timeline = renderAsciiTimeline(steps);
    expect(timeline).toContain("T1");

    const dagAscii = renderDynamicDagAscii(dagState);
    expect(dagAscii).toContain("T1");

    const report = buildLivingTracerReport(events, { runId: "test-run" });
    expect(report.summary.totalSteps).toBe(3);
    expect(report.markdown).toContain("Living Dynamic DAG Expansion");
  });
});
