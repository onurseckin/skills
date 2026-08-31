import { describe, expect, test } from "bun:test";
import {
  EVIDENCE_CLASSES,
  estimated,
  evidenced,
  isEvidenceClass,
  isEvidenced,
} from "../../../olt/scripts/src/core/contracts/index.ts";

function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

describe("evidence contract", () => {
  test("recognizes every declared evidence class and nothing else", () => {
    expect([...EVIDENCE_CLASSES]).toEqual([
      "harness_observed",
      "agent_reported",
      "host_reported",
      "derived",
      "unknown",
    ]);
    for (const evidenceClass of EVIDENCE_CLASSES) {
      expect(isEvidenceClass(evidenceClass)).toBeTrue();
    }
    expect(isEvidenceClass("observed")).toBeFalse();
    expect(isEvidenceClass("")).toBeFalse();
    expect(isEvidenceClass(null)).toBeFalse();
    expect(isEvidenceClass(1)).toBeFalse();
  });

  test("builds evidenced values without an estimation flag", () => {
    expect(evidenced(42, "harness_observed")).toEqual({
      value: 42,
      evidence_class: "harness_observed",
    });
    expect("is_estimated" in evidenced(42, "harness_observed")).toBeFalse();
  });

  test("marks estimates as derived and flagged", () => {
    expect(estimated(120)).toEqual({
      value: 120,
      evidence_class: "derived",
      is_estimated: true,
    });
  });

  test("guards evidenced shapes against wrong values classes and flags", () => {
    expect(isEvidenced(evidenced(7, "agent_reported"), isNumber)).toBeTrue();
    expect(isEvidenced(estimated(7), isNumber)).toBeTrue();
    expect(isEvidenced({ value: "7", evidence_class: "agent_reported" }, isNumber)).toBeFalse();
    expect(isEvidenced({ value: 7, evidence_class: "guessed" }, isNumber)).toBeFalse();
    expect(isEvidenced({ value: 7 }, isNumber)).toBeFalse();
    expect(
      isEvidenced({ value: 7, evidence_class: "derived", is_estimated: "yes" }, isNumber),
    ).toBeFalse();
    expect(isEvidenced(null, isNumber)).toBeFalse();
    expect(isEvidenced([7], isNumber)).toBeFalse();
  });

  test("treats a recorded unknown as a value the guard still accepts", () => {
    const missing = evidenced<number | null>(null, "unknown");
    expect(missing.evidence_class).toBe("unknown");
    expect(isEvidenced(missing, (value): value is number | null => value === null)).toBeTrue();
  });
});
