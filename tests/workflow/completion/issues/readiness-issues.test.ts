import { describe, expect, test } from "bun:test";
import { completionReadinessIssues } from "../../../../olt/scripts/src/workflow/completion/readiness-issues.ts";
import { BRANCH_LEDGER_KEY } from "../../../../olt/scripts/src/workflow/branch/ledger.ts";
import { branchRecord } from "../../branch/fixtures/fixture.ts";
import { commandRecord, workflowState } from "../../shared/test-port.ts";

describe("completionReadinessIssues: requirements shapes beyond a plain array", () => {
  test("reads requirements nested under a { requirements: [...] } wrapper object", () => {
    const state = workflowState();
    (state as unknown as { requirements: unknown }).requirements = {
      requirements: [{ id: "R-1", status: "planned", disposition: "actionable", evidence: [] }],
    };
    expect(completionReadinessIssues(state)).toContain("requirement R-1 has no evidence");
  });

  test("falls back to Object.values for a plain id-keyed requirements map", () => {
    const state = workflowState();
    (state as unknown as { requirements: unknown }).requirements = {
      "R-1": { id: "R-1", status: "planned", disposition: "actionable", evidence: [] },
    };
    expect(completionReadinessIssues(state)).toContain("requirement R-1 has no evidence");
  });
});

describe("completionReadinessIssues: repository binding validity", () => {
  test("flags a missing or invalid current repository binding", () => {
    const state = workflowState();
    delete state.current_repository_binding;
    expect(completionReadinessIssues(state)).toContain(
      "current repository binding is missing or invalid",
    );
  });
});

describe("completionReadinessIssues: transition summary chain (B21.2)", () => {
  test("refuses completion readiness when a collected branch has no recorded outcome summary", () => {
    const state = workflowState();
    (state as unknown as Record<string, unknown>)[BRANCH_LEDGER_KEY] = [
      branchRecord({ status: "collected" }),
    ];
    expect(completionReadinessIssues(state)).toContain(
      "branch B-1 is collected with no recorded outcome summary",
    );
  });
});

describe("completionReadinessIssues: validator command evidence must come from an authorized actor", () => {
  test("rejects code-quality validator evidence whose command was run by an unrelated actor", () => {
    const state = workflowState();
    Object.assign(state.tasks["T-1"]!, {
      status: "done",
      report: { summary: "done" },
      original_implementer: "impl-1",
      validations: [
        {
          validator_id: "validator-legit",
          domain: "code-quality",
          token_digest: "digest",
          attempt: 1,
          started_at: "2026-08-13T12:00:00.000Z",
          deadline_at: "2026-08-13T12:20:00.000Z",
          verdict: "pass",
          reviewed_requirement_ids: ["R-1"],
          checks: [{ command_id: "C-OUTSIDER" }],
        },
      ],
    });
    state.commands["C-OUTSIDER"] = commandRecord("C-OUTSIDER", {
      actor: "outsider-actor",
      gate_id: "G-1",
    });
    const issues = completionReadinessIssues(state);
    expect(issues).toContain("task T-1 has invalid validator command C-OUTSIDER");
  });
});

describe("completionReadinessIssues: paused (needs-authority) requirements", () => {
  test("reports a requirement still awaiting authority instead of treating it as unsatisfied", () => {
    const state = workflowState();
    state.requirements.push({
      id: "R-2",
      status: "planned",
      disposition: "needs_authority",
      evidence: [],
    });
    const issues = completionReadinessIssues(state);
    expect(issues).toContain("requirement R-2 still needs authority");
    expect(issues).not.toContain("requirement R-2 is not satisfied");
  });
});
