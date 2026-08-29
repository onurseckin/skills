import { describe, expect, it } from "bun:test";
import {
  buildDynamicDagState,
  buildLivingTracerReport,
  buildStepTraceEntries,
  renderAsciiTimeline,
  renderDynamicDagAscii,
} from "../../../../olt/scripts/src/reporting/living-tracer/index.ts";

describe("reporting/living-tracer edge cases suite", () => {
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
    const events = [
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
        payload: { task_id: 12345 },
      },
    ];

    const dagState = buildDynamicDagState(events);
    expect(dagState.tasks.size).toBe(0);

    const report = buildLivingTracerReport(events);
    expect(report.summary.totalSteps).toBe(2);
  });
});
