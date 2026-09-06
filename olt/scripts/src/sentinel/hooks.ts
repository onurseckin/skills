import { HarnessError } from "../core/errors/index.ts";
import type { PlanningDagGraphInput } from "../reporting/doctor/planning-dag-engine.ts";
import type { DoctorDiagnosticFinding } from "../reporting/doctor/types.ts";
import { inspectSourceFile } from "./ast-inspector.ts";
import {
  dispatchSentinelIntercept,
  isCriticalDoctorFinding,
  runFastDoctorChecks,
} from "./interceptor.ts";
import { dispatchSentinelInterjection } from "./mailbox-router.ts";
import { getProfileForRole } from "./profiles/index.ts";
import {
  determineStrikeAction,
  recordStrike,
  renderMarkdownRemediationBrief,
} from "./strike-ladder.ts";
import type {
  EvaluationContext,
  PostActionInput,
  PostActionResult,
  PreActionInput,
  PreActionResult,
  SentinelViolation,
  TurnEndInput,
  TurnEndResult,
} from "./types.ts";

export interface ExtendedPreActionInput extends PreActionInput {
  readonly state?: Readonly<Record<string, unknown>> | undefined;
  readonly tasks?: Readonly<Record<string, unknown>> | undefined;
  readonly graph?: PlanningDagGraphInput | undefined;
  readonly findings?: readonly DoctorDiagnosticFinding[] | undefined;
  readonly parent_supervisor?: string | undefined;
  readonly activeWorktreeCount?: number | undefined;
  readonly throw_on_block?: boolean | undefined;
}

export function executePreActionHook(input: ExtendedPreActionInput): PreActionResult {
  const doctorFindings = runFastDoctorChecks({
    ...(input.repo_root !== undefined ? { repoRoot: input.repo_root } : {}),
    ...(input.state !== undefined ? { state: input.state } : {}),
    ...(input.tasks !== undefined ? { tasks: input.tasks } : {}),
    ...(input.graph !== undefined ? { graph: input.graph } : {}),
    ...(input.findings !== undefined ? { findings: input.findings } : {}),
    role: input.role,
    agentId: input.agent_id,
    actionType: input.action_type,
    target: input.target,
    ...(input.activeWorktreeCount !== undefined
      ? { activeWorktreeCount: input.activeWorktreeCount }
      : {}),
  });

  const criticalFindings = doctorFindings.filter(isCriticalDoctorFinding);
  if (criticalFindings.length > 0) {
    const critical = criticalFindings[0]!;
    const blockerCode = critical.code;
    const blockerReason = critical.message;
    const remediation = "Resolve critical doctor diagnostic finding before proceeding.";

    dispatchSentinelIntercept({
      agentId: input.agent_id,
      role: input.role,
      actionType: input.action_type,
      target: input.target,
      ...(input.parent_supervisor !== undefined ? { supervisorId: input.parent_supervisor } : {}),
      blockerCode,
      blockerReason,
      remediation,
      findings: criticalFindings,
      ...(input.repo_root !== undefined ? { repoRoot: input.repo_root } : {}),
    });

    if (input.throw_on_block) {
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        `[SENTINEL_BLOCK] ${blockerReason}`,
        [],
        3,
        remediation,
      );
    }

    return {
      allowed: false,
      code: "ROLE_CONFINEMENT_VIOLATION",
      reason: blockerReason,
      remediation,
    };
  }

  const profile = getProfileForRole(input.role);

  if (input.action_type === "file_write") {
    if (!profile.can_edit) {
      return {
        allowed: false,
        code: "ROLE_BOUNDARY_DEVIATION",
        reason: `Role '${input.role}' does not hold file write privileges. Direct code mutation is prohibited.`,
        remediation: "Delegate implementation tasks to an authorized Implementer.",
      };
    }

    if (input.write_scope && input.write_scope.length > 0) {
      const target = input.target.trim();
      const inScope = input.write_scope.some(
        (scope) => target === scope || target.startsWith(scope.endsWith("/") ? scope : `${scope}/`),
      );
      if (!inScope) {
        return {
          allowed: false,
          code: "PATH_SAFETY_VIOLATION",
          reason: `Target file '${target}' falls outside the leased write scope: [${input.write_scope.join(", ")}].`,
          remediation: `Confine mutations to assigned write scope or request scope extension.`,
        };
      }
    }
  }

  if (input.action_type === "shell_command") {
    if (!profile.can_execute_shell) {
      return {
        allowed: false,
        code: "ROLE_BOUNDARY_DEVIATION",
        reason: `Role '${input.role}' is restricted from executing terminal commands.`,
        remediation: "Perform review or validation using read-only APIs.",
      };
    }

    const command = input.target.trim();
    if (
      command.startsWith("nohup ") ||
      command.includes(" disown") ||
      command.endsWith(" &") ||
      command.includes(" & ")
    ) {
      return {
        allowed: false,
        code: "ROGUE_PROCESS_ANCESTRY",
        reason: "Detached processes and unmonitored background subshells are strictly prohibited.",
        remediation: "Execute commands foreground synchronously within harness wrapper.",
      };
    }
  }

  return { allowed: true };
}

export function executePostActionHook(input: PostActionInput): PostActionResult {
  const violations: SentinelViolation[] = [];

  for (const filePath of input.modified_files) {
    const inspection = inspectSourceFile(filePath);
    violations.push(...inspection.violations);
  }

  return {
    allowed: violations.length === 0,
    violations,
  };
}

export function executeTurnEndHook(input: TurnEndInput): TurnEndResult {
  const profile = getProfileForRole(input.role);

  const evalContext: EvaluationContext = {
    agent_id: input.agent_id,
    role: input.role,
    task_id: input.task_id,
    run_root: input.run_root,
    repo_root: input.repo_root,
    write_scope: input.write_scope,
    modified_files: input.modified_files,
    executed_commands: input.executed_commands,
    reviewed_screenshots: input.reviewed_screenshots,
    probe_count: input.probe_count,
    action: input.action,
    child_agent_roles: input.child_agent_roles,
    spawned_agent_roles: input.spawned_agent_roles ?? input.spawned_roles,
    spawned_roles: input.spawned_roles,
    role_target: input.role_target,
  };

  const roleViolations = profile.evaluate(evalContext);
  const astViolations: SentinelViolation[] = [];
  if (input.modified_files && input.modified_files.length > 0) {
    for (const f of input.modified_files) {
      astViolations.push(...inspectSourceFile(f).violations);
    }
  }

  const allViolations = [...roleViolations, ...astViolations];
  const strikeRecord = recordStrike(
    input.agent_id,
    input.role,
    allViolations,
    input.task_id,
    input.repo_root,
  );
  const action = determineStrikeAction(strikeRecord.strike_count);

  if (allViolations.length === 0) {
    return {
      status: "HEALTHY",
      strike_count: 0,
      action_taken: "NONE",
      violations: [],
    };
  }

  const markdownBrief = renderMarkdownRemediationBrief(
    input.agent_id,
    input.role,
    strikeRecord.strike_count,
    allViolations,
  );

  let routingJourney;
  if (!input.dry_run) {
    const dispatch = dispatchSentinelInterjection({
      originSentinel: `sentinel:${input.agent_id}`,
      originRole: input.role,
      targetAgent: input.agent_id,
      targetRole: input.role,
      parentSupervisor: input.parent_supervisor,
      currentStrike: strikeRecord.strike_count,
      violations: allViolations,
      markdownBrief,
      repoRoot: input.repo_root,
    });
    routingJourney = dispatch.routingJourney;
  }

  return {
    status: "VIOLATION_DETECTED",
    strike_count: strikeRecord.strike_count,
    action_taken: action,
    violations: allViolations,
    routing_journey: routingJourney,
    markdown_brief: markdownBrief,
  };
}
