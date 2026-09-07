import { HarnessError } from "../core/errors/index.ts";
import type { TaskRecord, WorkflowState } from "../workflow/types.ts";
import {
  evaluateHierarchicalDecision,
  type AgentRoleHierarchy,
  type HierarchicalDecisionResult,
} from "../engine/scheduler/index.ts";

export interface HierarchicalViolation {
  readonly ruleId: string;
  readonly taskId?: string | undefined;
  readonly agentId?: string | undefined;
  readonly role?: string | undefined;
  readonly reason: string;
}

export interface HierarchicalAuditReport {
  readonly compliant: boolean;
  readonly totalTasksChecked: number;
  readonly violations: readonly HierarchicalViolation[];
}

export function auditHierarchicalExecution(state: WorkflowState): HierarchicalAuditReport {
  const violations: HierarchicalViolation[] = [];
  const tasks = Object.values(state.tasks);

  for (const task of tasks) {
    // Check implementer independence from validator
    if (task.validations) {
      for (const val of task.validations) {
        if (val.validator_id === task.original_implementer) {
          violations.push({
            ruleId: "DOM-04-VALIDATOR-INDEPENDENCE",
            taskId: task.id,
            agentId: val.validator_id,
            role: "validator",
            reason: `Task ${task.id} has validation by original implementer ${task.original_implementer}`,
          });
        }
      }
    }

    // Check that changes_requested tasks have a repair assignee
    if (task.status === "changes_requested" && !task.repair_assignee) {
      violations.push({
        ruleId: "DOM-03-REPAIR-ASSIGNMENT-MISSING",
        taskId: task.id,
        reason: `Task ${task.id} is in changes_requested without a designated repair_assignee`,
      });
    }
  }

  return {
    compliant: violations.length === 0,
    totalTasksChecked: tasks.length,
    violations,
  };
}

export function validateTaskDispatchCompliance(
  task: TaskRecord,
  agentId: string,
  role: string,
  state?: WorkflowState,
): HierarchicalDecisionResult {
  const agentRole: AgentRoleHierarchy =
    role === "validator"
      ? "validator"
      : role === "coordinator" || role === "orchestrator"
        ? "coordinator"
        : role === "completeness-critic"
          ? "completeness-critic"
          : role === "plan-validator"
            ? "plan-validator"
            : "implementer";

  return evaluateHierarchicalDecision(
    {
      actor: agentId,
      role: agentRole,
      targetTaskId: task.id,
      writeScope: task.write_scope,
      isOriginalImplementer: task.original_implementer === agentId,
      repairRound: task.repair_round,
      state,
    },
    "claim_task",
  );
}
