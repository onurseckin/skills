import { CODE_EDIT_TOOLS, GRAPH_MUTATION_COMMANDS, VALIDATION_COMMANDS } from "./slice_16.ts";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { basename, dirname, join, resolve } from "node:path";
import {
  isCoordinatorRole,
  isCognitiveValidatorRole,
  isImplementerRole,
  isMechanicValidatorRole,
  isMindRole,
  isOrchestratorRole,
  isFullTestSuiteCommand,
  isValidatorRole,
  PROHIBITED_COGNITIVE_TOOLS,
  PROHIBITED_COGNITIVE_TOOL_CATEGORIES,
  roleToTier,
  type RoleBoundaryAction,
  type RoleBoundaryAuditResult,
  type RoleBoundaryViolation,
  type RoleBoundaryWatchdogOptions,
} from "./slice_17.ts";
import { HarnessError } from "../../../../core/errors/index.ts";

export class RoleBoundaryWatchdog {
  private readonly violations: RoleBoundaryViolation[] = [];
  private readonly options: RoleBoundaryWatchdogOptions;

  constructor(options: RoleBoundaryWatchdogOptions = {}) {
    this.options = options;
  }

  /**
   * Audits a single action in real time against all zero-tolerance boundary invariants.
   */
  public auditAction(action: RoleBoundaryAction): RoleBoundaryViolation | null {
    const tier = action.tier ?? roleToTier(action.role);
    const timestamp = action.timestamp ?? new Date().toISOString();

    // 1. Zero-Tolerance Invariant: 0 coordinator code writing
    const coordViolation = this.checkCoordinatorCodeWriting(action, tier, timestamp);
    if (coordViolation) {
      return this.handleViolation(coordViolation);
    }

    // 2. Zero-Tolerance Invariant: 0 orchestrator task implementation
    const orchViolation = this.checkOrchestratorTaskImplementation(action, tier, timestamp);
    if (orchViolation) {
      return this.handleViolation(orchViolation);
    }

    // 3. Zero-Tolerance Invariant: 0 unassigned test running
    const testViolation = this.checkUnassignedTestRunning(action, tier, timestamp);
    if (testViolation) {
      return this.handleViolation(testViolation);
    }

    // 4. Anti-Boundary Leak checks for Validators and Critics
    const antiLeakViolation = this.checkAntiBoundaryLeakAction(action, tier, timestamp);
    if (antiLeakViolation) {
      return this.handleViolation(antiLeakViolation);
    }

    // 5. Cognitive Validator Hard-Lock Interlock
    const hardlockViolation = this.checkCognitiveValidatorHardlockAction(action, tier, timestamp);
    if (hardlockViolation) {
      return this.handleViolation(hardlockViolation);
    }

    // 6. Spawning hierarchy checks
    const spawningViolation = this.checkSpawningHierarchyAction(action, tier, timestamp);
    if (spawningViolation) {
      return this.handleViolation(spawningViolation);
    }

    // 7. Forbidden commands checks
    const cmdViolation = this.checkForbiddenCommandsAction(action, tier, timestamp);
    if (cmdViolation) {
      return this.handleViolation(cmdViolation);
    }

    return null;
  }

  /**
   * Audits a batch of actions.
   */
  public auditActions(actions: readonly RoleBoundaryAction[]): RoleBoundaryAuditResult {
    const foundViolations: RoleBoundaryViolation[] = [];

    for (const action of actions) {
      const v = this.auditAction(action);
      if (v) {
        foundViolations.push(v);
      }
    }

    const valid = foundViolations.length === 0;
    const summary = valid
      ? `Clean: 0 role boundary violations across ${actions.length} audited actions.`
      : `Action required: ${foundViolations.length} role boundary violations detected across ${actions.length} audited actions.`;

    return {
      valid,
      violations: foundViolations,
      actionsAuditedCount: actions.length,
      summary,
    };
  }

  /**
   * Audits an entire capsule state snapshot (agents, commands, tasks, events).
   */
  public auditState(state: unknown): RoleBoundaryAuditResult {
    if (!isJsonObject(state)) {
      return {
        valid: true,
        violations: [],
        actionsAuditedCount: 0,
        summary: "Clean: 0 actions extracted from non-object state.",
      };
    }

    const actions: RoleBoundaryAction[] = [];
    const roleMap = new Map<string, string>();

    // 1. Extract agent roles and tool uses
    const rawAgents = Array.isArray(state.agents)
      ? state.agents
      : isJsonObject(state.agents)
        ? Object.values(state.agents)
        : [];

    for (const agent of rawAgents) {
      if (!isJsonObject(agent)) continue;
      const agentId = typeof agent.id === "string" ? agent.id : "";
      const role = typeof agent.role === "string" ? agent.role : "";
      if (agentId && role) {
        roleMap.set(agentId, role);
      }

      const parentAgentId = typeof agent.parent_agent_id === "string" ? agent.parent_agent_id : "";
      if (parentAgentId && role) {
        const parentRole = roleMap.get(parentAgentId) ?? "orchestrator";
        actions.push({
          agentId: parentAgentId,
          role: parentRole,
          actionType: "spawning",
          targetRole: role,
          targetTier: roleToTier(role),
        });
      }

      const toolsUsed = Array.isArray(agent.tools_used) ? agent.tools_used : [];
      for (const tool of toolsUsed) {
        if (!isJsonObject(tool)) continue;
        const toolName = typeof tool.name === "string" ? tool.name : "";
        const toolCategory = typeof tool.category === "string" ? tool.category : undefined;
        if (toolName) {
          actions.push({
            agentId,
            role,
            actionType: "tool_use",
            toolName,
            toolCategory,
          });
        }
      }
    }

    // 2. Extract commands
    const rawCommands = isJsonObject(state.commands) ? Object.values(state.commands) : [];
    for (const cmd of rawCommands) {
      if (!isJsonObject(cmd)) continue;
      const actor = typeof cmd.actor === "string" ? cmd.actor : "";
      const role = roleMap.get(actor) ?? (actor ? actor : "unknown");
      const argv = Array.isArray(cmd.argv)
        ? cmd.argv.filter((a): a is string => typeof a === "string")
        : [];
      const taskId = typeof cmd.task_id === "string" ? cmd.task_id : undefined;
      const tool = typeof cmd.tool === "string" ? cmd.tool : undefined;
      const toolCategory = typeof cmd.tool_category === "string" ? cmd.tool_category : undefined;

      actions.push({
        agentId: actor,
        role,
        actionType: "command_exec",
        argv,
        taskId,
        toolName: tool,
        toolCategory,
      });
    }

    // 3. Extract tasks and leases
    const rawTasks = isJsonObject(state.tasks) ? Object.values(state.tasks) : [];
    for (const task of rawTasks) {
      if (!isJsonObject(task)) continue;
      const taskId = typeof task.id === "string" ? task.id : "";
      const lease = isJsonObject(task.lease) ? task.lease : undefined;
      if (lease) {
        const leaseAgentId = typeof lease.agent_id === "string" ? lease.agent_id : "";
        const leaseRole =
          typeof lease.role === "string"
            ? lease.role
            : (roleMap.get(leaseAgentId) ?? "implementer");

        actions.push({
          agentId: leaseAgentId,
          role: leaseRole,
          actionType: "task_lease",
          taskId,
        });
      }
    }

    return this.auditActions(actions);
  }

  /**
   * Returns all recorded boundary violations.
   */
  public getViolations(): readonly RoleBoundaryViolation[] {
    return [...this.violations];
  }

  /**
   * Clears accumulated violations.
   */
  public clearViolations(): void {
    this.violations.length = 0;
  }

  /**
   * Formats a clean markdown report of detected boundary violations.
   */
  public formatViolationReport(options: { readonly compact?: boolean | undefined } = {}): string {
    const lines: string[] = [];
    const status = this.violations.length === 0 ? "🟢 ZERO VIOLATIONS" : "🔴 ACTION REQUIRED";
    lines.push("### 🛡️ Role-Boundary Watchdog Report");
    lines.push(`- **Status**: ${status}`);
    lines.push(`- **Total Violations**: ${this.violations.length}`);
    lines.push("");

    if (this.violations.length === 0) {
      lines.push(
        "✅ **Zero role boundary violations detected.** Real-time invariants (0 coordinator code writing, 0 orchestrator task implementations, 0 unassigned test running) are 100% preserved.",
      );
      return lines.join("\n").trim();
    }

    if (!options.compact) {
      lines.push("#### ⚠️ Violation Details");
      for (const v of this.violations) {
        lines.push(`##### [${v.severity}] ${v.title} (\`${v.id}\`)`);
        lines.push(`- **Agent**: \`${v.agentId}\` (Tier ${v.tier} \`${v.role}\`)`);
        lines.push(`- **Invariant**: \`${v.invariant}\` | **Type**: \`${v.violationType}\``);
        lines.push(`- **Observation**: ${v.observation}`);
        lines.push(`- **Remediation**: ${v.remediation}`);
        lines.push("");
      }
    }

    return lines.join("\n").trim();
  }

  // --- Private Verification Checkers ---

  private checkCoordinatorCodeWriting(
    action: RoleBoundaryAction,
    tier: number,
    timestamp: string,
  ): RoleBoundaryViolation | null {
    if (tier !== 2 && !isCoordinatorRole(action.role)) {
      return null;
    }

    const isEditTool =
      (action.toolName && CODE_EDIT_TOOLS.has(action.toolName)) ||
      action.toolCategory === "file-edit";

    const isDirectWrite = action.actionType === "file_write" || action.targetFile !== undefined;

    const hasEditArg = (action.argv ?? []).some(
      (arg) => CODE_EDIT_TOOLS.has(arg) || arg.startsWith("write:") || arg.startsWith("edit:"),
    );

    const isTaskLease = action.actionType === "task_lease";

    if (isEditTool || isDirectWrite || hasEditArg || isTaskLease) {
      const toolDetail = action.toolName ? `tool '${action.toolName}'` : "code modification";
      return {
        id: `VIOL-COORD-WRITE-${action.agentId}-${Date.now()}`,
        invariant: "0_coordinator_code_writing",
        violationType: "coordinator_code_writing",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 2,
        title: "Zero-Tolerance Violation: Coordinator Code Writing",
        observation: `Zero-Tolerance Invariant Breached (0 Coordinator Code Writing): Tier 2 Coordinator '${action.agentId}' attempted ${isTaskLease ? "to claim implementation task lease" : `${toolDetail} or direct file modification`}.`,
        remediation:
          "Coordinators must never write code, edit files, or hold implementation leases directly. Delegate all task implementation to Tier 3 Implementers via host subagent dispatch.",
        action,
        timestamp,
        evidence: {
          actionType: action.actionType,
          toolName: action.toolName,
          toolCategory: action.toolCategory,
          targetFile: action.targetFile,
          taskId: action.taskId,
          argv: action.argv,
        },
      };
    }

    return null;
  }

  private checkOrchestratorTaskImplementation(
    action: RoleBoundaryAction,
    tier: number,
    timestamp: string,
  ): RoleBoundaryViolation | null {
    if (tier !== 1 && !isOrchestratorRole(action.role)) {
      return null;
    }

    const isEditTool =
      (action.toolName && CODE_EDIT_TOOLS.has(action.toolName)) ||
      action.toolCategory === "file-edit" ||
      action.actionType === "file_write";

    const isTaskLeaseOrSubmit =
      action.actionType === "task_lease" || action.actionType === "task_submit";

    const hasDirectTaskId =
      action.actionType === "command_exec" &&
      Boolean(action.taskId) &&
      !action.argv?.some((a) => a.startsWith("mind:"));

    const hasGraphMutation =
      action.actionType === "graph_mutation" ||
      (action.argv ?? []).some((arg) => GRAPH_MUTATION_COMMANDS.has(arg));

    const hasClaimArg = (action.argv ?? []).some(
      (arg) => arg === "task:claim" || arg === "task:submit",
    );

    if (isEditTool || isTaskLeaseOrSubmit || hasDirectTaskId || hasGraphMutation || hasClaimArg) {
      return {
        id: `VIOL-ORCH-IMPL-${action.agentId}-${Date.now()}`,
        invariant: "0_orchestrator_task_implementation",
        violationType: "orchestrator_direct_implementation",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 1,
        title: "Zero-Tolerance Violation: Orchestrator Task Implementation",
        observation: `Zero-Tolerance Invariant Breached (0 Orchestrator Task Implementation): Tier 1 Orchestrator '${action.agentId}' attempted direct implementation work, task execution, or task-graph mutation.`,
        remediation:
          "Orchestrators must only orchestrate via CLI commands and manage rounds. All implementation tasks and graph mutations must be delegated to Tier 2 Coordinators and Tier 3 Implementers.",
        action,
        timestamp,
        evidence: {
          actionType: action.actionType,
          taskId: action.taskId,
          argv: action.argv,
          toolName: action.toolName,
        },
      };
    }

    return null;
  }

  private checkUnassignedTestRunning(
    action: RoleBoundaryAction,
    tier: number,
    timestamp: string,
  ): RoleBoundaryViolation | null {
    const isTestIntent =
      action.actionType === "test_run" ||
      (action.argv &&
        (isFullTestSuiteCommand(action.argv) ||
          action.argv.some(
            (arg) =>
              arg === "test" ||
              arg === "test:unit" ||
              arg.includes(".test.") ||
              arg.includes(".spec."),
          )));

    if (!isTestIntent) {
      return null;
    }

    const argv = action.argv ?? [];

    // A. Supervisory Agents (Tier 0 Mind, Tier 1 Orchestrator, Tier 2 Coordinator) running tests
    if (
      tier < 3 ||
      isMindRole(action.role) ||
      isOrchestratorRole(action.role) ||
      isCoordinatorRole(action.role)
    ) {
      return {
        id: `VIOL-TEST-SUPERVISOR-${action.agentId}-${Date.now()}`,
        invariant: "0_unassigned_test_running",
        violationType: "unassigned_test_running",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier,
        title: "Zero-Tolerance Violation: Supervisory Role Test Execution",
        observation: `Zero-Tolerance Invariant Breached (0 Unassigned Test Running): Supervisory agent '${action.agentId}' (Tier ${tier} ${action.role}) executed test command '${argv.join(" ")}'. Supervisory agents must not run tests.`,
        remediation:
          "Supervisors must coordinate task evidence without running test commands directly. Full test suites belong exclusively to Completeness Critics, and scoped tests belong to assigned Tier 3 Implementers.",
        action,
        timestamp,
        evidence: {
          argv: [...argv],
          tier,
        },
      };
    }

    // B. Tier 3 Implementers running full test suites
    if (isImplementerRole(action.role) && isFullTestSuiteCommand(argv)) {
      return {
        id: `VIOL-TEST-FULLSUITE-${action.agentId}-${Date.now()}`,
        invariant: "0_unassigned_test_running",
        violationType: "unassigned_test_running",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 3,
        title: "Zero-Tolerance Violation: Implementer Full Test Suite Execution",
        observation: `Zero-Tolerance Invariant Breached (0 Unassigned Test Running): Implementer '${action.agentId}' executed broad test suite command '${argv.join(" ")}'. Implementers may only run file-scoped unit tests.`,
        remediation:
          "Implementers must only execute targeted single-file unit tests matching their assigned write scope (e.g. `bun test tests/unit/mind/specific.test.ts`). Running full test suites is strictly reserved for Completeness Critics.",
        action,
        timestamp,
        evidence: {
          argv: [...argv],
        },
      };
    }

    // C. Tier 3 Implementers running unassigned test files
    if (
      isImplementerRole(action.role) &&
      action.assignedTestFiles &&
      action.assignedTestFiles.length > 0
    ) {
      const testArgs = argv.filter(
        (arg) =>
          !arg.startsWith("-") &&
          /(\.(test|spec)\.[cm]?[jt]sx?|([/_]test|^test)[^/]*\.py|_test\.py|_spec\.rb)$/i.test(arg),
      );

      for (const targetTest of testArgs) {
        const isAssigned = action.assignedTestFiles.some(
          (assigned) =>
            targetTest.includes(assigned) ||
            assigned.includes(targetTest) ||
            targetTest.endsWith(assigned) ||
            assigned.endsWith(targetTest),
        );

        if (!isAssigned) {
          return {
            id: `VIOL-TEST-UNASSIGNED-${action.agentId}-${Date.now()}`,
            invariant: "0_unassigned_test_running",
            violationType: "unassigned_test_running",
            severity: "HIGH",
            agentId: action.agentId,
            role: action.role,
            tier: 3,
            title: "Zero-Tolerance Violation: Implementer Unassigned Test Execution",
            observation: `Zero-Tolerance Invariant Breached (0 Unassigned Test Running): Implementer '${action.agentId}' ran unassigned test '${targetTest}'. Assigned tests: [${action.assignedTestFiles.join(", ")}].`,
            remediation:
              "Implementers may only execute test files specifically within their assigned write scope and task contract.",
            action,
            timestamp,
            evidence: {
              targetTest,
              assignedTestFiles: [...action.assignedTestFiles],
            },
          };
        }
      }
    }

    return null;
  }

  private checkAntiBoundaryLeakAction(
    action: RoleBoundaryAction,
    tier: number,
    timestamp: string,
  ): RoleBoundaryViolation | null {
    // 1. Validator write scope leaks
    if (isValidatorRole(action.role)) {
      const isWrite =
        action.actionType === "file_write" ||
        action.actionType === "task_lease" ||
        (action.toolName && CODE_EDIT_TOOLS.has(action.toolName)) ||
        action.toolCategory === "file-edit" ||
        action.targetFile !== undefined;

      if (isWrite) {
        return {
          id: `VIOL-LEAK-VALWRITE-${action.agentId}-${Date.now()}`,
          invariant: "anti_boundary_leak",
          violationType: "anti_boundary_leak",
          severity: "CRITICAL",
          agentId: action.agentId,
          role: action.role,
          tier: 3,
          title: "Anti-Boundary-Leak: Validator Write Attempt",
          observation: `Anti-Boundary-Leak Violation: Validator '${action.agentId}' attempted code modification or task lease acquisition. Validators must be strictly read-only.`,
          remediation:
            "Enforce Anti-Boundary-Leak invariant: Validators and Critics are strictly forbidden from modifying files or claiming write leases.",
          action,
          timestamp,
          evidence: {
            actionType: action.actionType,
            toolName: action.toolName,
            targetFile: action.targetFile,
          },
        };
      }
    }

    // 2. Implementer self-grading or validation command execution
    if (isImplementerRole(action.role)) {
      const valCmd = (action.argv ?? []).find((arg) => VALIDATION_COMMANDS.has(arg));
      if (valCmd) {
        return {
          id: `VIOL-LEAK-IMPLVAL-${action.agentId}-${Date.now()}`,
          invariant: "anti_boundary_leak",
          violationType: "anti_boundary_leak",
          severity: "CRITICAL",
          agentId: action.agentId,
          role: action.role,
          tier: 3,
          title: "Anti-Boundary-Leak: Implementer Self-Grading Command",
          observation: `Anti-Boundary-Leak Violation: Implementer '${action.agentId}' executed validation command '${valCmd}'. Implementers cannot evaluate or grade tasks.`,
          remediation:
            "Validation commands are exclusively reserved for independent Tier 3 Validators.",
          action,
          timestamp,
          evidence: {
            validationCommand: valCmd,
            argv: action.argv,
          },
        };
      }
    }

    return null;
  }

  private checkCognitiveValidatorHardlockAction(
    action: RoleBoundaryAction,
    tier: number,
    timestamp: string,
  ): RoleBoundaryViolation | null {
    if (!isCognitiveValidatorRole(action.role) || isMechanicValidatorRole(action.role)) {
      return null;
    }

    const argv = action.argv ?? [];
    const isRunExec = argv.includes("run:exec");
    const hasExecutionCategory =
      action.toolCategory !== undefined &&
      PROHIBITED_COGNITIVE_TOOL_CATEGORIES.has(action.toolCategory.toLowerCase().trim());
    const isProhibitedTool =
      action.toolName !== undefined &&
      (PROHIBITED_COGNITIVE_TOOLS.has(action.toolName.toLowerCase().trim()) ||
        PROHIBITED_COGNITIVE_TOOL_CATEGORIES.has(action.toolName.toLowerCase().trim()));
    const isTestRunAction = action.actionType === "test_run";
    const hasTestArg = argv.some((a) => {
      const lower = a.toLowerCase();
      return (
        lower === "run:exec" ||
        lower === "test" ||
        lower.startsWith("test:") ||
        lower.includes(".test.") ||
        lower.includes(".spec.") ||
        lower === "pytest" ||
        lower === "vitest" ||
        lower === "jest" ||
        lower === "cargo" ||
        lower === "npm" ||
        lower === "yarn" ||
        lower === "pnpm"
      );
    });

    if (isRunExec || hasExecutionCategory || isProhibitedTool || isTestRunAction || hasTestArg) {
      const detail = action.toolName ?? (argv.length > 0 ? argv.join(" ") : action.actionType);
      return {
        id: `VIOL-HARDLOCK-VAL-${action.agentId}-${Date.now()}`,
        invariant: "validator_hardlock",
        violationType: "validator_hardlock_violation",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 3,
        title: "Cognitive Validator Hard-Lock Interlock Violation",
        observation: `Cognitive Validator Hard-Lock Violation: Cognitive Validator/Critic '${action.agentId}' (${action.role}) attempted execution/test action '${detail}'. Cognitive Validators and Critics are strictly locked from running bash, shell commands, test runners, build tools, or package managers.`,
        remediation:
          "Cognitive Validators must evaluate deliverables strictly via read-only inspection and artifact review. Test execution authority belongs exclusively to Mechanic Validators (mechanic-validator / ui-mechanic-validator).",
        action,
        timestamp,
        evidence: {
          actionType: action.actionType,
          argv: action.argv,
          toolName: action.toolName,
          toolCategory: action.toolCategory,
        },
      };
    }

    return null;
  }

  private checkSpawningHierarchyAction(
    action: RoleBoundaryAction,
    tier: number,
    timestamp: string,
  ): RoleBoundaryViolation | null {
    if (action.actionType !== "spawning") {
      return null;
    }

    // Tier 3 Leaf spawning violation
    if (tier === 3 || isImplementerRole(action.role) || isValidatorRole(action.role)) {
      return {
        id: `VIOL-SPAWN-LEAF-${action.agentId}-${Date.now()}`,
        invariant: "spawning_hierarchy",
        violationType: "leaf_spawning",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 3,
        title: "Hierarchy Violation: Tier 3 Leaf Spawning Subagent",
        observation: `Tier 3 Leaf agent '${action.agentId}' (${action.role}) attempted to spawn child subagent '${action.targetRole ?? "unknown"}'. Tier 3 roles are leaf execution workers and cannot spawn subagents.`,
        remediation:
          "Clear spawns for Tier 3 workers. Subagent dispatch is strictly reserved for supervisory tiers.",
        action,
        timestamp,
        evidence: {
          targetRole: action.targetRole,
          targetTier: action.targetTier,
        },
      };
    }

    // Tier 0 Mind spawning non-orchestrator
    if (tier === 0 && action.targetRole && !isOrchestratorRole(action.targetRole)) {
      return {
        id: `VIOL-SPAWN-TIER0-${action.agentId}-${Date.now()}`,
        invariant: "spawning_hierarchy",
        violationType: "cross_tier_spawning",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 0,
        title: "Hierarchy Violation: Tier 0 Cross-Tier Spawning",
        observation: `Tier 0 Mind '${action.agentId}' directly dispatched non-orchestrator agent '${action.targetRole}'. Mind may only dispatch Tier 1 Orchestrators.`,
        remediation:
          "Enforce hierarchical spawning: Mind (Tier 0) -> Orchestrator (Tier 1) -> Coordinator (Tier 2) -> Implementer/Validator (Tier 3).",
        action,
        timestamp,
        evidence: {
          targetRole: action.targetRole,
        },
      };
    }

    // Tier 1 Orchestrator spawning non-coordinator
    if (tier === 1 && action.targetRole && !isCoordinatorRole(action.targetRole)) {
      return {
        id: `VIOL-SPAWN-TIER1-${action.agentId}-${Date.now()}`,
        invariant: "spawning_hierarchy",
        violationType: "cross_tier_spawning",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 1,
        title: "Hierarchy Violation: Tier 1 Cross-Tier Spawning",
        observation: `Tier 1 Orchestrator '${action.agentId}' directly dispatched non-coordinator agent '${action.targetRole}'. Orchestrators may only dispatch Tier 2 Coordinators.`,
        remediation:
          "Orchestrators cannot directly spawn Tier 3 workers. Orchestrator must dispatch Tier 2 Coordinator.",
        action,
        timestamp,
        evidence: {
          targetRole: action.targetRole,
        },
      };
    }

    // Tier 2 Coordinator spawning non-tier-3
    if (
      tier === 2 &&
      action.targetRole &&
      (isMindRole(action.targetRole) ||
        isOrchestratorRole(action.targetRole) ||
        isCoordinatorRole(action.targetRole) ||
        (action.targetTier !== undefined && action.targetTier < 3))
    ) {
      return {
        id: `VIOL-SPAWN-TIER2-${action.agentId}-${Date.now()}`,
        invariant: "spawning_hierarchy",
        violationType: "cross_tier_spawning",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 2,
        title: "Hierarchy Violation: Tier 2 Cross-Tier Spawning",
        observation: `Tier 2 Coordinator '${action.agentId}' attempted to dispatch non-Tier-3 agent '${action.targetRole}'. Coordinators may only dispatch Tier 3 workers (Implementers, Validators, Critics, Repairers).`,
        remediation:
          "Coordinators may only spawn Tier 3 task workers (Implementer, Validator, Critic, Repairer).",
        action,
        timestamp,
        evidence: {
          targetRole: action.targetRole,
          targetTier: action.targetTier,
        },
      };
    }

    return null;
  }

  private checkForbiddenCommandsAction(
    action: RoleBoundaryAction,
    tier: number,
    timestamp: string,
  ): RoleBoundaryViolation | null {
    const argv = action.argv ?? [];

    if (argv.includes("orchestrator:run")) {
      return {
        id: `VIOL-CMD-ORCHRUN-${action.agentId}-${Date.now()}`,
        invariant: "command_authorization",
        violationType: "forbidden_command_execution",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier,
        title: "Forbidden Command 'orchestrator:run' Execution Attempt",
        observation: `Agent '${action.agentId}' (${action.role}) attempted to execute strictly forbidden command 'orchestrator:run'.`,
        remediation: "Remove all invocations of 'orchestrator:run' across all tiers.",
        action,
        timestamp,
        evidence: {
          argv: [...argv],
        },
      };
    }

    if (tier < 3 && argv.includes("task:claim")) {
      return {
        id: `VIOL-CMD-SUPERCLAIM-${action.agentId}-${Date.now()}`,
        invariant: "command_authorization",
        violationType: "supervisory_task_claim",
        severity: "HIGH",
        agentId: action.agentId,
        role: action.role,
        tier,
        title: "Supervisory Task Claim Execution Attempt",
        observation: `Supervisory agent '${action.agentId}' (Tier ${tier} ${action.role}) attempted 'task:claim'. Supervisors must delegate task execution, not claim them.`,
        remediation:
          "Task claim commands are strictly reserved for Tier 3 Implementers holding active task leases.",
        action,
        timestamp,
        evidence: {
          argv: [...argv],
        },
      };
    }

    return null;
  }

  private handleViolation(violation: RoleBoundaryViolation): RoleBoundaryViolation {
    let defectEntry: DefectEntry | undefined = undefined;

    if (this.options.autoLogDefect) {
      if (this.options.defectLogger) {
        const res = this.options.defectLogger(violation);
        if (res) defectEntry = res;
      } else {
        defectEntry = logBoundaryViolationDefect(
          {
            agent_id: violation.agentId,
            role: violation.role,
            tier: violation.tier,
            violation_type: violation.violationType,
            invariant: violation.invariant,
            severity: violation.severity.toLowerCase(),
            observation: violation.observation,
            remediation: violation.remediation,
            evidence: violation.evidence,
          },
          {
            capsuleRoot: this.options.capsuleRoot,
          },
        );
      }
    }

    const completeViolation: RoleBoundaryViolation = {
      ...violation,
      ...(defectEntry !== undefined ? { defectEntry } : {}),
    };

    this.violations.push(completeViolation);
    this.options.onViolation?.(completeViolation);

    if (this.options.strictZeroTolerance) {
      throw new HarnessError("ROLE_CONFINEMENT_VIOLATION", completeViolation.observation);
    }

    return completeViolation;
  }
}