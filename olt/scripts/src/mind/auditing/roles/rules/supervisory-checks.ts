import { CODE_EDIT_TOOLS, GRAPH_MUTATION_COMMANDS, VALIDATION_COMMANDS } from "./hierarchy.ts";
import {
  isCoordinatorRole,
  isMindRole,
  isOrchestratorRole,
  isImplementerRole,
  isFullTestSuiteCommand,
  type RoleBoundaryAction,
  type RoleBoundaryViolation,
} from "./matrix.ts";

export function checkCoordinator(
  action: RoleBoundaryAction,
  tier: number,
  timestamp: string,
): RoleBoundaryViolation | null {
  if (tier !== 2 && !isCoordinatorRole(action.role)) return null;
  const tool = (action.toolName ?? "").toLowerCase();
  const isEdit =
    CODE_EDIT_TOOLS.has(tool) ||
    tool.includes("replace") ||
    tool.includes("edit") ||
    tool.includes("write");

  if (action.actionType === "task_lease") {
    return {
      id: `VIOL-COORD-LEASE-${action.agentId}-${Date.now()}`,
      invariant: "0_coordinator_code_writing",
      violationType: "coordinator_task_lease",
      severity: "CRITICAL",
      agentId: action.agentId,
      role: action.role,
      tier: 2,
      title: "Coordinator Task Lease Violation",
      observation: `Coordinator '${action.agentId}' directly leased task '${action.taskId}'.`,
      remediation: "Coordinators must delegate task leases to Tier 3 Implementers.",
      action,
      timestamp,
    };
  }
  if (action.actionType === "file_write" || (action.actionType === "tool_use" && isEdit)) {
    return {
      id: `VIOL-COORD-WRITE-${action.agentId}-${Date.now()}`,
      invariant: "0_coordinator_code_writing",
      violationType: "coordinator_code_writing",
      severity: "CRITICAL",
      agentId: action.agentId,
      role: action.role,
      tier: 2,
      title: "Coordinator Code Writing Violation",
      observation: `Coordinator '${action.agentId}' attempted code write '${tool || action.targetFile}'.`,
      remediation: "Coordinators must delegate code edits to Tier 3 Implementers.",
      action,
      timestamp,
    };
  }
  return null;
}

export function checkOrchestrator(
  action: RoleBoundaryAction,
  tier: number,
  timestamp: string,
): RoleBoundaryViolation | null {
  if (tier !== 1 && !isOrchestratorRole(action.role)) return null;
  const argv = action.argv ?? [];
  if (action.actionType === "graph_mutation" || argv.some((a) => GRAPH_MUTATION_COMMANDS.has(a))) {
    return {
      id: `VIOL-ORCH-GRAPH-${action.agentId}-${Date.now()}`,
      invariant: "0_orchestrator_task_implementation",
      violationType: "orchestrator_graph_mutation",
      severity: "CRITICAL",
      agentId: action.agentId,
      role: action.role,
      tier: 1,
      title: "Orchestrator Graph Mutation Violation",
      observation: `Orchestrator '${action.agentId}' mutated topological graph directly.`,
      remediation: "Topological graph mutations belong to Coordinator wave scheduling.",
      action,
      timestamp,
    };
  }
  if (
    (action.actionType === "command_exec" && argv.includes("task:claim")) ||
    action.actionType === "task_execution"
  ) {
    return {
      id: `VIOL-ORCH-IMPL-${action.agentId}-${Date.now()}`,
      invariant: "0_orchestrator_task_implementation",
      violationType: "orchestrator_task_implementation",
      severity: "CRITICAL",
      agentId: action.agentId,
      role: action.role,
      tier: 1,
      title: "Orchestrator Task Implementation Violation",
      observation: `Orchestrator '${action.agentId}' attempted task execution.`,
      remediation: "Orchestrators supervise execution and must not claim tasks.",
      action,
      timestamp,
    };
  }
  return null;
}

export function checkTestRunning(
  action: RoleBoundaryAction,
  tier: number,
  timestamp: string,
): RoleBoundaryViolation | null {
  const argv = action.argv ?? [];
  const isTest =
    action.actionType === "test_run" ||
    action.actionType === "test_execution" ||
    (action.toolName === "run_command" && argv.some((a) => a.includes("test")));
  if (!isTest) return null;

  if (
    tier < 3 ||
    isMindRole(action.role) ||
    isOrchestratorRole(action.role) ||
    isCoordinatorRole(action.role)
  ) {
    return {
      id: `VIOL-TEST-SUPERVISOR-${action.agentId}-${Date.now()}`,
      invariant: "0_unassigned_test_running",
      violationType: "supervisory_test_execution",
      severity: "CRITICAL",
      agentId: action.agentId,
      role: action.role,
      tier,
      title: "Supervisory Test Execution Violation",
      observation: `Supervisory agent '${action.agentId}' executed test command '${argv.join(" ")}'.`,
      remediation: "Supervisors must not run test suites.",
      action,
      timestamp,
    };
  }

  if (isImplementerRole(action.role)) {
    if (isFullTestSuiteCommand(argv)) {
      return {
        id: `VIOL-TEST-FULLSUITE-${action.agentId}-${Date.now()}`,
        invariant: "0_unassigned_test_running",
        violationType: "unassigned_test_running",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 3,
        title: "Implementer Full Test Suite Execution",
        observation: `Implementer '${action.agentId}' executed broad test suite '${argv.join(" ")}'.`,
        remediation:
          "Implementers must execute only targeted unit tests matching assigned write scope.",
        action,
        timestamp,
      };
    }
    if (action.assignedTestFiles && action.assignedTestFiles.length > 0) {
      const testArgs = argv.filter((a) => a.endsWith(".test.ts") || a.endsWith(".spec.ts"));
      const hasUnassigned = testArgs.some(
        (t) =>
          !action.assignedTestFiles!.some(
            (assigned) => t.includes(assigned) || assigned.includes(t),
          ),
      );
      if (hasUnassigned) {
        return {
          id: `VIOL-TEST-UNASSIGNED-${action.agentId}-${Date.now()}`,
          invariant: "0_unassigned_test_running",
          violationType: "unassigned_test_running",
          severity: "HIGH",
          agentId: action.agentId,
          role: action.role,
          tier: 3,
          title: "Implementer Unassigned Test Execution",
          observation: `Implementer '${action.agentId}' executed unassigned test.`,
          remediation: "Run only assigned test files.",
          action,
          timestamp,
        };
      }
    }
  }
  return null;
}
