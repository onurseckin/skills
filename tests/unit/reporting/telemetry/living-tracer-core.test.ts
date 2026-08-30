import { describe, expect, it } from "bun:test";
import type { HarnessEvent } from "../../../../olt/scripts/src/core/contracts/index.ts";
import {
  buildDynamicDagState,
  buildLivingTracerReport,
  buildStepTraceEntries,
  createSproutedRepairBranch,
  formatDuration,
  formatSeq,
  handleTaskStateTransition,
  renderAsciiTimeline,
  renderDynamicDagAscii,
  type DynamicTaskState,
  type ReplayContext,
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
      origin: "static",
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

  it("handles state transitions using ReplayContext accurately", () => {
    const initialTask: DynamicTaskState = {
      id: "task-01",
      label: "Refactor Module",
      status: "ready",
      role: "implementer",
      dependencies: [],
      writeScope: ["src/"],
      origin: "static",
      createdAtSeq: 1,
      updatedAtSeq: 1,
      round: 0,
      attempt: 1,
      executionState: "[⏳ READY]",
    };

    const ctx: ReplayContext = {
      taskMap: new Map([["task-01", initialTask]]),
      agentMap: new Map(),
      branches: new Set(),
      sproutedRepairPairs: [],
      revision: 1,
      maxRoundReached: 0,
    };

    handleTaskStateTransition(
      initialTask,
      "task-01",
      {
        actor: "impl_13",
        kind: "task:claim",
        lowerKind: "task:claim",
        seq: 2,
        payload: { task_id: "task-01" },
        role: "implementer",
        tool: null,
        cmd: null,
        exitCode: null,
        roundInPayload: 0,
        attemptInPayload: 1,
        validatorFromPayload: null,
      },
      ctx,
    );

    const leased = ctx.taskMap.get("task-01");
    expect(leased?.status).toBe("leased");
    expect(leased?.assignedAgent).toBe("impl_13");

    handleTaskStateTransition(
      leased!,
      "task-01",
      {
        actor: "impl_13",
        kind: "tool_call",
        lowerKind: "tool_call",
        seq: 3,
        payload: { tool: "write_to_file", command: "edit code" },
        role: "implementer",
        tool: "write_to_file",
        cmd: "edit code",
        exitCode: null,
        roundInPayload: 0,
        attemptInPayload: 1,
        validatorFromPayload: null,
      },
      ctx,
    );

    const running = ctx.taskMap.get("task-01");
    expect(running?.status).toBe("in_progress");
    expect(running?.activeTool).toBe("write_to_file");

    handleTaskStateTransition(
      running!,
      "task-01",
      {
        actor: "val_07",
        kind: "task:reject",
        lowerKind: "task:reject",
        seq: 4,
        payload: { reason: "Missing invariants" },
        role: "validator",
        tool: null,
        cmd: null,
        exitCode: null,
        roundInPayload: 0,
        attemptInPayload: 1,
        validatorFromPayload: "val_07",
      },
      ctx,
    );

    const rejected = ctx.taskMap.get("task-01");
    expect(rejected?.status).toBe("changes_requested");
    expect(ctx.sproutedRepairPairs.length).toBe(1);
    expect(ctx.maxRoundReached).toBe(1);
    expect(ctx.taskMap.has("task-01-repair-r1")).toBe(true);
    expect(ctx.taskMap.has("val-task-01-r1")).toBe(true);
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
