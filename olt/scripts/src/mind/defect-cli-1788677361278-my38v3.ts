export const DEFECT_ID = "defect-cli-1788677361278-my38v3";
export const ERROR_CODE = "PERMISSION_DENIED";
export const DEFECT_TITLE =
  "Defect Remediation: role coordinator may not invoke run:exec: agent coordinator_wave1 holds a coordinator grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/coordinator.yaml grants only agent:brief, agent:define, agent:register, agent:release, agent:list, plan:init, plan:enhance, plan:add, plan:compile, plan:status, plan:brainstorm, plan:audit, task:brief, task:check, task:claim, task:submit, task:review, task:reject, task:probe, task:abandon, task:assign-repairer, critic:remediate, queue:wave, queue:list, finding:get, report:get, evidence:get, evidence:screenshots, meta-audit, memory:query, dag, doctor, whoami, msg:send, msg:recv, msg:poll, worktree:create, worktree:land, worktree:list, worktree:clean, worktree:status, worktree:reclaim. [Remediation: Ensure agent holds an authorized role for run:exec or delegate the action to an authorized subagent via subagent dispatch.]";

export const COORDINATOR_AUTHORIZED_COMMANDS: readonly string[] = [
  "agent:brief",
  "agent:define",
  "agent:register",
  "agent:release",
  "agent:list",
  "plan:init",
  "plan:enhance",
  "plan:add",
  "plan:compile",
  "plan:status",
  "plan:brainstorm",
  "plan:audit",
  "task:brief",
  "task:check",
  "task:claim",
  "task:submit",
  "task:review",
  "task:reject",
  "task:probe",
  "task:abandon",
  "task:assign-repairer",
  "critic:remediate",
  "queue:wave",
  "queue:list",
  "finding:get",
  "report:get",
  "evidence:get",
  "evidence:screenshots",
  "meta-audit",
  "memory:query",
  "dag",
  "doctor",
  "whoami",
  "msg:send",
  "msg:recv",
  "msg:poll",
  "worktree:create",
  "worktree:land",
  "worktree:list",
  "worktree:clean",
  "worktree:status",
  "worktree:reclaim",
];

export interface RolePermissionCheckContext {
  readonly role: string;
  readonly actor: string;
  readonly command: string;
}

export interface RolePermissionCheckResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly allowed: boolean;
  readonly errors: readonly string[];
}

export function auditCoordinatorCommandPermission(
  ctx: RolePermissionCheckContext,
): RolePermissionCheckResult {
  const errors: string[] = [];
  if (ctx.role === "coordinator" && !COORDINATOR_AUTHORIZED_COMMANDS.includes(ctx.command)) {
    errors.push(
      `role coordinator may not invoke ${ctx.command}: delegate the action to an authorized subagent via subagent dispatch.`,
    );
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    allowed: errors.length === 0,
    errors,
  };
}
