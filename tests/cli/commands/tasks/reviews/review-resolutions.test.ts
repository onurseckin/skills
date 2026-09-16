import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Finding } from "../../../../../olt/scripts/src/core/contracts/index.ts";
import {
  assertNoResolutions,
  assertOpenFindingsAnswered,
  resolutionProofs,
} from "../../../../../olt/scripts/src/cli/commands/review-resolutions.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";

beforeEach(() => {
  setupVirtualCliFS();
});
afterEach(() => {
  cleanupVirtualCliFS();
});

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

  test("throws when bare --resolve has no checks or evidence", () => {
    expect(() => resolutionProofs({ resolve: "finding-1" }, "task-1", [])).toThrow(
      /--resolve finding-1 cites no command id; pass <finding-id>=<command-id> or specify --checks\/--evidence/,
    );
  });

  test("applies global --resolution-method across resolved findings without explicit method", () => {
    const open = [
      finding({ id: "finding-1", class: "defect" }),
      finding({ id: "finding-2", class: "probe_demand" }),
    ];
    const proofs = resolutionProofs(
      { resolve: ["finding-1=cmd-1", "finding-2=cmd-2"], "resolution-method": "manual_review" },
      "task-1",
      open,
    );
    expect(proofs).toHaveLength(2);
    expect(proofs.find((p) => p.finding_id === "finding-1")?.method).toBe("manual_review");
    expect(proofs.find((p) => p.finding_id === "finding-2")?.method).toBe("manual_review");
  });

  test("allows finding-specific --resolution-method to override global method", () => {
    const open = [
      finding({ id: "finding-1", class: "defect" }),
      finding({ id: "finding-2", class: "probe_demand" }),
    ];
    const proofs = resolutionProofs(
      {
        resolve: ["finding-1=cmd-1", "finding-2=cmd-2"],
        "resolution-method": ["manual_review", "finding-1=custom_verification"],
      },
      "task-1",
      open,
    );
    expect(proofs.find((p) => p.finding_id === "finding-1")?.method).toBe("custom_verification");
    expect(proofs.find((p) => p.finding_id === "finding-2")?.method).toBe("manual_review");
  });

  test("defaults evidence command from --checks for bare --resolve <finding-id>", () => {
    const open = [finding({ id: "finding-1", class: "defect" })];
    const proofs = resolutionProofs(
      { resolve: "finding-1", checks: "cmd-check-1,cmd-check-2" },
      "task-1",
      open,
    );
    expect(proofs).toEqual([
      {
        finding_id: "finding-1",
        method: "verification_passed",
        evidence: [{ command_id: "cmd-check-1" }, { command_id: "cmd-check-2" }],
      },
    ]);
  });

  test("defaults evidence command from --evidence for bare --resolve <finding-id>", () => {
    const open = [finding({ id: "finding-1", class: "probe_demand" })];
    const proofs = resolutionProofs({ resolve: "finding-1", evidence: "cmd-ev-1" }, "task-1", open);
    expect(proofs).toEqual([
      {
        finding_id: "finding-1",
        method: "probe_demand_answered",
        evidence: [{ command_id: "cmd-ev-1" }],
      },
    ]);
  });

  test("supports --resolve all to resolve all open findings", () => {
    const open = [
      finding({ id: "finding-1", class: "defect" }),
      finding({ id: "finding-2", class: "probe_demand" }),
    ];
    const proofs = resolutionProofs({ resolve: "all", checks: "cmd-all" }, "task-1", open);
    expect(proofs).toHaveLength(2);
    expect(proofs.find((p) => p.finding_id === "finding-1")?.method).toBe("verification_passed");
    expect(proofs.find((p) => p.finding_id === "finding-2")?.method).toBe("probe_demand_answered");
    expect(proofs[0]?.evidence).toEqual([{ command_id: "cmd-all" }]);
    expect(proofs[1]?.evidence).toEqual([{ command_id: "cmd-all" }]);
  });

  test("supports --resolve-all flag to resolve all open findings", () => {
    const open = [finding({ id: "finding-1", class: "defect" })];
    const proofs = resolutionProofs({ "resolve-all": true, checks: "cmd-all" }, "task-1", open);
    expect(proofs).toHaveLength(1);
    expect(proofs[0]?.finding_id).toBe("finding-1");
  });

  test("handles --resolve all with mixed explicit overrides and global method", () => {
    const open = [
      finding({ id: "f-defect-1", class: "defect" }),
      finding({ id: "f-defect-2", class: "defect" }),
      finding({ id: "f-probe-1", class: "probe_demand" }),
    ];
    const flags = {
      checks: "cmd-1,cmd-2",
      resolve: ["all", "f-defect-1=cmd-3"],
      "resolution-method": ["manual_verified", "f-probe-1=probe_demand_answered"],
    };
    const proofs = resolutionProofs(flags, "t1", open);
    expect(proofs).toHaveLength(3);

    const d1 = proofs.find((p) => p.finding_id === "f-defect-1");
    expect(d1?.evidence).toEqual([{ command_id: "cmd-3" }]);
    expect(d1?.method).toBe("manual_verified");

    const d2 = proofs.find((p) => p.finding_id === "f-defect-2");
    expect(d2?.evidence).toEqual([{ command_id: "cmd-1" }, { command_id: "cmd-2" }]);
    expect(d2?.method).toBe("manual_verified");

    const p1 = proofs.find((p) => p.finding_id === "f-probe-1");
    expect(p1?.evidence).toEqual([{ command_id: "cmd-1" }, { command_id: "cmd-2" }]);
    expect(p1?.method).toBe("probe_demand_answered");
  });

  test("handles --resolve all with zero open findings succeeds without checks", () => {
    const proofs = resolutionProofs({ resolve: "all" }, "t1", []);
    expect(proofs).toEqual([]);
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
