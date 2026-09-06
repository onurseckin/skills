import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  evaluateTask3GateFindings,
  type Task3FindingsContext,
  type Task3FindingsResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788679744044-tdzchk.ts";

describe("Defect Remediation: defect-cli-1788679744044-tdzchk", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788679744044-tdzchk");
    expect(ERROR_CODE).toBe("INVALID_STATE");
    expect(DEFECT_TITLE.includes("cannot pass task-3")).toBe(true);
  });

  test("rejects passing task-3 with 5 unanswered probe findings", () => {
    const findings = [
      "probe-task-3-01-1",
      "probe-task-3-01-2",
      "probe-task-3-01-3",
      "probe-task-3-01-4",
      "probe-task-3-01-5",
    ];
    const ctx: Task3FindingsContext = {
      taskId: "task-3",
      findings,
    };
    const result: Task3FindingsResult = evaluateTask3GateFindings(ctx);
    expect(result.remediated).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.error).toContain("cannot pass task-3: 5 open finding(s) unanswered");
  });

  test("allows passing task-3 when all findings are resolved", () => {
    const findings = [
      "probe-task-3-01-1",
      "probe-task-3-01-2",
      "probe-task-3-01-3",
      "probe-task-3-01-4",
      "probe-task-3-01-5",
    ];
    const ctx: Task3FindingsContext = {
      taskId: "task-3",
      findings,
      resolutions: {
        "probe-task-3-01-1": "C-31",
        "probe-task-3-01-2": "C-32",
        "probe-task-3-01-3": "C-33",
        "probe-task-3-01-4": "C-34",
        "probe-task-3-01-5": "C-35",
      },
    };
    const result: Task3FindingsResult = evaluateTask3GateFindings(ctx);
    expect(result.remediated).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.openFindings.length).toBe(0);
  });
});
