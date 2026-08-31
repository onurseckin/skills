import { describe, expect, test } from "bun:test";
import type { TaskRecord } from "../../../../olt/scripts/src/workflow/types.ts";
import {
  buildProbeDemand,
  buildReviewFinding,
  failingVerdictInput,
  nextFindingRound,
  parseSeverity,
  resolveFindingRequirement,
} from "../../../../olt/scripts/src/cli/commands/task-finding-input.ts";
import {
  dualChannelRefusalMessage,
  resolveCheckIds,
} from "../../../../olt/scripts/src/cli/commands/task-review-support.ts";
import type { DualChannelAuditResult } from "../../../../olt/scripts/src/validation/channels/index.ts";

function taskWith(requirementIds: string[]): TaskRecord {
  return { id: "task-1", requirement_ids: requirementIds } as unknown as TaskRecord;
}

describe("resolveFindingRequirement", () => {
  test("accepts an explicit requirement id the task owns", () => {
    expect(resolveFindingRequirement(taskWith(["R-1", "R-2"]), "R-2")).toBe("R-2");
  });

  test("refuses an explicit requirement id the task does not own", () => {
    expect(() => resolveFindingRequirement(taskWith(["R-1"]), "R-9")).toThrow(
      /requirement R-9 is not owned by task-1/,
    );
  });

  test("infers the sole requirement when none is given", () => {
    expect(resolveFindingRequirement(taskWith(["R-1"]), undefined)).toBe("R-1");
  });

  test("throws when the task owns no requirement at all", () => {
    expect(() => resolveFindingRequirement(taskWith([]), undefined)).toThrow(
      /task-1 has no requirement to bind a finding to/,
    );
  });

  test("throws when the task owns several requirements and none was named", () => {
    expect(() => resolveFindingRequirement(taskWith(["R-1", "R-2"]), undefined)).toThrow(
      /covers 2 requirements; pass --requirement/,
    );
  });
});

describe("buildProbeDemand", () => {
  test("cites command evidence when command ids are given", () => {
    const demand = buildProbeDemand({
      taskId: "task-1",
      round: 1,
      index: 0,
      requirementId: "R-1",
      demand: "prove it",
      commandIds: ["cmd-1", "cmd-2"],
      revalidation: undefined,
    });
    expect(demand.id).toBe("probe-task-1-01-1");
    expect(demand.evidence).toEqual([
      { kind: "command", reference: "cmd-1", evidence_class: "harness_observed" },
      { kind: "command", reference: "cmd-2", evidence_class: "harness_observed" },
    ]);
    expect(demand.revalidation).toBe("Cite a command id that proves this for task-1");
  });

  test("falls back to a plain demand-kind evidence entry with no command ids", () => {
    const demand = buildProbeDemand({
      taskId: "task-1",
      round: 2,
      index: 3,
      requirementId: "R-1",
      demand: "prove it another way",
      commandIds: [],
      revalidation: "custom revalidation text",
    });
    expect(demand.id).toBe("probe-task-1-02-4");
    expect(demand.evidence).toEqual([
      { kind: "demand", detail: "prove it another way", evidence_class: "agent_reported" },
    ]);
    expect(demand.revalidation).toBe("custom revalidation text");
  });
});

describe("parseSeverity", () => {
  test("accepts each recognised severity", () => {
    expect(parseSeverity("critical", "severity")).toBe("critical");
    expect(parseSeverity("important", "severity")).toBe("important");
    expect(parseSeverity("minor", "severity")).toBe("minor");
  });

  test("rejects an unrecognised severity, naming the offending flag", () => {
    expect(() => parseSeverity("urgent", "severity")).toThrow(
      /--severity must be one of critical, important, minor/,
    );
  });
});

describe("failingVerdictInput", () => {
  test("requires --summary, --severity and --remediation in turn", () => {
    expect(() => failingVerdictInput({})).toThrow(/--summary is required for a failing verdict/);
    expect(() => failingVerdictInput({ summary: "broke" })).toThrow(
      /--severity is required for a failing verdict/,
    );
    expect(() => failingVerdictInput({ summary: "broke", severity: "critical" })).toThrow(
      /--remediation is required for a failing verdict/,
    );
  });

  test("carries an optional --revalidation through only when given", () => {
    const withoutRevalidation = failingVerdictInput({
      summary: "broke",
      severity: "minor",
      remediation: "fix it",
    });
    expect(withoutRevalidation).toEqual({
      observation: "broke",
      severity: "minor",
      remediation: "fix it",
    });

    const withRevalidation = failingVerdictInput({
      summary: "broke",
      severity: "minor",
      remediation: "fix it",
      revalidation: "rerun the gate",
    });
    expect(withRevalidation.revalidation).toBe("rerun the gate");
  });
});

describe("buildReviewFinding", () => {
  test("uses the -01 suffix for round 1 and a padded round for later rounds", () => {
    const first = buildReviewFinding({
      taskId: "task-1",
      round: 1,
      requirementId: "R-1",
      severity: "critical",
      checkIds: [],
      summary: "broke",
      remediation: "fix it",
    });
    expect(first.id).toBe("finding-task-1-01");

    const third = buildReviewFinding({
      taskId: "task-1",
      round: 3,
      requirementId: "R-1",
      severity: "critical",
      checkIds: [],
      summary: "broke again",
      remediation: "fix it again",
    });
    expect(third.id).toBe("finding-task-1-03");
  });

  test("an explicit findingId overrides the generated one", () => {
    const finding = buildReviewFinding({
      taskId: "task-1",
      findingId: "finding-custom",
      round: 1,
      requirementId: "R-1",
      severity: "minor",
      checkIds: [],
      summary: "x",
      remediation: "y",
    });
    expect(finding.id).toBe("finding-custom");
  });

  test("cites command evidence when checkIds are given, otherwise a failure-kind entry", () => {
    const withChecks = buildReviewFinding({
      taskId: "task-1",
      round: 1,
      requirementId: "R-1",
      severity: "minor",
      checkIds: ["cmd-1"],
      summary: "x",
      remediation: "y",
    });
    expect(withChecks.evidence).toEqual([{ kind: "command", reference: "cmd-1" }]);

    const withoutChecks = buildReviewFinding({
      taskId: "task-1",
      round: 1,
      requirementId: "R-1",
      severity: "minor",
      checkIds: [],
      summary: "the failure text",
      remediation: "y",
    });
    expect(withoutChecks.evidence).toEqual([{ kind: "failure", detail: "the failure text" }]);
  });

  test("defaults revalidation to the task's own gate when not given explicitly", () => {
    const finding = buildReviewFinding({
      taskId: "task-1",
      round: 1,
      requirementId: "R-1",
      severity: "minor",
      checkIds: [],
      summary: "x",
      remediation: "y",
    });
    expect(finding.revalidation).toBe("Run gate tests for task-1");
  });
});

describe("nextFindingRound", () => {
  test("is one past the task's repair round when that exceeds the finding count", () => {
    const task = { repair_round: 2, findings: [] } as unknown as TaskRecord;
    expect(nextFindingRound(task)).toBe(3);
  });

  test("is one past the existing finding count when that exceeds the repair round", () => {
    const task = {
      repair_round: 0,
      findings: [{}, {}],
    } as unknown as TaskRecord;
    expect(nextFindingRound(task)).toBe(3);
  });

  test("defaults repair_round to 0 and findings to none when both are absent", () => {
    expect(nextFindingRound({} as TaskRecord)).toBe(1);
  });
});

describe("resolveCheckIds", () => {
  test("returns [] when there is no explicit evidence and commands is not an object", () => {
    expect(resolveCheckIds(undefined, undefined, "task-1", "val-1", false)).toEqual([]);
    expect(resolveCheckIds(undefined, null, "task-1", "val-1", false)).toEqual([]);
  });

  test("filters recorded commands by task, actor, and (when required) success", () => {
    const commands = {
      "cmd-1": { id: "cmd-1", task_id: "task-1", actor: "val-1", exit_code: 0 },
      "cmd-2": { id: "cmd-2", task_id: "task-1", actor: "val-1", exit_code: 1 },
      "cmd-3": { id: "cmd-3", task_id: "task-1", actor: "someone-else", exit_code: 0 },
      "cmd-4": { id: "cmd-4", task_id: "task-other", actor: "val-1", exit_code: 0 },
    };
    expect(resolveCheckIds(undefined, commands, "task-1", "val-1", false)).toEqual([
      "cmd-1",
      "cmd-2",
    ]);
    expect(resolveCheckIds(undefined, commands, "task-1", "val-1", true)).toEqual(["cmd-1"]);
  });

  test("splits and trims explicit comma-separated evidence, ignoring commands entirely", () => {
    expect(resolveCheckIds(" cmd-1 , cmd-2,cmd-3 ", {}, "task-1", "val-1", false)).toEqual([
      "cmd-1",
      "cmd-2",
      "cmd-3",
    ]);
  });
});

describe("dualChannelRefusalMessage", () => {
  test("joins each error-severity finding's id, category and message", () => {
    const audit: DualChannelAuditResult = {
      isUiTask: true,
      passed: false,
      mode: "rejected",
      findings: [
        { id: "f-1", category: "dom", message: "no dom capture", severity: "error" },
        { id: "f-2", category: "screenshot", message: "informational only", severity: "warning" },
      ] as unknown as DualChannelAuditResult["findings"],
      proofs: [],
      summary: "overall summary text",
    };
    expect(dualChannelRefusalMessage("task-1", audit)).toBe(
      "cannot pass task-1: Dual-Channel Validator Protocol mandate not satisfied (mode rejected): f-1 [dom] no dom capture",
    );
  });

  test("falls back to the audit summary when there is no error-severity finding to detail", () => {
    const audit: DualChannelAuditResult = {
      isUiTask: true,
      passed: false,
      mode: "rejected",
      findings: [],
      proofs: [],
      summary: "nothing specific was captured",
    };
    expect(dualChannelRefusalMessage("task-1", audit)).toBe(
      "cannot pass task-1: Dual-Channel Validator Protocol mandate not satisfied (mode rejected): nothing specific was captured",
    );
  });
});
