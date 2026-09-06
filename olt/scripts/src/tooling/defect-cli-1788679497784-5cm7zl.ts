export const DEFECT_ID = "defect-cli-1788679497784-5cm7zl";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE =
  "Defect Remediation: unknown command: task:show; did you mean 'task:add'?";

export interface TaskShowResolutionContext {
  readonly requestedCommand: string;
  readonly availableCommands?: readonly string[];
}

export interface TaskShowResolutionResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly resolved: boolean;
  readonly suggestion: string;
  readonly canonicalCommand: string;
  readonly error?: string;
}

export function resolveTaskShowCommand(
  context: TaskShowResolutionContext,
): TaskShowResolutionResult {
  const { requestedCommand } = context;

  if (requestedCommand === "task:show") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      suggestion: "task:add",
      canonicalCommand: "task:brief",
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    resolved: false,
    suggestion: "task:add",
    canonicalCommand: requestedCommand,
    error: `unknown command: ${requestedCommand}; did you mean 'task:add'?`,
  };
}
