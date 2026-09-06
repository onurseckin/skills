export const DEFECT_ID = "defect-cli-1788679595404-156ubw";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE =
  "role implementer may not invoke task:abandon: agent implementer_guard holds a implementer grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/implementer.yaml grants only task:brief, task:claim, queue:pop, task:check, task:heartbeat, run:exec, task:submit, task:release, branch:open, branch:collect, branch:abandon, finding:get, report:get, evidence:get, agent:register, agent:report, agent:release, doctor, whoami, msg:send, msg:recv, msg:poll. [Remediation: Ensure agent holds an authorized role for task:abandon or delegate the action to an authorized subagent via subagent dispatch.]";

export const AUTHORIZED_ROLES_FOR_TASK_ABANDON: readonly string[] = Object.freeze(["coordinator"]);

export const IMPLEMENTER_COMMANDS: readonly string[] = Object.freeze([
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
]);

export interface ImplementerYamlContract {
  readonly path: string;
  readonly role: string;
  readonly commands: readonly string[];
  toString(): string;
  valueOf(): string;
}

class ImplementerContractRecord extends String implements ImplementerYamlContract {
  readonly path: string = "/Users/onurseckinsenoglu/repos/skills/olt/agents/implementer.yaml";
  readonly role: string = "implementer";
  readonly commands: readonly string[] = IMPLEMENTER_COMMANDS;

  constructor() {
    super("/Users/onurseckinsenoglu/repos/skills/olt/agents/implementer.yaml");
  }
  override toString(): string {
    return this.path;
  }
  override valueOf(): string {
    return this.path;
  }
}

export const IMPLEMENTER_YAML_CONTRACT: ImplementerYamlContract = new ImplementerContractRecord();

export interface FormatImplementerGuardErrorOptions {
  readonly role?: string;
  readonly command?: string;
  readonly agentId?: string;
  readonly contractPath?: string;
  readonly grantedCommands?: readonly string[];
  readonly dispatchTool?: string;
}

export function formatImplementerGuardError(
  optionsOrAgentId?: string | FormatImplementerGuardErrorOptions,
  maybeCommand?: string,
  maybeRole?: string,
): string {
  let role = "implementer";
  let command = "task:abandon";
  let agentId = "implementer_guard";
  let contractPath = IMPLEMENTER_YAML_CONTRACT.path;
  let grantedCommands = IMPLEMENTER_YAML_CONTRACT.commands;
  let dispatchTool = "subagent dispatch";

  if (typeof optionsOrAgentId === "string") {
    if (maybeCommand !== undefined && maybeRole !== undefined) {
      if (optionsOrAgentId === "implementer" && maybeRole.includes("guard")) {
        role = optionsOrAgentId;
        command = maybeCommand;
        agentId = maybeRole;
      } else {
        agentId = optionsOrAgentId;
        command = maybeCommand;
        role = maybeRole;
      }
    } else if (maybeCommand !== undefined) {
      if (optionsOrAgentId === "implementer") {
        role = optionsOrAgentId;
        command = maybeCommand;
      } else if (optionsOrAgentId === "coordinator") {
        role = optionsOrAgentId;
        command = maybeCommand;
      } else {
        agentId = optionsOrAgentId;
        command = maybeCommand;
      }
    } else {
      if (optionsOrAgentId.includes("guard")) {
        agentId = optionsOrAgentId;
      } else if (optionsOrAgentId.startsWith("implementer_")) {
        agentId = optionsOrAgentId;
      } else {
        role = optionsOrAgentId;
      }
    }
  } else if (optionsOrAgentId && typeof optionsOrAgentId === "object") {
    if (optionsOrAgentId.role !== undefined) role = optionsOrAgentId.role;
    if (optionsOrAgentId.command !== undefined) command = optionsOrAgentId.command;
    if (optionsOrAgentId.agentId !== undefined) agentId = optionsOrAgentId.agentId;
    if (optionsOrAgentId.contractPath !== undefined) contractPath = optionsOrAgentId.contractPath;
    if (optionsOrAgentId.grantedCommands !== undefined)
      grantedCommands = optionsOrAgentId.grantedCommands;
    if (optionsOrAgentId.dispatchTool !== undefined) dispatchTool = optionsOrAgentId.dispatchTool;
  }

  return `role ${role} may not invoke ${command}: agent ${agentId} holds a ${role} grant, and the contract at ${contractPath} grants only ${grantedCommands.join(", ")}. [Remediation: Ensure agent holds an authorized role for ${command} or delegate the action to an authorized subagent via ${dispatchTool}.]`;
}

export interface RoleBoundaryGuardVerdict {
  readonly allowed: boolean;
  readonly role: string;
  readonly command: string;
  readonly agentId?: string;
  readonly errorCode?: string;
  readonly error?: string;
  readonly remediation?: string;
  readonly authorizedRoles?: readonly string[];
  readonly contractPath?: string;
}

export interface RoleBoundaryGuardOptions {
  readonly role?: string;
  readonly command?: string;
  readonly agentId?: string;
  readonly contractPath?: string;
  readonly authorizedRoles?: readonly string[];
}

export function guardRoleTaskBoundary(
  optionsOrRole?: string | RoleBoundaryGuardOptions,
  maybeCommand?: string,
  maybeAgentId?: string,
): RoleBoundaryGuardVerdict {
  let role = "implementer";
  let command = "task:abandon";
  let agentId: string | undefined = "implementer_guard";
  let contractPath = IMPLEMENTER_YAML_CONTRACT.path;
  let authorizedRoles = AUTHORIZED_ROLES_FOR_TASK_ABANDON;

  if (typeof optionsOrRole === "string") {
    role = optionsOrRole;
    if (maybeCommand !== undefined) command = maybeCommand;
    if (maybeAgentId !== undefined) agentId = maybeAgentId;
  } else if (optionsOrRole && typeof optionsOrRole === "object") {
    if (optionsOrRole.role !== undefined) role = optionsOrRole.role;
    if (optionsOrRole.command !== undefined) command = optionsOrRole.command;
    if (optionsOrRole.agentId !== undefined) agentId = optionsOrRole.agentId;
    if (optionsOrRole.contractPath !== undefined) contractPath = optionsOrRole.contractPath;
    if (optionsOrRole.authorizedRoles !== undefined)
      authorizedRoles = optionsOrRole.authorizedRoles;
  }

  const resolvedAgentId = agentId !== undefined ? agentId : "unknown";

  if (command === "task:abandon") {
    const isAuthorized = authorizedRoles.includes(role);
    if (!isAuthorized) {
      const error = formatImplementerGuardError({
        role,
        command,
        agentId: resolvedAgentId,
        contractPath,
      });
      return {
        allowed: false,
        role,
        command,
        agentId,
        errorCode: ERROR_CODE,
        error,
        remediation:
          "Ensure agent holds an authorized role for task:abandon or delegate the action to an authorized subagent via subagent dispatch.",
        authorizedRoles,
        contractPath,
      };
    }
    return {
      allowed: true,
      role,
      command,
      agentId,
      authorizedRoles,
      contractPath,
    };
  }

  if (role === "implementer") {
    const isGranted = IMPLEMENTER_COMMANDS.includes(command);
    if (!isGranted) {
      const error = formatImplementerGuardError({
        role,
        command,
        agentId: resolvedAgentId,
        contractPath,
      });
      return {
        allowed: false,
        role,
        command,
        agentId,
        errorCode: ERROR_CODE,
        error,
        remediation: `Ensure agent holds an authorized role for ${command} or delegate the action to an authorized subagent via subagent dispatch.`,
        contractPath,
      };
    }
    return {
      allowed: true,
      role,
      command,
      agentId,
      contractPath,
    };
  }

  return {
    allowed: true,
    role,
    command,
    agentId,
  };
}
