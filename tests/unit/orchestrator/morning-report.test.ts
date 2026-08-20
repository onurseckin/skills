import { describe, expect, test } from "bun:test";
import {
  buildMorningReport,
  formatMorningReportMarkdown,
} from "../../../orchestrating-long-tasks/scripts/src/orchestrator/morning-report.ts";
import type { DispatchLogEvent } from "../../../orchestrating-long-tasks/scripts/src/orchestrator/dispatch-log.ts";
import { workflowState } from "../workflow/test-port.ts";

describe("buildMorningReport (B28.4)", () => {
  test("lists completed and escalated tasks by their own recorded facts", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "done";
    state.tasks["T-2"] = {
      ...structuredClone(state.tasks["T-1"]!),
      id: "T-2",
      status: "escalated",
      escalation_reason: "retry_budget_exhausted",
      escalation_evidence: "3 consecutive lease(s) expired with no submission",
    };
    const report = buildMorningReport(state, [], new Date("2026-08-19T08:00:00.000Z"));
    expect(report.completed.map((task) => task.taskId)).toEqual(["T-1"]);
    expect(report.escalated).toEqual([
      { taskId: "T-2", reason: "retry_budget_exhausted", evidence: "3 consecutive lease(s) expired with no submission" },
    ]);
    expect(report.needsHuman).toBe(report.escalated);
  });

  test("honesty: an escalated task with no recorded reason reports unknown, never a guess", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "escalated";
    const report = buildMorningReport(state, [], new Date("2026-08-19T08:00:00.000Z"));
    expect(report.escalated).toEqual([{ taskId: "T-1", reason: "unknown", evidence: "unknown" }]);
  });

  test("counts dead-agent reclaims and retry outcomes from the durable event trail", () => {
    const events: DispatchLogEvent[] = [
      { kind: "supervisor-dead-agent-reclaimed", payload: { task_id: "T-1" }, timestamp: "2026-08-19T00:00:00.000Z" },
      { kind: "supervisor-dead-agent-reclaimed", payload: { task_id: "T-2" }, timestamp: "2026-08-19T01:00:00.000Z" },
      {
        kind: "supervisor-dispatch-outcome",
        payload: { task_id: "T-1", outcome: "failed", failure_class: "transient" },
        timestamp: "2026-08-19T00:05:00.000Z",
      },
      {
        kind: "supervisor-dispatch-outcome",
        payload: { task_id: "T-1", outcome: "failed", failure_class: "deterministic" },
        timestamp: "2026-08-19T00:06:00.000Z",
      },
    ];
    const report = buildMorningReport(workflowState(), events, new Date("2026-08-19T08:00:00.000Z"));
    expect(report.deadAgentsReclaimed).toBe(2);
    expect(report.retries).toEqual([{ taskId: "T-1", transientRetries: 1, deterministicStops: 1 }]);
  });

  test("reports the run span as unknown, not zero, when there are no events to measure it from", () => {
    const report = buildMorningReport(workflowState(), [], new Date("2026-08-19T08:00:00.000Z"));
    expect(report.runSpanMs).toBeUndefined();
  });

  test("sums the scheduled backoff time across every recorded retry", () => {
    const events: DispatchLogEvent[] = [
      {
        kind: "supervisor-dispatch-outcome",
        payload: { task_id: "T-1", outcome: "failed", retry_at: "2026-08-19T00:00:10.000Z" },
        timestamp: "2026-08-19T00:00:00.000Z",
      },
      {
        kind: "supervisor-dispatch-outcome",
        payload: { task_id: "T-1", outcome: "failed", retry_at: "2026-08-19T00:01:20.000Z" },
        timestamp: "2026-08-19T00:01:00.000Z",
      },
    ];
    const report = buildMorningReport(workflowState(), events, new Date("2026-08-19T08:00:00.000Z"));
    expect(report.totalBackoffMs).toBe(10_000 + 20_000);
  });

  test("formatMorningReportMarkdown renders the whole contract without throwing on an empty run", () => {
    const report = buildMorningReport(workflowState(), [], new Date("2026-08-19T08:00:00.000Z"));
    const markdown = formatMorningReportMarkdown(report, "run-1");
    expect(markdown).toContain("Morning Report: `run-1`");
    expect(markdown).toContain("Escalated (needs a human)");
    expect(markdown).toContain("Run span**: unknown");
  });
});
