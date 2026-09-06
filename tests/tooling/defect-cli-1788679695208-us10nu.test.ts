import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validateTaskFindingsResolution,
  type TaskFindingsGateContext,
  type TaskFindingsGateResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788679695208-us10nu.ts";

describe("Defect Remediation: defect-cli-1788679695208-us10nu", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788679695208-us10nu");
    expect(ERROR_CODE).toBe("INVALID_STATE");
    expect(DEFECT_TITLE.includes("cannot pass task-1")).toBe(true);
  });

  test("rejects passing task-1 with 5 unanswered probe findings", () => {
    const findings = [
      "probe-task-1-01-1",
      "probe-task-1-01-2",
      "probe-task-1-01-3",
      "probe-task-1-01-4",
      "probe-task-1-01-5",
    ];
    const ctx: TaskFindingsGateContext = {
      taskId: "task-1",
      openFindings: findings,
      resolutions: {},
    };
    const result: TaskFindingsGateResult = validateTaskFindingsResolution(ctx);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.unansweredFindings.length).toBe(5);
    expect(result.error).toContain(
      "cannot pass task-1: 5 open finding(s) unanswered: probe-task-1-01-1, probe-task-1-01-2, probe-task-1-01-3, probe-task-1-01-4, probe-task-1-01-5",
    );
  });

  test("allows passing task-1 when all 5 findings are answered with command-ids", () => {
    const findings = [
      "probe-task-1-01-1",
      "probe-task-1-01-2",
      "probe-task-1-01-3",
      "probe-task-1-01-4",
      "probe-task-1-01-5",
    ];
    const ctx: TaskFindingsGateContext = {
      taskId: "task-1",
      openFindings: findings,
      resolutions: {
        "probe-task-1-01-1": "C-01",
        "probe-task-1-01-2": "C-02",
        "probe-task-1-01-3": "C-03",
        "probe-task-1-01-4": "C-04",
        "probe-task-1-01-5": "C-05",
      },
    };
    const result: TaskFindingsGateResult = validateTaskFindingsResolution(ctx);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.unansweredFindings.length).toBe(0);
    expect(result.error).toBeUndefined();
  });
});
