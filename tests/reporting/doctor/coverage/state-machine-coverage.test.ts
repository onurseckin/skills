import { describe, expect, test } from "bun:test";
import {
  StateMachineAuditor,
  type LifecycleFinding,
} from "../../../../olt/scripts/src/reporting/doctor/state-machine-auditor.ts";

describe("StateMachineAuditor instantiation", () => {
  test("instantiates class instance", () => {
    expect(new StateMachineAuditor()).toBeInstanceOf(StateMachineAuditor);
  });
});

describe("StateMachineAuditor.isPlanBrainstormed", () => {
  test("identifies all brainstorm event kinds and event naming fields", () => {
    expect(StateMachineAuditor.isPlanBrainstormed([])).toBe(false);
    expect(StateMachineAuditor.isPlanBrainstormed([{}])).toBe(false);
    expect(StateMachineAuditor.isPlanBrainstormed([{ name: "plan-brainstormed" }])).toBe(true);
    expect(StateMachineAuditor.isPlanBrainstormed([{ kind: "plan:brainstorm" }])).toBe(true);
    expect(StateMachineAuditor.isPlanBrainstormed([{ type: "brainstormed" }])).toBe(true);
    expect(StateMachineAuditor.isPlanBrainstormed([{ name: "brainstorm" }])).toBe(true);
    expect(StateMachineAuditor.isPlanBrainstormed([{ name: "other-event" }])).toBe(false);
  });
});

describe("StateMachineAuditor.isPlanValidationApproved", () => {
  test("checks plan_review and plan_validation in runState", () => {
    expect(
      StateMachineAuditor.isPlanValidationApproved({ plan_review: { status: "approved" } }, []),
    ).toBe(true);
    expect(
      StateMachineAuditor.isPlanValidationApproved({ plan_review: { verdict: "approved" } }, []),
    ).toBe(true);
    expect(
      StateMachineAuditor.isPlanValidationApproved({ plan_review: { status: "pending" } }, []),
    ).toBe(false);

    expect(
      StateMachineAuditor.isPlanValidationApproved({ plan_validation: { status: "approved" } }, []),
    ).toBe(true);
    expect(
      StateMachineAuditor.isPlanValidationApproved(
        { plan_validation: { verdict: "approved" } },
        [],
      ),
    ).toBe(true);
    expect(
      StateMachineAuditor.isPlanValidationApproved({ plan_validation: { status: "rejected" } }, []),
    ).toBe(false);
  });

  test("checks plan validation event kinds, direct verdicts, and payload verdicts", () => {
    const eventKinds = [
      "plan-reviewed",
      "plan:review",
      "plan-validated",
      "plan:validate",
      "plan-validation",
    ];
    for (const kind of eventKinds) {
      expect(StateMachineAuditor.isPlanValidationApproved({}, [{ kind, status: "approved" }])).toBe(
        true,
      );
      expect(
        StateMachineAuditor.isPlanValidationApproved({}, [{ kind, verdict: "approved" }]),
      ).toBe(true);
      expect(
        StateMachineAuditor.isPlanValidationApproved({}, [
          { kind, payload: { status: "approved" } },
        ]),
      ).toBe(true);
      expect(
        StateMachineAuditor.isPlanValidationApproved({}, [
          { kind, payload: { verdict: "approved" } },
        ]),
      ).toBe(true);
      expect(
        StateMachineAuditor.isPlanValidationApproved({}, [
          { kind, payload: { status: "rejected" } },
        ]),
      ).toBe(false);
      expect(
        StateMachineAuditor.isPlanValidationApproved({}, [{ kind, payload: "not-a-record" }]),
      ).toBe(false);
    }
    expect(
      StateMachineAuditor.isPlanValidationApproved({}, [{ kind: "unrelated", status: "approved" }]),
    ).toBe(false);
  });
});

describe("StateMachineAuditor.isTaskValidationPassed", () => {
  test("handles missing, invalid, or empty validations", () => {
    expect(StateMachineAuditor.isTaskValidationPassed({})).toBe(false);
    expect(StateMachineAuditor.isTaskValidationPassed({ validations: "invalid" })).toBe(false);
    expect(StateMachineAuditor.isTaskValidationPassed({ validations: [] })).toBe(false);
    expect(StateMachineAuditor.isTaskValidationPassed({ validations: [null] })).toBe(false);
    expect(
      StateMachineAuditor.isTaskValidationPassed({ validations: [{ verdict: "pending" }] }),
    ).toBe(false);
  });

  test("handles passing, failing verdicts and open findings", () => {
    const passVerdicts = ["pass", "passed", "approved"];
    for (const verdict of passVerdicts) {
      expect(StateMachineAuditor.isTaskValidationPassed({ validations: [{ verdict }] })).toBe(true);
      expect(
        StateMachineAuditor.isTaskValidationPassed({ validations: [{ status: verdict }] }),
      ).toBe(true);
    }

    const failVerdicts = ["fail", "failed", "changes_requested", "rejected"];
    for (const verdict of failVerdicts) {
      expect(
        StateMachineAuditor.isTaskValidationPassed({
          validations: [{ verdict: "pass" }, { verdict }],
        }),
      ).toBe(false);
    }

    const failStatuses = ["fail", "failed", "rejected"];
    for (const status of failStatuses) {
      expect(
        StateMachineAuditor.isTaskValidationPassed({
          validations: [{ status: "pass" }, { status }],
        }),
      ).toBe(false);
    }

    expect(
      StateMachineAuditor.isTaskValidationPassed({
        validations: [{ verdict: "pass" }],
        findings: [{ status: "open" }],
      }),
    ).toBe(false);

    expect(
      StateMachineAuditor.isTaskValidationPassed({
        validations: [{ verdict: "pass" }],
        findings: [{ status: "resolved" }, "non-record", null],
      }),
    ).toBe(true);
  });
});

describe("StateMachineAuditor.auditLifecycle and summarizeLifecycle", () => {
  test("audits clean run state with no findings and summarizes healthy", () => {
    const findings = StateMachineAuditor.auditLifecycle({});
    expect(findings).toEqual([]);

    const summary = StateMachineAuditor.summarizeLifecycle(findings);
    expect(summary.healthy).toBe(true);
    expect(summary.findings).toHaveLength(0);
    expect(summary.issues).toHaveLength(0);
  });

  test("flags PLANNING_BRAINSTORMING_SKIPPED when tasks exist without brainstorm", () => {
    const fromTasksObj = StateMachineAuditor.auditLifecycle({
      tasks: { t1: { status: "pending" } },
    });
    expect(fromTasksObj.some((f) => f.code === "PLANNING_BRAINSTORMING_SKIPPED")).toBe(true);

    const fromPlanningTasks = StateMachineAuditor.auditLifecycle({
      planning_tasks: [{ id: "pt-1" }],
    });
    expect(fromPlanningTasks.some((f) => f.code === "PLANNING_BRAINSTORMING_SKIPPED")).toBe(true);

    const taskEventKinds = [
      "task-init",
      "task:spawn",
      "task_claimed",
      "task_done",
      "plan-applied",
      "plan:apply",
    ];
    for (const kind of taskEventKinds) {
      const fromEvent = StateMachineAuditor.auditLifecycle({}, [{ kind }]);
      expect(fromEvent.some((f) => f.code === "PLANNING_BRAINSTORMING_SKIPPED")).toBe(true);
    }
  });

  test("flags PLAN_VALIDATION_SKIPPED on progressed tasks without approved validation", () => {
    const progressedStatuses = [
      "leased",
      "running",
      "submitted",
      "validating",
      "validated",
      "done",
      "changes_requested",
      "retry_ready",
      "escalated",
      "gating",
      "branched",
    ];

    for (const status of progressedStatuses) {
      const findings = StateMachineAuditor.auditLifecycle({ tasks: { t1: { status } } }, [
        { name: "plan-brainstormed" },
      ]);
      expect(findings.some((f) => f.code === "PLAN_VALIDATION_SKIPPED")).toBe(true);
    }

    const leaseFinding = StateMachineAuditor.auditLifecycle(
      { tasks: { t1: { status: "other", lease: { agent_id: "worker-1" } } } },
      [{ name: "plan-brainstormed" }],
    );
    expect(leaseFinding.some((f) => f.code === "PLAN_VALIDATION_SKIPPED")).toBe(true);

    const reportFinding = StateMachineAuditor.auditLifecycle(
      { tasks: { t1: { status: "other", report: { passed: true } } } },
      [{ name: "plan-brainstormed" }],
    );
    expect(reportFinding.some((f) => f.code === "PLAN_VALIDATION_SKIPPED")).toBe(true);

    const progressedEventKinds = [
      "task-claimed",
      "task:claim",
      "task-submitted",
      "task:submit",
      "task-done",
      "task:done",
      "task-validated",
      "task:validate",
    ];
    for (const kind of progressedEventKinds) {
      const findings = StateMachineAuditor.auditLifecycle({}, [
        { name: "plan-brainstormed" },
        { kind },
      ]);
      expect(findings.some((f) => f.code === "PLAN_VALIDATION_SKIPPED")).toBe(true);
    }
  });

  test("flags UNVALIDATED_TASK_COMPLETED when done task lacks passing validations", () => {
    const runState = {
      plan_review: { status: "approved" },
      tasks: {
        tDoneValid: {
          status: "done",
          validations: [{ verdict: "pass" }],
        },
        tDoneInvalid: {
          status: "done",
          validations: [{ verdict: "fail" }],
        },
        tDoneNoValidations: {
          status: "done",
        },
        tOther: {
          status: "running",
        },
      },
    };

    const findings = StateMachineAuditor.auditLifecycle(runState, [{ name: "plan-brainstormed" }]);
    const unvalidated = findings.filter((f) => f.code === "UNVALIDATED_TASK_COMPLETED");
    expect(unvalidated).toHaveLength(2);
    expect(unvalidated.some((f) => f.details?.taskId === "tDoneInvalid")).toBe(true);
    expect(unvalidated.some((f) => f.details?.taskId === "tDoneNoValidations")).toBe(true);

    const summary = StateMachineAuditor.summarizeLifecycle(findings);
    expect(summary.healthy).toBe(false);
    expect(summary.issues).toHaveLength(2);
    expect(summary.issues[0]).toContain("lifecycle: [UNVALIDATED_TASK_COMPLETED]");
  });
});
