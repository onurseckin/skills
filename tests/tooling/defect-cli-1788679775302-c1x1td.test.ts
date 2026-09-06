import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  evaluateTask2GateFindings,
  type Task2FindingsContext,
  type Task2FindingsResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788679775302-c1x1td.ts";

describe("Defect Remediation: defect-cli-1788679775302-c1x1td", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788679775302-c1x1td");
    expect(ERROR_CODE).toBe("INVALID_STATE");
    expect(DEFECT_TITLE.includes("cannot pass task-2")).toBe(true);
  });

  test("rejects passing task-2 when findings remain open", () => {
    const findings = [
      "probe-task-2-01-1",
      "probe-task-2-01-2",
      "probe-task-2-01-3",
      "probe-task-2-01-4",
      "probe-task-2-01-5",
    ];
    const ctx: Task2FindingsContext = {
      taskId: "task-2",
      findings,
    };
    const result: Task2FindingsResult = evaluateTask2GateFindings(ctx);
    expect(result.remediated).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.unresolvedFindings.length).toBe(5);
    expect(result.error).toContain("cannot pass task-2: 5 open finding(s) unanswered");
  });

  test("passes task-2 when all findings are resolved with command ids", () => {
    const findings = [
      "probe-task-2-01-1",
      "probe-task-2-01-2",
      "probe-task-2-01-3",
      "probe-task-2-01-4",
      "probe-task-2-01-5",
    ];
    const ctx: Task2FindingsContext = {
      taskId: "task-2",
      findings,
      resolutions: {
        "probe-task-2-01-1": "C-21",
        "probe-task-2-01-2": "C-22",
        "probe-task-2-01-3": "C-23",
        "probe-task-2-01-4": "C-24",
        "probe-task-2-01-5": "C-25",
      },
    };
    const result: Task2FindingsResult = evaluateTask2GateFindings(ctx);
    expect(result.remediated).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.unresolvedFindings.length).toBe(0);
  });
});
