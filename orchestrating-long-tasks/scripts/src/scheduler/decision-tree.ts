import { HarnessError } from "../errors/harness-error.ts";
import type { TaskStatus, ValidatorDomain } from "../contracts/workflow.ts";
import type { TaskRecord, WorkflowState } from "../workflow/types.ts";

export type AgentRoleHierarchy =
  | "mind"
  | "coordinator"
  | "orchestrator"
  | "implementer"
  | "repairer"
  | "validator"
  | "plan-validator"
  | "completeness-critic";

export type HierarchicalAction =
  | "plan_compile"
  | "claim_task"
  | "submit_task"
  | "validate_start"
  | "record_review"
  | "record_probe"
  | "critic_start"
  | "critic_review"
  | "remediate"
  | "escalate"
  | "abandon_task"
  | "reclaim_lease"
  | "write_code";

export interface HierarchicalDecisionContext {
  readonly actor: string;
  readonly role: AgentRoleHierarchy;
  readonly targetTaskId?: string | undefined;
  readonly validatorDomain?: ValidatorDomain | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly isOriginalImplementer?: boolean | undefined;
  readonly repairRound?: number | undefined;
  readonly maxRepairRounds?: number | undefined;
  readonly state?: WorkflowState | undefined;
}

export interface HierarchicalDecisionResult {
  readonly allowed: boolean;
  readonly ruleId: string;
  readonly hierarchicalTier: number;
  readonly role: AgentRoleHierarchy;
  readonly action: HierarchicalAction;
  readonly reason: string;
  readonly nextPermittedActions: readonly HierarchicalAction[];
}

export const HIERARCHICAL_TIERS: Readonly<Record<AgentRoleHierarchy, number>> = {
  "mind": 0,
  "coordinator": 1,
  "orchestrator": 1,
  "implementer": 2,
  "repairer": 2,
  "validator": 3,
  "plan-validator": 3,
  "completeness-critic": 4,
};

export function evaluateHierarchicalDecision(
  context: HierarchicalDecisionContext,
  action: HierarchicalAction,
): HierarchicalDecisionResult {
  const { role, actor, targetTaskId, state } = context;
  const tier = HIERARCHICAL_TIERS[role] ?? 99;

  // Rule D1: Coordinators/Orchestrators cannot write code directly (role boundary isolation)
  if ((role === "coordinator" || role === "orchestrator") && action === "write_code") {
    return {
      allowed: false,
      ruleId: "DOM-01-COORDINATOR-NO-CODE",
      hierarchicalTier: tier,
      role,
      action,
      reason: "Coordinators and Orchestrators are prohibited from writing code directly; work must be dispatched to implementers or repairers",
      nextPermittedActions: ["plan_compile", "claim_task", "reclaim_lease", "escalate", "abandon_task"],
    };
  }

  // Rule D2: Implementers cannot claim a task in changes_requested directly (must claim as repairer)
  if (role === "implementer" && action === "claim_task") {
    if (targetTaskId && state) {
      const task = state.tasks[targetTaskId];
      if (task && task.status === "changes_requested") {
        return {
          allowed: false,
          ruleId: "DOM-02-IMPLEMENTER-NOT-REPAIRER",
          hierarchicalTier: tier,
          role,
          action,
          reason: `Task ${targetTaskId} is in changes_requested and requires a repairer role to claim`,
          nextPermittedActions: ["claim_task"],
        };
      }
    }
  }

  // Rule D3: Repairers can only claim tasks in changes_requested
  if (role === "repairer" && action === "claim_task") {
    if (targetTaskId && state) {
      const task = state.tasks[targetTaskId];
      if (task && task.status !== "changes_requested") {
        return {
          allowed: false,
          ruleId: "DOM-03-REPAIRER-REQUIRES-CHANGES-REQUESTED",
          hierarchicalTier: tier,
          role,
          action,
          reason: `Task ${targetTaskId} is ${task.status}, not changes_requested`,
          nextPermittedActions: [],
        };
      }
    }
  }

  // Rule D4: Validators cannot review tasks they personally implemented (independence)
  if (role === "validator" && (action === "validate_start" || action === "record_review" || action === "record_probe")) {
    if (targetTaskId && state) {
      const task = state.tasks[targetTaskId];
      if (task && (task.original_implementer === actor || task.repair_assignee === actor)) {
        return {
          allowed: false,
          ruleId: "DOM-04-VALIDATOR-INDEPENDENCE",
          hierarchicalTier: tier,
          role,
          action,
          reason: `Validator ${actor} implemented task ${targetTaskId} and cannot validate their own work`,
          nextPermittedActions: [],
        };
      }
    }
  }

  // Rule D5: Completeness critic cannot review while implementers are still active or task is not done/validated
  if (role === "completeness-critic" && (action === "critic_start" || action === "critic_review")) {
    if (state) {
      const activeTasks = Object.values(state.tasks).filter(
        (t) => t.status === "running" || t.status === "validating" || t.status === "changes_requested",
      );
      if (activeTasks.length > 0) {
        return {
          allowed: false,
          ruleId: "DOM-05-CRITIC-PREMATURE-START",
          hierarchicalTier: tier,
          role,
          action,
          reason: `Completeness critic cannot proceed while ${activeTasks.length} tasks are still active or in repair`,
          nextPermittedActions: [],
        };
      }
    }
  }

  // Rule D6: Implementers/Repairers cannot record validation reviews or completeness reviews
  if ((role === "implementer" || role === "repairer") && (action === "record_review" || action === "critic_review")) {
    return {
      allowed: false,
      ruleId: "DOM-06-WORKER-NO-SELF-REVIEW",
      hierarchicalTier: tier,
      role,
      action,
      reason: "Implementers and Repairers cannot perform validation reviews or completeness reviews",
      nextPermittedActions: ["submit_task"],
    };
  }

  // Permitted mapping
  const permittedActionsMap: Record<AgentRoleHierarchy, HierarchicalAction[]> = {
    "mind": ["plan_compile", "escalate"],
    "coordinator": ["plan_compile", "escalate", "abandon_task", "reclaim_lease"],
    "orchestrator": ["plan_compile", "escalate", "abandon_task", "reclaim_lease"],
    "implementer": ["claim_task", "submit_task", "write_code"],
    "repairer": ["claim_task", "submit_task", "write_code"],
    "validator": ["validate_start", "record_review", "record_probe"],
    "plan-validator": ["validate_start", "record_review"],
    "completeness-critic": ["critic_start", "critic_review"],
  };

  const permitted = permittedActionsMap[role] ?? [];
  const allowed = permitted.includes(action);

  return {
    allowed,
    ruleId: allowed ? "DOM-00-PERMITTED" : "DOM-99-ROLE-ACTION-MISMATCH",
    hierarchicalTier: tier,
    role,
    action,
    reason: allowed
      ? `Action ${action} is permitted for role ${role} at Tier ${tier}`
      : `Action ${action} is not in the authoritative action set for role ${role}`,
    nextPermittedActions: permitted,
  };
}

export function assertHierarchicalCompliance(
  context: HierarchicalDecisionContext,
  action: HierarchicalAction,
): void {
  const result = evaluateHierarchicalDecision(context, action);
  if (!result.allowed) {
    throw new HarnessError(
      "INVALID_STATE",
      `Hierarchical decision tree violation [${result.ruleId}]: ${result.reason}`,
    );
  }
}
