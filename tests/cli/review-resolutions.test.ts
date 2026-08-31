import { describe, expect, test } from "bun:test";
import type { Finding } from "../../olt/scripts/src/core/contracts/index.ts";
import {
  assertNoResolutions,
  assertOpenFindingsAnswered,
  resolutionProofs,
} from "../../olt/scripts/src/cli/commands/review-resolutions.ts";

function finding(overrides: Partial<Finding> & { id: string; class?: string }): Finding {
  return {
    requirement_id: "R-001",
    severity: "minor",
    observation: "observed",
    evidence: [],
    remediation: "fix",
    revalidation: "rerun",
    status: "open",
    ...overrides,
  } as Finding;
}

describe("resolutionProofs", () => {
  test("returns no proofs when nothing is being resolved", () => {
    expect(resolutionProofs({}, "task-1", [])).toEqual([]);
  });

  test("builds a proof per --resolve entry, splitting comma-joined command ids", () => {
    const open = [finding({ id: "finding-1", class: "defect" })];
    const proofs = resolutionProofs({ resolve: "finding-1=cmd-1, cmd-2" }, "task-1", open);
    expect(proofs).toEqual([
      {
        finding_id: "finding-1",
        method: "verification_passed",
        evidence: [{ command_id: "cmd-1" }, { command_id: "cmd-2" }],
      },
    ]);
  });

  test("derives the resolution method from a probe_demand finding's declared class", () => {
    const open = [finding({ id: "finding-1", class: "probe_demand" })];
    const proofs = resolutionProofs({ resolve: "finding-1=cmd-1" }, "task-1", open);
    expect(proofs[0]!.method).toBe("probe_demand_answered");
  });

  test("an explicit --resolution-method overrides the class-derived method", () => {
    const open = [finding({ id: "finding-1", class: "defect" })];
    const proofs = resolutionProofs(
      { resolve: "finding-1=cmd-1", "resolution-method": "finding-1=manual review" },
      "task-1",
      open,
    );
    expect(proofs[0]!.method).toBe("manual review");
  });

  test("throws when a finding declares no class and no explicit method is given", () => {
    const open = [finding({ id: "finding-1" })];
    expect(() => resolutionProofs({ resolve: "finding-1=cmd-1" }, "task-1", open)).toThrow(
      /declares no class/,
    );
  });

  test("throws on a malformed --resolve entry missing '='", () => {
    expect(() => resolutionProofs({ resolve: "finding-1" }, "task-1", [])).toThrow(
      /--resolve must be given as <finding-id>=<value>/,
    );
  });

  test("throws when --resolve cites zero command ids", () => {
    const open = [finding({ id: "finding-1", class: "defect" })];
    expect(() => resolutionProofs({ resolve: "finding-1= , ," }, "task-1", open)).toThrow(
      /cites no command id/,
    );
  });

  test("throws on a duplicate --resolution-method for the same finding", () => {
    expect(() =>
      resolutionProofs({ "resolution-method": ["finding-1=a", "finding-1=b"] }, "task-1", [
        finding({ id: "finding-1" }),
      ]),
    ).toThrow(/has two --resolution-method/);
  });

  test("throws when a --resolve or --resolution-method names a finding that is not open", () => {
    expect(() => resolutionProofs({ resolve: "finding-ghost=cmd-1" }, "task-1", [])).toThrow(
      /has no open finding finding-ghost/,
    );
  });
});

describe("assertNoResolutions", () => {
  test("passes silently when neither --resolve nor --resolution-method is present", () => {
    expect(() => assertNoResolutions({})).not.toThrow();
  });

  test("throws when --resolve is present on a failing verdict", () => {
    expect(() => assertNoResolutions({ resolve: "finding-1=cmd-1" })).toThrow(
      /applies to a passing verdict only/,
    );
  });

  test("throws when --resolution-method is present on a failing verdict", () => {
    expect(() => assertNoResolutions({ "resolution-method": "finding-1=manual" })).toThrow(
      /applies to a passing verdict only/,
    );
  });
});

describe("assertOpenFindingsAnswered", () => {
  test("passes when every open finding has a matching proof", () => {
    const open = [finding({ id: "finding-1" })];
    expect(() =>
      assertOpenFindingsAnswered("task-1", open, [
        { finding_id: "finding-1", method: "x", evidence: [] },
      ]),
    ).not.toThrow();
  });

  test("passes trivially when there are no open findings at all", () => {
    expect(() => assertOpenFindingsAnswered("task-1", [], [])).not.toThrow();
  });

  test("throws naming every open finding left unanswered", () => {
    const open = [finding({ id: "finding-1" }), finding({ id: "finding-2" })];
    expect(() => assertOpenFindingsAnswered("task-1", open, [])).toThrow(
      /2 open finding\(s\) unanswered: finding-1, finding-2/,
    );
  });
});
