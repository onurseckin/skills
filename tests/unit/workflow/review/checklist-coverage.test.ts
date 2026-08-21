import { describe, expect, test } from "bun:test";
import { loadChecklist } from "../../../../orchestrating-long-tasks/scripts/src/packets/role-contract.ts";
import {
  validateChecklistCoverage,
  type ChecklistCoverageEntry,
} from "../../../../orchestrating-long-tasks/scripts/src/workflow/review/validate-review.ts";

// A real domain checklist, not a fixture invented for the test: B12.5's whole point is that
// coverage is checked against the actual, versioned document a validator's packet carries.
const DOMAIN = "product";
const checklist = loadChecklist(DOMAIN);
const ids = checklist.items.map((item) => item.id);

function fullyChecked(): ChecklistCoverageEntry[] {
  return ids.map((id) => ({ id, disposition: "checked" }));
}

function evidence() {
  return [{ kind: "diff", reference: "src/feature/x.ts" }];
}

describe("validateChecklistCoverage", () => {
  test("accepts a report that disposes of every item in the checklist", () => {
    const result = validateChecklistCoverage(DOMAIN, { items: fullyChecked() });
    expect(result.domain).toBe(DOMAIN);
    expect(result.items).toHaveLength(ids.length);
    expect(result.adjacent_findings).toEqual([]);
  });

  test("rejects a report that leaves any item unaccounted for (B33: omission is a fabricated pass)", () => {
    const items = fullyChecked().slice(1);
    expect(() => validateChecklistCoverage(DOMAIN, { items })).toThrow(
      new RegExp(`checklist coverage omits 1 item\\(s\\).*${ids[0]}`),
    );
  });

  test("rejects an item id the checklist does not declare", () => {
    const items = [...fullyChecked(), { id: "NOPE-999", disposition: "checked" }];
    expect(() => validateChecklistCoverage(DOMAIN, { items })).toThrow(
      /references an item this checklist does not declare: NOPE-999/,
    );
  });

  test("rejects a duplicate report of the same item", () => {
    const items = fullyChecked();
    items.push({ ...items[0]! });
    expect(() => validateChecklistCoverage(DOMAIN, { items })).toThrow(
      new RegExp(`reports ${ids[0]} more than once`),
    );
  });

  test("rejects not_applicable and could_not_check without a reason", () => {
    const items = fullyChecked();
    items[0] = { id: ids[0]!, disposition: "not_applicable" };
    expect(() => validateChecklistCoverage(DOMAIN, { items })).toThrow(
      /reason must be non-blank text/,
    );
  });

  test("accepts not_applicable and could_not_check when each carries a reason, and carries the reason through", () => {
    const items = fullyChecked();
    items[0] = {
      id: ids[0]!,
      disposition: "not_applicable",
      reason: "no such surface exists in this diff",
    };
    items[1] = {
      id: ids[1]!,
      disposition: "could_not_check",
      reason: "the tool this item needs is unavailable in this sandbox",
    };
    const result = validateChecklistCoverage(DOMAIN, { items });
    expect(result.items[0]).toEqual({
      id: ids[0]!,
      disposition: "not_applicable",
      reason: "no such surface exists in this diff",
    });
    expect(result.items[1]).toEqual({
      id: ids[1]!,
      disposition: "could_not_check",
      reason: "the tool this item needs is unavailable in this sandbox",
    });
  });

  test("rejects an unrecognized disposition", () => {
    const items = fullyChecked();
    items[0] = { id: ids[0]!, disposition: "skipped" as never };
    expect(() => validateChecklistCoverage(DOMAIN, { items })).toThrow(
      /disposition must be checked, not_applicable or could_not_check/,
    );
  });

  test("accepts an adjacent finding that cites a real checklist item with evidence", () => {
    const result = validateChecklistCoverage(DOMAIN, {
      items: fullyChecked(),
      adjacent_findings: [
        {
          id: "adj-1",
          checklist_item_id: ids[2],
          severity: "minor",
          observation: "the sidebar text size does not match its siblings",
          remediation: "match the sidebar label to the sibling font-size token",
          evidence: evidence(),
        },
      ],
    });
    expect(result.adjacent_findings).toEqual([
      {
        id: "adj-1",
        checklist_item_id: ids[2],
        severity: "minor",
        observation: "the sidebar text size does not match its siblings",
        remediation: "match the sidebar label to the sibling font-size token",
        evidence: evidence(),
      },
    ]);
  });

  test("rejects an adjacent finding citing an unknown checklist item", () => {
    expect(() =>
      validateChecklistCoverage(DOMAIN, {
        items: fullyChecked(),
        adjacent_findings: [
          {
            id: "adj-1",
            checklist_item_id: "NOPE-999",
            severity: "minor",
            observation: "x",
            remediation: "y",
            evidence: evidence(),
          },
        ],
      }),
    ).toThrow(/cites an item this checklist does not declare: NOPE-999/);
  });

  test("rejects an adjacent finding with no evidence", () => {
    expect(() =>
      validateChecklistCoverage(DOMAIN, {
        items: fullyChecked(),
        adjacent_findings: [
          {
            id: "adj-1",
            checklist_item_id: ids[2],
            severity: "minor",
            observation: "x",
            remediation: "y",
            evidence: [],
          },
        ],
      }),
    ).toThrow(/evidence must contain nonempty substantive objects/);
  });

  test("rejects a duplicate adjacent finding id", () => {
    const one = {
      id: "adj-1",
      checklist_item_id: ids[2],
      severity: "minor",
      observation: "x",
      remediation: "y",
      evidence: evidence(),
    };
    expect(() =>
      validateChecklistCoverage(DOMAIN, {
        items: fullyChecked(),
        adjacent_findings: [one, { ...one }],
      }),
    ).toThrow(/duplicate adjacent finding: adj-1/);
  });

  test("rejects a value that is not an object", () => {
    expect(() => validateChecklistCoverage(DOMAIN, [])).toThrow(
      /checklist coverage must be an object/,
    );
    expect(() => validateChecklistCoverage(DOMAIN, "nope")).toThrow(
      /checklist coverage must be an object/,
    );
  });

  test("rejects items that is not an array", () => {
    expect(() => validateChecklistCoverage(DOMAIN, { items: "nope" })).toThrow(
      /checklist_coverage.items must be an array/,
    );
  });
});
