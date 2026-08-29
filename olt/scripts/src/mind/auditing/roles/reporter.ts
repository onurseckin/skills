import { CODE_EDIT_TOOLS, GRAPH_MUTATION_COMMANDS, VALIDATION_COMMANDS } from "./rules/index.ts";
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
} from "./rules/index.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import {
  checkCoordinator,
  checkOrchestrator,
  checkTestRunning,
  checkAntiBoundaryLeak,
  checkValidatorHardLock,
  checkSpawning,
  checkForbidden,
} from "./rules/index.ts";
import { logBoundaryViolationDefect, type DefectEntry } from "../../defects/index.ts";

export class RoleBoundaryWatchdog {
  private readonly violations: RoleBoundaryViolation[] = [];
  private readonly options: RoleBoundaryWatchdogOptions;

  constructor(options: RoleBoundaryWatchdogOptions = {}) {
    this.options = options;
  }

  public auditAction(action: RoleBoundaryAction): RoleBoundaryViolation | null {
    const tier = action.tier ?? roleToTier(action.role);
    const timestamp = action.timestamp ?? new Date().toISOString();

    // 1. Coordinator code writing / task lease
    const coordViolation = this.checkCoordinator(action, tier, timestamp);
    if (coordViolation) return this.handleViolation(coordViolation);

    // 2. Orchestrator task implementation / graph mutation
    const orchViolation = this.checkOrchestrator(action, tier, timestamp);
    if (orchViolation) return this.handleViolation(orchViolation);

    // 3. Unassigned test running
    const testViolation = this.checkTestRunning(action, tier, timestamp);
    if (testViolation) return this.handleViolation(testViolation);

    // 4. Anti-boundary leak
    const leakViolation = this.checkAntiBoundaryLeak(action, tier, timestamp);
    if (leakViolation) return this.handleViolation(leakViolation);

    // 5. Validator hardlock
    const valViolation = this.checkValidatorHardLock(action, tier, timestamp);
    if (valViolation) return this.handleViolation(valViolation);

    // 6. Spawning hierarchy
    const spawnViolation = this.checkSpawning(action, tier, timestamp);
    if (spawnViolation) return this.handleViolation(spawnViolation);

    // 7. Forbidden commands
    const cmdViolation = this.checkForbidden(action, tier, timestamp);
    if (cmdViolation) return this.handleViolation(cmdViolation);

    return null;
  }

  public auditActions(actions: readonly RoleBoundaryAction[]): RoleBoundaryAuditResult {
    const violations: RoleBoundaryViolation[] = [];
    for (const action of actions) {
      const v = this.auditAction(action);
      if (v) violations.push(v);
    }
    return {
      valid: violations.length === 0,
      totalActions: actions.length,
      actionsAuditedCount: actions.length,
      violationsCount: violations.length,
      clean: violations.length === 0,
      violations,
    };
  }

  public auditState(state: Record<string, unknown>): RoleBoundaryAuditResult {
    const actions: RoleBoundaryAction[] = [];
    if (!state || typeof state !== "object") return this.auditActions([]);
    const agents = Array.isArray(state["agents"]) ? state["agents"] : [];
    for (const a of agents) {
      if (typeof a === "object" && a !== null) {
        const ag = a as Record<string, unknown>;
        const role = String(ag["role"] ?? ag["name"] ?? "");
        const agentId = String(ag["id"] ?? ag["agent_id"] ?? role);
        if (ag["current_task_id"] && (isCoordinatorRole(role) || isOrchestratorRole(role))) {
          actions.push({
            agentId,
            role,
            actionType: "task_lease",
            taskId: String(ag["current_task_id"]),
          });
        }
      }
    }
    return this.auditActions(actions);
  }

  public getViolations(): readonly RoleBoundaryViolation[] {
    return [...this.violations];
  }

  public clearViolations(): void {
    this.violations.length = 0;
  }

  public formatViolationReport(): string {
    if (this.violations.length === 0)
      return "✅ ZERO VIOLATIONS - All actions strictly adhered to role boundaries.";
    const lines = [`### ⚠️ Role Boundary Violations (${this.violations.length}) - ACTION REQUIRED`];
    for (const v of this.violations) {
      lines.push(`- **[${v.severity}] ${v.title}**: ${v.observation}`);
    }
    return lines.join("\n");
  }

  private checkCoordinator(a: RoleBoundaryAction, t: number, ts: string) {
    return checkCoordinator(a, t, ts);
  }
  private checkOrchestrator(a: RoleBoundaryAction, t: number, ts: string) {
    return checkOrchestrator(a, t, ts);
  }
  private checkTestRunning(a: RoleBoundaryAction, t: number, ts: string) {
    return checkTestRunning(a, t, ts);
  }
  private checkAntiBoundaryLeak(a: RoleBoundaryAction, t: number, ts: string) {
    return checkAntiBoundaryLeak(a, t, ts);
  }
  private checkValidatorHardLock(a: RoleBoundaryAction, t: number, ts: string) {
    return checkValidatorHardLock(a, t, ts);
  }
  private checkSpawning(a: RoleBoundaryAction, t: number, ts: string) {
    return checkSpawning(a, t, ts);
  }
  private checkForbidden(a: RoleBoundaryAction, t: number, ts: string) {
    return checkForbidden(a, t, ts);
  }

  private handleViolation(violation: RoleBoundaryViolation): RoleBoundaryViolation {
    let defectEntry: DefectEntry | undefined = undefined;
    if (this.options.autoLogDefect) {
      if (this.options.defectLogger) {
        const res = this.options.defectLogger(violation);
        if (res) defectEntry = res;
      } else {
        defectEntry = logBoundaryViolationDefect({
          agent_id: violation.agentId,
          role: violation.role,
          violation_type: violation.violationType,
          observation: violation.observation,
          remediation: violation.remediation,
          timestamp: violation.timestamp,
        });
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
