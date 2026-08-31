import { describe, expect, test } from "bun:test";
import {
  buildMorningReport,
  formatMorningReportMarkdown,
} from "../../../olt/scripts/src/orchestrator/morning-report.ts";
import type { DispatchLogEvent } from "../../../olt/scripts/src/orchestrator/dispatch-log.ts";
import { workflowState } from "../../workflow/shared/test-port.ts";

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
      {
        taskId: "T-2",
        reason: "retry_budget_exhausted",
        evidence: "3 consecutive lease(s) expired with no submission",
      },
    ]);
    expect(report.needsHuman).toBe(report.escalated);
  });

  test("honesty: an escalated task with no recorded reason reports unknown, never a guess", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "escalated";
    const report = buildMorningReport(state, [], new Date("2026-08-19T08:00:00.000Z"));
    expect(report.escalated).toEqual([{ taskId: "T-1", reason: "unknown", evidence: "unknown" }]);
  });

  test("lists a task awaiting repair alongside the reason it was rejected", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "changes_requested";
    state.tasks["T-1"]!.original_implementer = "impl-1";
    state.tasks["T-1"]!.history.push({
      at: "2026-08-19T00:00:00.000Z",
      actor: "validator-1",
      from: "validating",
      to: "changes_requested",
      reason: "the new branch has no test coverage",
      attempt: 1,
    });
    const report = buildMorningReport(state, [], new Date("2026-08-19T08:00:00.000Z"));
    expect(report.changesRequested).toEqual([
      {
        taskId: "T-1",
        reason: "the new branch has no test coverage",
        originalImplementer: "impl-1",
      },
    ]);
    const markdown = formatMorningReportMarkdown(report, "run-changes-requested");
    expect(markdown).toContain("Awaiting repair (changes_requested)**: 1");
    expect(markdown).toContain("T-1`: the new branch has no test coverage");
  });

  test("counts dead-agent reclaims and retry outcomes from the durable event trail", () => {
    const events: DispatchLogEvent[] = [
      {
        kind: "supervisor-dead-agent-reclaimed",
        payload: { task_id: "T-1" },
        timestamp: "2026-08-19T00:00:00.000Z",
      },
      {
        kind: "supervisor-dead-agent-reclaimed",
        payload: { task_id: "T-2" },
        timestamp: "2026-08-19T01:00:00.000Z",
      },
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
    const report = buildMorningReport(
      workflowState(),
      events,
      new Date("2026-08-19T08:00:00.000Z"),
    );
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
    const report = buildMorningReport(
      workflowState(),
      events,
      new Date("2026-08-19T08:00:00.000Z"),
    );
    expect(report.totalBackoffMs).toBe(10_000 + 20_000);
  });

  test("B28.4: one report answers all four questions at once", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "done";
    state.tasks["T-2"] = {
      ...structuredClone(state.tasks["T-1"]!),
      id: "T-2",
      status: "retry_ready",
    };
    state.tasks["T-3"] = {
      ...structuredClone(state.tasks["T-1"]!),
      id: "T-3",
      status: "escalated",
      escalation_reason: "deterministic_failure",
      escalation_evidence:
        '"gate_failure" carries no reason to expect a retry would behave differently (dispatch attempt 1)',
    };
    const events: DispatchLogEvent[] = [
      {
        kind: "supervisor-dead-agent-reclaimed",
        payload: { task_id: "T-2" },
        timestamp: "2026-08-19T00:00:00.000Z",
      },
      {
        kind: "supervisor-dispatch-outcome",
        payload: {
          task_id: "T-2",
          outcome: "failed",
          failure_class: "transient",
          retry_at: "2026-08-19T00:00:05.000Z",
        },
        timestamp: "2026-08-19T00:00:00.000Z",
      },
      {
        kind: "supervisor-dispatch-outcome",
        payload: {
          task_id: "T-2",
          outcome: "failed",
          failure_class: "transient",
          retry_at: "2026-08-19T00:00:15.000Z",
        },
        timestamp: "2026-08-19T00:00:10.000Z",
      },
      {
        kind: "supervisor-dispatch-outcome",
        payload: { task_id: "T-3", outcome: "failed", failure_class: "deterministic" },
        timestamp: "2026-08-19T00:00:20.000Z",
      },
    ];
    const report = buildMorningReport(state, events, new Date("2026-08-19T08:00:00.000Z"));

    expect(report.completed.map((t) => t.taskId)).toEqual(["T-1"]);
    expect(report.escalated).toEqual([
      {
        taskId: "T-3",
        reason: "deterministic_failure",
        evidence:
          '"gate_failure" carries no reason to expect a retry would behave differently (dispatch attempt 1)',
      },
    ]);
    expect(report.needsHuman).toEqual(report.escalated);
    expect(report.retries).toEqual([
      { taskId: "T-2", transientRetries: 2, deterministicStops: 0 },
      { taskId: "T-3", transientRetries: 0, deterministicStops: 1 },
    ]);
    expect(report.deadAgentsReclaimed).toBe(1);
    expect(report.runSpanMs).toBe(20_000);
    expect(report.totalBackoffMs).toBe(5_000 + 5_000);

    const markdown = formatMorningReportMarkdown(report, "run-all-four");
    expect(markdown).toContain("Completed**: 1");
    expect(markdown).toContain("Escalated (needs a human)**: 1");
    expect(markdown).toContain("deterministic_failure");
    expect(markdown).toContain("Dead agents reclaimed**: 1");
    expect(markdown).toContain("T-2");
    expect(markdown).toContain("2 transient retries, 0 deterministic stops");
    expect(markdown).toContain("Run span**: 20000ms");
  });

  test("formatMorningReportMarkdown renders the whole contract without throwing on an empty run", () => {
    const report = buildMorningReport(workflowState(), [], new Date("2026-08-19T08:00:00.000Z"));
    const markdown = formatMorningReportMarkdown(report, "run-1");
    expect(markdown).toContain("Morning Report: `run-1`");
    expect(markdown).toContain("Escalated (needs a human)");
    expect(markdown).toContain("Run span**: unknown");
  });

  test("B27.2: reports occupancy against both the general and the gate ceiling, not just one", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "leased";
    state.tasks["T-1"]!.lease = {
      agent_id: "agent-1",
      role: "implementer",
      attempt: 1,
      token_digest: "d".repeat(64),
      issued_at: "2026-08-19T00:00:00.000Z",
      expires_at: "2026-08-19T01:00:00.000Z",
      heartbeat_at: "2026-08-19T00:00:00.000Z",
      duration_seconds: 3600,
    };
    const report = buildMorningReport(state, [], new Date("2026-08-19T08:00:00.000Z"), {
      maxParallel: 20,
      gateMaxParallel: 5,
    });
    expect(report.occupiedAtReport).toBe(1);
    expect(report.ceilings).toEqual({ maxParallel: 20, gateMaxParallel: 5 });

    const markdown = formatMorningReportMarkdown(report, "run-ceilings");
    expect(markdown).toContain("Occupancy at report time**: 1/20 general ceiling, gate ceiling 5");
  });

  test("B27.2: honesty — an unreported ceiling renders as unknown, never a guessed number", () => {
    const report = buildMorningReport(workflowState(), [], new Date("2026-08-19T08:00:00.000Z"));
    expect(report.ceilings).toEqual({});
    expect(report.occupiedAtReport).toBe(0);
    const markdown = formatMorningReportMarkdown(report, "run-no-ceilings");
    expect(markdown).toContain(
      "Occupancy at report time**: 0/unknown general ceiling, gate ceiling unknown",
    );
  });
});
