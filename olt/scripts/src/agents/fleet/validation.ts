import { getAgentContract } from "./matrix.ts";

export function isHeadfulReviewer(roleOrAlias: string): boolean {
  const contract = getAgentContract(roleOrAlias);
  return Boolean(contract?.isHeadfulReviewer);
}

export function isHeadlessDebugger(roleOrAlias: string): boolean {
  const contract = getAgentContract(roleOrAlias);
  return Boolean(contract?.isHeadlessDebugger);
}

export function isSourceCodeBlind(roleOrAlias: string): boolean {
  const contract = getAgentContract(roleOrAlias);
  return Boolean(contract?.isSourceCodeBlind);
}

export function validateAgentToolCall(
  roleOrAlias: string,
  toolName: string,
  commandName?: string,
): { allowed: boolean; violation?: string } {
  const contract = getAgentContract(roleOrAlias);
  if (!contract) {
    return {
      allowed: false,
      violation: `Agent role '${roleOrAlias}' not registered in fleet matrix.`,
    };
  }

  const { toolBoundaries, permissions } = contract;

  const isCodeWriteTool = [
    "write_to_file",
    "replace_file_content",
    "edit_file",
    "create_file",
    "delete_file",
  ].includes(toolName);
  if (isCodeWriteTool && !toolBoundaries.canWriteCode) {
    return {
      allowed: false,
      violation: `Agent '${contract.name}' (${contract.category}) has ZERO_SOURCE_EDITS invariant. Tool '${toolName}' forbidden.`,
    };
  }

  const isCommandExecTool = ["run_command", "shell", "run:exec", "execute_command"].includes(
    toolName,
  );
  if (isCommandExecTool && !toolBoundaries.canExecuteCommands) {
    return {
      allowed: false,
      violation: `Agent '${contract.name}' is a cognitive validator with ZERO command execution privileges. Tool '${toolName}' forbidden.`,
    };
  }

  if (toolBoundaries.forbiddenTools.includes(toolName)) {
    return {
      allowed: false,
      violation: `Tool '${toolName}' is explicitly forbidden for '${contract.name}'.`,
    };
  }

  if (commandName && permissions.forbiddenCommands.includes(commandName)) {
    return {
      allowed: false,
      violation: `Command '${commandName}' is explicitly forbidden for '${contract.name}'.`,
    };
  }

  return { allowed: true };
}

export function validateAgentSpawn(
  parentRole: string,
  childRole: string,
): { allowed: boolean; violation?: string } {
  const parentContract = getAgentContract(parentRole);
  if (!parentContract) {
    return { allowed: false, violation: `Parent role '${parentRole}' not found in fleet matrix.` };
  }

  const childContract = getAgentContract(childRole);
  if (!childContract) {
    return { allowed: false, violation: `Child role '${childRole}' not found in fleet matrix.` };
  }

  if (!parentContract.toolBoundaries.canSpawnSubagents) {
    return {
      allowed: false,
      violation: `Parent '${parentContract.name}' (Tier ${parentContract.tier}) does not have subagent spawn authority.`,
    };
  }

  if (parentContract.permissions.allowedSpawns.length > 0) {
    const isExplicitlyAllowed =
      parentContract.permissions.allowedSpawns.includes(childContract.id) ||
      parentContract.permissions.allowedSpawns.includes(childContract.role) ||
      parentContract.permissions.allowedSpawns.some((s) => childContract.aliases.includes(s));

    if (!isExplicitlyAllowed) {
      return {
        allowed: false,
        violation: `Agent '${parentContract.name}' is not permitted to spawn '${childContract.name}'. Allowed: [${parentContract.permissions.allowedSpawns.join(", ")}].`,
      };
    }
  }

  return { allowed: true };
}
