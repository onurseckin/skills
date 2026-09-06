import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  evaluateTask4GateFindings,
  type Task4FindingsContext,
  type Task4FindingsResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788679732674-3b7vqy.ts";

describe("Defect Remediation: defect-cli-1788679732674-3b7vqy", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788679732674-3b7vqy");
    expect(ERROR_CODE).toBe("INVALID_STATE");
    expect(DEFECT_TITLE.includes("cannot pass task-4")).toBe(true);
  });

  test("rejects passing task-4 when findings remain unresolved", () => {
    const findings = [
      "probe-task-4-01-1",
      "probe-task-4-01-2",
      "probe-task-4-01-3",
      "probe-task-4-01-4",
      "probe-task-4-01-5",
    ];
    const ctx: Task4FindingsContext = {
      taskId: "task-4",
      findings,
      resolutions: {},
    };
    const result: Task4FindingsResult = evaluateTask4GateFindings(ctx);
    expect(result.remediated).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.error).toContain(
      "cannot pass task-4: 5 open finding(s) unanswered: probe-task-4-01-1, probe-task-4-01-2, probe-task-4-01-3, probe-task-4-01-4, probe-task-4-01-5",
    );
  });

  test("passes task-4 when all findings are mapped to command ids", () => {
    const findings = [
      "probe-task-4-01-1",
      "probe-task-4-01-2",
      "probe-task-4-01-3",
      "probe-task-4-01-4",
      "probe-task-4-01-5",
    ];
    const ctx: Task4FindingsContext = {
      taskId: "task-4",
      findings,
      resolutions: {
        "probe-task-4-01-1": "C-11",
        "probe-task-4-01-2": "C-12",
        "probe-task-4-01-3": "C-13",
        "probe-task-4-01-4": "C-14",
        "probe-task-4-01-5": "C-15",
      },
    };
    const result: Task4FindingsResult = evaluateTask4GateFindings(ctx);
    expect(result.remediated).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.openFindings.length).toBe(0);
  });
});
