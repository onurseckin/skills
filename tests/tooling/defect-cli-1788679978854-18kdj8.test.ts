import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  reevaluateTask2GateFindings,
  type Task2FindingsReevaluationContext,
  type Task2FindingsReevaluationResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788679978854-18kdj8.ts";

describe("Defect Remediation: defect-cli-1788679978854-18kdj8", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788679978854-18kdj8");
    expect(ERROR_CODE).toBe("INVALID_STATE");
    expect(DEFECT_TITLE.includes("cannot pass task-2")).toBe(true);
  });

  test("rejects when unanswered findings exist", () => {
    const ctx: Task2FindingsReevaluationContext = {
      taskId: "task-2",
      findings: [
        "probe-task-2-01-1",
        "probe-task-2-01-2",
        "probe-task-2-01-3",
        "probe-task-2-01-4",
        "probe-task-2-01-5",
      ],
      resolutions: {},
    };
    const result: Task2FindingsReevaluationResult = reevaluateTask2GateFindings(ctx);
    expect(result.remediated).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.error).toContain("cannot pass task-2: 5 open finding(s) unanswered");
  });

  test("approves when all 5 findings have resolutions", () => {
    const ctx: Task2FindingsReevaluationContext = {
      taskId: "task-2",
      findings: [
        "probe-task-2-01-1",
        "probe-task-2-01-2",
        "probe-task-2-01-3",
        "probe-task-2-01-4",
        "probe-task-2-01-5",
      ],
      resolutions: {
        "probe-task-2-01-1": "cmd-1",
        "probe-task-2-01-2": "cmd-2",
        "probe-task-2-01-3": "cmd-3",
        "probe-task-2-01-4": "cmd-4",
        "probe-task-2-01-5": "cmd-5",
      },
    };
    const result: Task2FindingsReevaluationResult = reevaluateTask2GateFindings(ctx);
    expect(result.remediated).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.pendingFindings.length).toBe(0);
  });
});
