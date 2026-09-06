export const DEFECT_ID = "defect-cli-1788679572304-8r8a33";
export const ERROR_CODE = "INVALID_STATE";
export const IMPLEMENTER_CONTRACT_PATH =
  "/Users/onurseckinsenoglu/repos/skills/olt/agents/implementer.yaml";

export const IMPLEMENTER_ALLOWED_COMMANDS: readonly string[] = [
  "task:brief",
  "task:claim",
  "queue:pop",
  "task:check",
  "task:heartbeat",
  "run:exec",
  "task:submit",
  "task:release",
  "branch:open",
  "branch:collect",
  "branch:abandon",
  "finding:get",
  "report:get",
  "evidence:get",
  "agent:register",
  "agent:report",
  "agent:release",
  "doctor",
  "whoami",
  "msg:send",
  "msg:recv",
  "msg:poll",
];

export const IMPLEMENTER_GRANTED_COMMANDS = IMPLEMENTER_ALLOWED_COMMANDS;
export const TASK_ABANDON_AUTHORIZED_ROLES: readonly string[] = ["coordinator"];

export const DEFECT_MESSAGE = `role implementer may not invoke task:abandon: agent implementer_lifecycle holds a implementer grant, and the contract at ${IMPLEMENTER_CONTRACT_PATH} grants only ${IMPLEMENTER_ALLOWED_COMMANDS.join(", ")}. [Remediation: Ensure agent holds an authorized role for task:abandon or delegate the action to an authorized subagent via subagent dispatch.]`;

export interface ImplementerLifecycleEvaluation {
  readonly agentId: string;
  readonly role: string;
  readonly action: string;
  readonly allowed: boolean;
  readonly error?: string;
  readonly remediation?: string;
}

export interface Defect17886795723048r8a33Result {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly allowed: boolean;
  readonly errors: readonly string[];
  readonly evaluation: ImplementerLifecycleEvaluation;
}

export type DefectRemediationResult = Defect17886795723048r8a33Result;

export function formatImplementerAbandonError(
  agentId: string = "implementer_lifecycle",
  action: string = "task:abandon",
  role: string = "implementer",
): string {
  const resolvedAgent = agentId && agentId.length > 0 ? agentId : "implementer_lifecycle";
  const resolvedAction = action && action.length > 0 ? action : "task:abandon";
  const resolvedRole = role && role.length > 0 ? role : "implementer";
  return `role ${resolvedRole} may not invoke ${resolvedAction}: agent ${resolvedAgent} holds a ${resolvedRole} grant, and the contract at ${IMPLEMENTER_CONTRACT_PATH} grants only ${IMPLEMENTER_ALLOWED_COMMANDS.join(", ")}. [Remediation: Ensure agent holds an authorized role for ${resolvedAction} or delegate the action to an authorized subagent via subagent dispatch.]`;
}

export function formatRoleBoundaryError(
  agentId: string = "implementer_lifecycle",
  role: string = "implementer",
  command: string = "task:abandon",
  _contractPath: string = IMPLEMENTER_CONTRACT_PATH,
): string {
  return formatImplementerAbandonError(agentId, command, role);
}

export function isCommandGrantedToRole(role: string, command: string): boolean {
  if (role === "implementer") {
    return IMPLEMENTER_ALLOWED_COMMANDS.includes(command);
  }
  if (role === "coordinator") {
    if (command === "task:abandon") {
      return true;
    }
    return IMPLEMENTER_ALLOWED_COMMANDS.includes(command);
  }
  return false;
}

export function evaluateImplementerLifecycleAction(
  actionOrInput?: string | Partial<ImplementerLifecycleEvaluation>,
  agentId?: string,
  role?: string,
): ImplementerLifecycleEvaluation {
  let resolvedAction = "task:abandon";
  let resolvedAgentId = "implementer_lifecycle";
  let resolvedRole = "implementer";

  if (typeof actionOrInput === "object" && actionOrInput !== null) {
    if (actionOrInput.action) resolvedAction = actionOrInput.action;
    if (actionOrInput.agentId) resolvedAgentId = actionOrInput.agentId;
    if (actionOrInput.role) resolvedRole = actionOrInput.role;
  } else if (typeof actionOrInput === "string" && actionOrInput.length > 0) {
    resolvedAction = actionOrInput;
    if (agentId && agentId.length > 0) resolvedAgentId = agentId;
    if (role && role.length > 0) resolvedRole = role;
  }

  const isCoordinator = resolvedRole === "coordinator";
  const isAllowedCommand =
    resolvedRole === "implementer" && IMPLEMENTER_ALLOWED_COMMANDS.includes(resolvedAction);

  if (isCoordinator ? true : isAllowedCommand) {
    return {
      agentId: resolvedAgentId,
      role: resolvedRole,
      action: resolvedAction,
      allowed: true,
    };
  }

  const error = formatImplementerAbandonError(resolvedAgentId, resolvedAction, resolvedRole);
  const remediation = `Ensure agent holds an authorized role for ${resolvedAction} or delegate the action to an authorized subagent via subagent dispatch.`;

  return {
    agentId: resolvedAgentId,
    role: resolvedRole,
    action: resolvedAction,
    allowed: false,
    error,
    remediation,
  };
}

export function auditImplementerLifecycleBoundary(
  input?: string | Partial<ImplementerLifecycleEvaluation>,
): Defect17886795723048r8a33Result {
  const evaluation = evaluateImplementerLifecycleAction(input);
  const errors: string[] = [];
  if (!evaluation.allowed && evaluation.error) {
    errors.push(evaluation.error);
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    allowed: evaluation.allowed,
    errors,
    evaluation,
  };
}

export const auditImplementerTaskAbandonBoundary = auditImplementerLifecycleBoundary;
