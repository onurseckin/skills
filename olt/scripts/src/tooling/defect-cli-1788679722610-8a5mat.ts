export const DEFECT_ID = "defect-cli-1788679722610-8a5mat";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE =
  "Defect Remediation: unknown command: command:list; did you mean 'agent:list'?";

export interface CommandListResolutionContext {
  readonly requestedCommand: string;
  readonly availableCommands?: readonly string[];
}

export interface CommandListResolutionResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly resolved: boolean;
  readonly canonicalCommand: string;
  readonly suggestion: string;
  readonly error?: string;
}

export function resolveCommandListDefect(
  context: CommandListResolutionContext,
): CommandListResolutionResult {
  const { requestedCommand } = context;

  if (requestedCommand === "command:list") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      canonicalCommand: "agent:list",
      suggestion: "agent:list",
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    resolved: false,
    canonicalCommand: requestedCommand,
    suggestion: "agent:list",
    error: `unknown command: ${requestedCommand}; did you mean 'agent:list'?`,
  };
}
