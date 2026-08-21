import { describe, expect, test } from "bun:test";
import { completionReadinessIssues } from "../../../../orchestrating-long-tasks/scripts/src/workflow/completion/readiness-issues.ts";
import { workflowState } from "../test-port.ts";

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
