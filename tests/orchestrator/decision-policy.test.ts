import { describe, expect, test } from "bun:test";
import {
  auditHierarchicalExecution,
  validateTaskDispatchCompliance,
} from "../../olt/scripts/src/orchestrator/decision-policy.ts";
import type { TaskRecord, WorkflowState } from "../../olt/scripts/src/workflow/types.ts";
import { workflowState } from "../workflow/test-port.ts";

describe("Orchestrator Decision Policy & Hierarchical Audit", () => {
  test("auditHierarchicalExecution passes on clean compliant state", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "ready";
    state.tasks["T-1"]!.original_implementer = "worker-1";

    const report = auditHierarchicalExecution(state);
    expect(report.compliant).toBeTrue();
    expect(report.violations.length).toBe(0);
  });

  test("auditHierarchicalExecution catches validator self-review violation", () => {
    const state = workflowState();
    state.tasks["T-1"]!.original_implementer = "worker-1";
    state.tasks["T-1"]!.validations = [
      {
        validator_id: "worker-1", // Self validation!
        domain: "code-quality",
        token_digest: "digest",
        attempt: 1,
        started_at: "2026-08-21T00:00:00Z",
        deadline_at: "2026-08-21T01:00:00Z",
      },
    ];

    const report = auditHierarchicalExecution(state);
    expect(report.compliant).toBeFalse();
    expect(report.violations.some((v) => v.ruleId === "DOM-04-VALIDATOR-INDEPENDENCE")).toBeTrue();
  });

  test("auditHierarchicalExecution catches changes_requested task without repair assignee", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "changes_requested";
    delete state.tasks["T-1"]!.repair_assignee;

    const report = auditHierarchicalExecution(state);
    expect(report.compliant).toBeFalse();
    expect(
      report.violations.some((v) => v.ruleId === "DOM-03-REPAIRER-ASSIGNMENT-MISSING"),
    ).toBeTrue();
  });

  test("auditHierarchicalExecution catches role mismatch on active lease", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "changes_requested";
    state.tasks["T-1"]!.repair_assignee = "worker-repairer-1";
    state.tasks["T-1"]!.lease = {
      agent_id: "worker-1",
      role: "implementer", // Must be repairer for changes_requested!
      attempt: 1,
      token_digest: "tok",
      issued_at: "2026-08-21T00:00:00Z",
      expires_at: "2026-08-21T01:00:00Z",
      heartbeat_at: "2026-08-21T00:00:00Z",
      duration_seconds: 3600,
      write_scope: ["src/file.ts"],
      resource_scope: [],
    };

    const report = auditHierarchicalExecution(state);
    expect(report.compliant).toBeFalse();
    expect(
      report.violations.some((v) => v.ruleId === "DOM-02-IMPLEMENTER-NOT-REPAIRER"),
    ).toBeTrue();
  });

  test("validateTaskDispatchCompliance verifies role matching at dispatch", () => {
    const state = workflowState();
    const readyTask = state.tasks["T-1"]!;
    readyTask.status = "ready";

    const allowed = validateTaskDispatchCompliance(readyTask, "worker-1", "implementer", state);
    expect(allowed.allowed).toBeTrue();

    readyTask.status = "changes_requested";
    const refused = validateTaskDispatchCompliance(readyTask, "worker-1", "implementer", state);
    expect(refused.allowed).toBeFalse();
    expect(refused.ruleId).toBe("DOM-02-IMPLEMENTER-NOT-REPAIRER");

    const repairAllowed = validateTaskDispatchCompliance(readyTask, "worker-1", "repairer", state);
    expect(repairAllowed.allowed).toBeTrue();
  });
});
