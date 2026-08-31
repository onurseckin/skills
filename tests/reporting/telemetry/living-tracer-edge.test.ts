import { describe, expect, it } from "bun:test";
import type { HarnessEvent } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  buildDynamicDagState,
  buildLivingTracerReport,
  buildStepTraceEntries,
  renderAsciiTimeline,
  renderDynamicDagAscii,
} from "../../../olt/scripts/src/reporting/living-tracer/index.ts";

export const livingTracerEdgeSuiteName = "reporting/living-tracer edge cases suite";

describe(livingTracerEdgeSuiteName, () => {
  it("handles empty event stream without crashing", () => {
    const dagState = buildDynamicDagState([]);
    expect(dagState.tasks.size).toBe(0);
    expect(dagState.sproutedRepairPairs.length).toBe(0);

    const steps = buildStepTraceEntries([]);
    expect(steps.length).toBe(0);

    const timeline = renderAsciiTimeline(steps);
    expect(timeline).toContain("No telemetry events recorded");

    const asciiDag = renderDynamicDagAscii(dagState);
    expect(asciiDag).toContain("No dynamic DAG tasks discovered");

    const report = buildLivingTracerReport([]);
    expect(report.summary.totalSteps).toBe(0);
    expect(report.summary.taskCount).toBe(0);
  });

  it("handles events with missing or malformed payloads gracefully", () => {
    const events: HarnessEvent[] = [
      {
        schema: "harness-event-v1",
        sequence: 1,
        timestamp: "2026-08-29T10:00:00.000Z",
        actor: "unknown",
        kind: "unknown_event_type",
      },
      {
        schema: "harness-event-v1",
        sequence: 2,
        timestamp: "invalid-timestamp",
        actor: "impl_13",
        kind: "task_started",
        payload: { task_id: 12345 as unknown as string },
      },
    ];

    const dagState = buildDynamicDagState(events);
    expect(dagState.tasks.size).toBe(0);

    const report = buildLivingTracerReport(events);
    expect(report.summary.totalSteps).toBe(2);
  });

  it("handles complex rejection, sprouting, repair and pass lifecycle transitions", () => {
    const events: HarnessEvent[] = [
      {
        schema: "harness-event-v1",
        sequence: 1,
        timestamp: "2026-08-29T10:00:00.000Z",
        actor: "coordinator",
        kind: "task-created",
        payload: { task_id: "T-ALPHA", label: "Alpha Task", round: 0 },
      },
      {
        schema: "harness-event-v1",
        sequence: 2,
        timestamp: "2026-08-29T10:00:01.000Z",
        actor: "impl_14",
        kind: "task-claimed",
        payload: { task_id: "T-ALPHA" },
      },
      {
        schema: "harness-event-v1",
        sequence: 3,
        timestamp: "2026-08-29T10:00:02.000Z",
        actor: "impl_14",
        kind: "tool-exec",
        payload: { task_id: "T-ALPHA", tool: "run_command", cmd: "bun test" },
      },
      {
        schema: "harness-event-v1",
        sequence: 4,
        timestamp: "2026-08-29T10:00:03.000Z",
        actor: "impl_14",
        kind: "gate:prove",
        payload: { task_id: "T-ALPHA", exit_code: 0 },
      },
      {
        schema: "harness-event-v1",
        sequence: 5,
        timestamp: "2026-08-29T10:00:04.000Z",
        actor: "impl_14",
        kind: "task-submitted",
        payload: { task_id: "T-ALPHA" },
      },
      {
        schema: "harness-event-v1",
        sequence: 6,
        timestamp: "2026-08-29T10:00:05.000Z",
        actor: "val_07",
        kind: "begin-validation",
        payload: { task_id: "T-ALPHA" },
      },
      {
        schema: "harness-event-v1",
        sequence: 7,
        timestamp: "2026-08-29T10:00:06.000Z",
        actor: "val_07",
        kind: "task-rejected",
        payload: { task_id: "T-ALPHA", reason: "Fails AST invariant" },
      },
      {
        schema: "harness-event-v1",
        sequence: 8,
        timestamp: "2026-08-29T10:00:07.000Z",
        actor: "val_07",
        kind: "assign-repairer",
        payload: { task_id: "T-ALPHA-repair-r1", replacement_id: "impl_14" },
      },
      {
        schema: "harness-event-v1",
        sequence: 9,
        timestamp: "2026-08-29T10:00:08.000Z",
        actor: "val_07",
        kind: "task-reviewed",
        payload: { task_id: "T-ALPHA-repair-r1", verdict: "passed" },
      },
    ];

    const dagState = buildDynamicDagState(events);
    expect(dagState.tasks.size).toBe(3);
    expect(dagState.sproutedRepairPairs.length).toBe(1);

    const report = buildLivingTracerReport(events, { runId: "alpha-run" });
    expect(report.summary.totalSteps).toBe(9);
    expect(report.summary.repairBranchesCount).toBe(2);
    expect(report.markdown).toContain("T-ALPHA");
  });

  it("handles task release and reset lifecycle events", () => {
    const events: HarnessEvent[] = [
      {
        schema: "harness-event-v1",
        sequence: 1,
        timestamp: "2026-08-29T10:00:00.000Z",
        actor: "coordinator",
        kind: "task-created",
        payload: { task_id: "T-BETA" },
      },
      {
        schema: "harness-event-v1",
        sequence: 2,
        timestamp: "2026-08-29T10:00:01.000Z",
        actor: "impl_14",
        kind: "task-claimed",
        payload: { task_id: "T-BETA" },
      },
      {
        schema: "harness-event-v1",
        sequence: 3,
        timestamp: "2026-08-29T10:00:02.000Z",
        actor: "impl_14",
        kind: "task-released",
        payload: { task_id: "T-BETA" },
      },
    ];

    const dagState = buildDynamicDagState(events);
    const task = dagState.tasks.get("T-BETA");
    expect(task?.status).toBe("ready");
    expect(task?.assignedAgent).toBeNull();
  });
});
