import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  checkTask1ProbeResolutions,
  type Task1ProbeCheckContext,
  type Task1ProbeCheckResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788680086301-b3744p.ts";

describe("Defect Remediation: defect-cli-1788680086301-b3744p", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788680086301-b3744p");
    expect(ERROR_CODE).toBe("INVALID_STATE");
    expect(DEFECT_TITLE.includes("cannot pass task-1")).toBe(true);
  });

  test("rejects passing task-1 with 5 open findings unanswered", () => {
    const findings = [
      "probe-task-1-01-1",
      "probe-task-1-01-2",
      "probe-task-1-01-3",
      "probe-task-1-01-4",
      "probe-task-1-01-5",
    ];
    const ctx: Task1ProbeCheckContext = {
      taskId: "task-1",
      findings,
    };
    const result: Task1ProbeCheckResult = checkTask1ProbeResolutions(ctx);
    expect(result.remediated).toBe(true);
    expect(result.approved).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.unansweredFindings.length).toBe(5);
    expect(result.error).toContain(
      "cannot pass task-1: 5 open finding(s) unanswered",
    );
  });

  test("approves task-1 when all 5 findings are answered with command ids", () => {
    const findings = [
      "probe-task-1-01-1",
      "probe-task-1-01-2",
      "probe-task-1-01-3",
      "probe-task-1-01-4",
      "probe-task-1-01-5",
    ];
    const ctx: Task1ProbeCheckContext = {
      taskId: "task-1",
      findings,
      resolutions: {
        "probe-task-1-01-1": "C-1",
        "probe-task-1-01-2": "C-2",
        "probe-task-1-01-3": "C-3",
        "probe-task-1-01-4": "C-4",
        "probe-task-1-01-5": "C-5",
      },
    };
    const result: Task1ProbeCheckResult = checkTask1ProbeResolutions(ctx);
    expect(result.remediated).toBe(true);
    expect(result.approved).toBe(true);
    expect(result.unansweredFindings.length).toBe(0);
  });
});
