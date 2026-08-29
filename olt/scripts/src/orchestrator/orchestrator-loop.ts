/**
 * Orchestrator delegation and role confinement invariants.
 * Auto-pairs companion Skill Auditor alongside Tier 1 Orchestrator.
 */
import { HarnessError } from "../core/errors/index.ts";
import { OrchestratorCompanionAuditor } from "./companion-auditor.ts";
import type { CompanionPairingResult } from "./types.ts";

export class OrchestratorDelegation {
  /**
   * Delegates execution to a Tier 2 Coordinator and automatically pairs the companion Skill Auditor.
   */
  public delegateToCoordinator(
    repoRoot: string,
    taskId: string,
    coordinatorId: string = "coordinator-1",
  ): { coordinatorId: string; companionPairing: CompanionPairingResult } {
    return OrchestratorDelegation.delegateToCoordinator(repoRoot, taskId, coordinatorId);
  }

  /**
   * Static helper to delegate execution to a Tier 2 Coordinator and automatically pair the companion Skill Auditor.
   */
  public static delegateToCoordinator(
    repoRoot: string,
    taskId: string,
    coordinatorId: string = "coordinator-1",
  ): { coordinatorId: string; companionPairing: CompanionPairingResult } {
    // Hard-lock Orchestrator delegation to Tier 2 Coordinators
    // Enforcing the rule that Orchestrator never implements tasks or runs raw test suites directly.
    const companionPairing = OrchestratorCompanionAuditor.pairCompanion(repoRoot);
    return {
      coordinatorId,
      companionPairing,
    };
  }

  /**
   * Asserts that supervisory roles do not violate role boundaries by writing code or running raw tests.
   */
  public static assertRoleBoundaryCompliance(
    role: string,
    action: "code_edit" | "run_test_suite" | "delegate",
  ): void {
    let isSupervisor = false;
    if (role === "orchestrator") isSupervisor = true;
    else if (role === "coordinator") isSupervisor = true;

    let isRestrictedAction = false;
    if (action === "code_edit") isRestrictedAction = true;
    else if (action === "run_test_suite") isRestrictedAction = true;

    if (isSupervisor && isRestrictedAction) {
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        `Supervisor role '${role}' is mechanically confined from executing direct action '${action}'. Action must be delegated to Tier 3 Implementers/Validators.`,
      );
    }
  }
}

export function delegateToCoordinator(
  repoRoot: string,
  taskId: string,
  coordinatorId: string = "coordinator-1",
): { coordinatorId: string; companionPairing: CompanionPairingResult } {
  return OrchestratorDelegation.delegateToCoordinator(repoRoot, taskId, coordinatorId);
}

export function assertRoleBoundaryCompliance(
  role: string,
  action: "code_edit" | "run_test_suite" | "delegate",
): void {
  OrchestratorDelegation.assertRoleBoundaryCompliance(role, action);
}
