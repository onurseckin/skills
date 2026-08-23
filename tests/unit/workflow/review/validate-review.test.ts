import { describe, expect, test } from "bun:test";
import { loadChecklist } from "../../../../olt/scripts/src/packets/role-contract.ts";
import {
  validateChecklistCoverage,
  validateFindings,
  validateReview,
} from "../../../../olt/scripts/src/workflow/review/validate-review.ts";
import type { TaskRecord } from "../../../../olt/scripts/src/workflow/types.ts";

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "T-1",
    status: "validating",
    requirement_ids: ["R-1"],
    write_scope: ["src/a"],
    dependencies: [],
    attempts: [],
    history: [],
    repair_round: 0,
    ...overrides,
  };
}

function goodFinding(overrides: Record<string, unknown> = {}) {
  return {
    id: "F-1",
    requirement_id: "R-1",
    severity: "minor",
    observation: "obs",
    evidence: [{ note: "e" }],
    remediation: "fix",
    revalidation: "re-run",
    ...overrides,
  };
}

describe("validateFindings", () => {
  test("rejects a non-array value", () => {
    expect(() => validateFindings(task(), "not-an-array", {})).toThrow(/findings must be an array/);
  });

  test("rejects a finding entry that is not an object", () => {
    expect(() => validateFindings(task(), ["not-an-object"], {})).toThrow(
      /finding must be an object/,
    );
  });

  test("rejects a finding whose requirement_id is not on the task, severity is unrecognised, or evidence is not an array", () => {
    expect(() =>
      validateFindings(task(), [goodFinding({ requirement_id: "R-ghost" })], {}),
    ).toThrow(/invalid finding: F-1/);
    expect(() => validateFindings(task(), [goodFinding({ severity: "urgent" })], {})).toThrow(
      /invalid finding: F-1/,
    );
    expect(() => validateFindings(task(), [goodFinding({ evidence: "not-an-array" })], {})).toThrow(
      /invalid finding: F-1/,
    );
  });

  test("rejects a finding that declares an unrecognised class", () => {
    expect(() => validateFindings(task(), [goodFinding({ class: "bogus-class" })], {})).toThrow(
      /finding F-1 declares an unknown class/,
    );
  });

  test("enforces a required finding class when the rule demands one", () => {
    expect(() =>
      validateFindings(task(), [goodFinding({ class: "defect" })], { required: "probe_demand" }),
    ).toThrow(/finding F-1 must declare class probe_demand/);
    expect(() =>
      validateFindings(task(), [goodFinding({ class: "probe_demand" })], {
        required: "probe_demand",
      }),
    ).not.toThrow();
  });

  test("enforces a forbidden finding class when the rule forbids one", () => {
    expect(() =>
      validateFindings(task(), [goodFinding({ class: "probe_demand" })], {
        forbidden: "probe_demand",
      }),
    ).toThrow(/finding F-1 declares class probe_demand, which this verdict cannot carry/);
  });

  test("accepts a well-formed finding with no class rule at all", () => {
    expect(() => validateFindings(task(), [goodFinding()], {})).not.toThrow();
  });
});

describe("validateReview", () => {
  test("rejects a non-object review value", () => {
    expect(() => validateReview(task(), null)).toThrow(/review must be an object/);
    expect(() => validateReview(task(), [])).toThrow(/review must be an object/);
    expect(() => validateReview(task(), "nope")).toThrow(/review must be an object/);
  });

  test("rejects a verdict that is neither pass nor reject", () => {
    expect(() =>
      validateReview(task(), {
        verdict: "probe",
        requirement_ids: ["R-1"],
        checks: [{ command_id: "C-1" }],
        findings: [],
      }),
    ).toThrow(/review verdict must be pass or reject; a probe is recorded with task:probe/);
  });

  test("rejects resolved_findings that are present but not an array", () => {
    expect(() =>
      validateReview(task(), {
        verdict: "pass",
        requirement_ids: ["R-1"],
        checks: [{ command_id: "C-1" }],
        findings: [],
        resolved_findings: "nope",
      }),
    ).toThrow(/resolved_findings must be an array/);
  });

  test("rejects a resolved_findings entry that is not an object", () => {
    expect(() =>
      validateReview(task(), {
        verdict: "pass",
        requirement_ids: ["R-1"],
        checks: [{ command_id: "C-1" }],
        findings: [],
        resolved_findings: ["not-an-object"],
      }),
    ).toThrow(/revalidation proof must be an object/);
  });

  test("accepts a well-formed passing review with a resolved finding", () => {
    const review = validateReview(task(), {
      verdict: "pass",
      requirement_ids: ["R-1"],
      checks: [{ command_id: "C-1" }],
      findings: [],
      resolved_findings: [
        { finding_id: "F-1", method: "re-ran the gate", evidence: [{ command_id: "C-2" }] },
      ],
    });
    expect(review.resolved_findings).toEqual([
      { finding_id: "F-1", method: "re-ran the gate", evidence: [{ command_id: "C-2" }] },
    ]);
  });

  test("rejects findings that declare probe_demand (forbidden outside a probe)", () => {
    expect(() =>
      validateReview(task(), {
        verdict: "reject",
        requirement_ids: ["R-1"],
        checks: [{ command_id: "C-1" }],
        findings: [goodFinding({ class: "probe_demand" })],
      }),
    ).toThrow(/declares class probe_demand, which this verdict cannot carry/);
  });
});

describe("validateChecklistCoverage: malformed entries", () => {
  const DOMAIN = "product";
  const checklist = loadChecklist(DOMAIN);
  const ids = checklist.items.map((item) => item.id);
  const fullyChecked = () => ids.map((id) => ({ id, disposition: "checked" as const }));

  test("rejects a checklist_coverage.items entry that is not an object", () => {
    expect(() => validateChecklistCoverage(DOMAIN, { items: ["not-an-object"] })).toThrow(
      /checklist_coverage\.items\[0\] must be an object/,
    );
  });

  test("rejects an adjacent_findings field that is present but not an array", () => {
    expect(() =>
      validateChecklistCoverage(DOMAIN, {
        items: fullyChecked(),
        adjacent_findings: "not-an-array",
      }),
    ).toThrow(/adjacent_findings must be an array/);
  });

  test("rejects an adjacent_findings entry that is not an object", () => {
    expect(() =>
      validateChecklistCoverage(DOMAIN, {
        items: fullyChecked(),
        adjacent_findings: ["not-an-object"],
      }),
    ).toThrow(/adjacent_findings\[0\] must be an object/);
  });

  test("rejects an adjacent finding with an unrecognised severity", () => {
    expect(() =>
      validateChecklistCoverage(DOMAIN, {
        items: fullyChecked(),
        adjacent_findings: [
          {
            id: "AF-1",
            checklist_item_id: ids[0],
            severity: "urgent",
            observation: "o",
            remediation: "r",
            evidence: [{ note: "e" }],
          },
        ],
      }),
    ).toThrow(/adjacent finding AF-1: invalid severity/);
  });

  test("accepts a well-formed adjacent finding citing a real checklist item", () => {
    const result = validateChecklistCoverage(DOMAIN, {
      items: fullyChecked(),
      adjacent_findings: [
        {
          id: "AF-1",
          checklist_item_id: ids[0],
          severity: "minor",
          observation: "o",
          remediation: "r",
          evidence: [{ note: "e" }],
        },
      ],
    });
    expect(result.adjacent_findings).toHaveLength(1);
    expect(result.adjacent_findings[0]!.id).toBe("AF-1");
  });
});
