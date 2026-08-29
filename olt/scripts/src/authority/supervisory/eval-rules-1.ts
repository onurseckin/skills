import { normalizeRoleName, type UnifiedAgentModel } from "../manifest/index.ts";
import { computeScopeOverlaps } from "./protocols.ts";
import type {
  ActiveLeaseContext,
  PersonaViolation,
  SupervisoryReminderEvaluationContext,
} from "./types.ts";

export function evaluateRulesBatch1(
  role: string,
  tier: number,
  model: UnifiedAgentModel,
  context: SupervisoryReminderEvaluationContext,
  leases: readonly ActiveLeaseContext[],
  violations: PersonaViolation[],
  correctiveDirectives: string[],
): void {
  // 1. Invariant: Supervisor Zero-File-Edit Rule
  const modifiedFiles = [
    ...(context.fileModificationsOnSupervisoryThread ?? []),
    ...(context.recentActions
      ?.filter(
        (a) => a.action === "edit_file" || a.action === "write_file" || a.action === "delete_file",
      )
      .map((a) => a.targetFile ?? "unknown") ?? []),
  ];

  if (tier < 3 && modifiedFiles.length > 0) {
    violations.push({
      code: "SUPERVISOR_ZERO_FILE_EDIT_BREACH",
      rule: "Supervisory threads (Tier 0/1/2) must NEVER modify repository code directly.",
      severity: "critical",
      message: `Supervisory role ${role.toUpperCase()} directly modified ${modifiedFiles.length} file(s): ${modifiedFiles.slice(0, 3).join(", ")}.`,
      correctiveDirective:
        "**Resolution Path:**\n1. Stop all direct file modification attempts.\n2. Revert any uncommitted changes to repository files.\n3. Delegate code edits to Tier 3 Implementers via host native subagent dispatch.",
      evidence: { modifiedFiles },
    });
    correctiveDirectives.push(
      "**Resolution Path:**\n1. Revert any direct file edits made on the supervisory thread.\n2. Formulate a task prompt containing the required changes.\n3. Dispatch a Tier 3 Implementer subagent to execute the changes.",
    );
  }

  // 2. Invariant: Direct Task Execution on Supervisor
  const directExecutionAttempts = [
    ...(context.directExecutionAttempts ?? []),
    ...(context.recentActions
      ?.filter(
        (a) =>
          a.action === "claim_task" || a.action === "implement_task" || a.action === "repair_task",
      )
      .map((a) => a.action) ?? []),
  ];

  if (tier < 3 && directExecutionAttempts.length > 0) {
    violations.push({
      code: "SUPERVISOR_TASK_SELF_EXECUTION_BREACH",
      rule: "Supervisors must coordinate and delegate; they never claim or implement tasks.",
      severity: "critical",
      message: `${role.toUpperCase()} attempted self-implementation actions: ${directExecutionAttempts.join(", ")}.`,
      correctiveDirective:
        "**Resolution Path:**\n1. Abort the current self-implementation attempt.\n2. Release any self-claimed tasks using `task:release`.\n3. Dispatch dedicated Tier 3 workers to handle the implementation.",
      evidence: { directExecutionAttempts },
    });
    correctiveDirectives.push(
      "**Resolution Path:**\n1. Execute `task:release` to relinquish the self-claimed tasks.\n2. Reassign the tasks to appropriately scoped Tier 3 Implementers.",
    );
  }

  // 3. Invariant: Strict 4-Tier Spawning Hierarchy
  const crossTierSpawns = [
    ...(context.crossTierSpawns ?? []),
    ...(context.recentActions
      ?.filter((a) => {
        if (!a.spawnedRole) return false;
        const spawned = normalizeRoleName(a.spawnedRole);
        return !model.spawns.map(normalizeRoleName).includes(spawned);
      })
      .map((a) => a.spawnedRole!) ?? []),
  ];

  if (crossTierSpawns.length > 0) {
    violations.push({
      code: "CROSS_TIER_SPAWN_HIERARCHY_BREACH",
      rule: "Subagent spawning must strictly adhere to the 4-Tier hierarchy.",
      severity: "critical",
      message: `${role.toUpperCase()} (Tier ${tier}) attempted unauthorized spawns: ${crossTierSpawns.join(", ")}. Permitted: [${model.spawns.join(", ")}].`,
      correctiveDirective: `**Resolution Path:**\n1. Terminate the invalidly spawned subagent immediately.\n2. Review the permitted spawns for Tier ${tier}: [${model.spawns.join(", ")}].\n3. Re-route the spawning request through the proper tier channels.`,
      evidence: { crossTierSpawns, permittedSpawns: model.spawns },
    });
    correctiveDirectives.push(
      `**Resolution Path:**\n1. Ensure all unauthorized subagents are terminated.\n2. Dispatch only the permitted roles: [${model.spawns.join(", ")}].`,
    );
  }

  // 4. Invariant: Subordinate Write Scope Exclusivity
  const overlaps = computeScopeOverlaps(leases);
  if (overlaps.length > 0) {
    violations.push({
      code: "WRITE_SCOPE_COLLISION_BREACH",
      rule: "Concurrently active task leases must hold mutually exclusive write scopes.",
      severity: "high",
      message: `Detected ${overlaps.length} write scope overlap(s) among active leases: ${overlaps.map((o) => `${o.taskA} vs ${o.taskB}`).join(", ")}.`,
      correctiveDirective:
        "**Resolution Path:**\n1. Identify the overlapping write scopes among active tasks.\n2. Serialise tasks with identical file targets.\n3. Dispatch these tasks in successive waves to avoid write conflicts.",
      evidence: { overlaps },
    });
    correctiveDirectives.push(
      "**Resolution Path:**\n1. Review active task write scopes for collisions.\n2. Re-partition wave dispatches to ensure tasks touching the same files execute sequentially.",
    );
  }

  // 5. Invariant: Continuous Dispatch & Queue Headroom (1:1 Anti-Batching & P=W/S)
  const queue = context.queueState;
  if (
    tier === 2 &&
    queue &&
    queue.readyCount > 0 &&
    queue.runningCount === 0 &&
    queue.blockedCount === 0
  ) {
    violations.push({
      code: "QUEUE_IDLE_ANTI_BATCHING_NEGLECT",
      rule: "Coordinator must dispatch ready tasks continuously the instant capacity frees.",
      severity: "medium",
      message: `Execution queue has ${queue.readyCount} ready task(s), but 0 active workers are dispatched.`,
      correctiveDirective:
        "**Resolution Path:**\n1. Check the Work/Span concurrency headroom (P = W / S).\n2. Dispatch ready tasks immediately via `queue:wave` up to the calculated headroom capacity.",
      evidence: { queue },
    });
    correctiveDirectives.push(
      "**Resolution Path:**\n1. Analyze available worker concurrency limits.\n2. Execute `queue:wave` to dispatch ready tasks in parallel wave lanes.",
    );
  }
}
