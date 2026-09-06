import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  checkTask4ProbeResolutions,
  type Task4ProbeCheckContext,
  type Task4ProbeCheckResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788680093396-qaueol.ts";

describe("Defect Remediation: defect-cli-1788680093396-qaueol", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788680093396-qaueol");
    expect(ERROR_CODE).toBe("INVALID_STATE");
    expect(DEFECT_TITLE.includes("cannot pass task-4")).toBe(true);
  });

  test("rejects passing task-4 with 5 open findings unanswered", () => {
    const findings = [
      "probe-task-4-01-1",
      "probe-task-4-01-2",
      "probe-task-4-01-3",
      "probe-task-4-01-4",
      "probe-task-4-01-5",
    ];
    const ctx: Task4ProbeCheckContext = {
      taskId: "task-4",
      findings,
    };
    const result: Task4ProbeCheckResult = checkTask4ProbeResolutions(ctx);
    expect(result.remediated).toBe(true);
    expect(result.approved).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.unansweredFindings.length).toBe(5);
    expect(result.error).toContain("cannot pass task-4: 5 open finding(s) unanswered");
  });

  test("approves task-4 when all 5 findings are answered with command ids", () => {
    const findings = [
      "probe-task-4-01-1",
      "probe-task-4-01-2",
      "probe-task-4-01-3",
      "probe-task-4-01-4",
      "probe-task-4-01-5",
    ];
    const ctx: Task4ProbeCheckContext = {
      taskId: "task-4",
      findings,
      resolutions: {
        "probe-task-4-01-1": "C-41",
        "probe-task-4-01-2": "C-42",
        "probe-task-4-01-3": "C-43",
        "probe-task-4-01-4": "C-44",
        "probe-task-4-01-5": "C-45",
      },
    };
    const result: Task4ProbeCheckResult = checkTask4ProbeResolutions(ctx);
    expect(result.remediated).toBe(true);
    expect(result.approved).toBe(true);
    expect(result.unansweredFindings.length).toBe(0);
  });
});
