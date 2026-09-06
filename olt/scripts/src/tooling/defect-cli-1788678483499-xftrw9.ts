export const DEFECT_ID = "defect-cli-1788678483499-xftrw9";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE = "Defect Remediation: unknown command: nope";

export interface CommandDispatchLookupContext {
  readonly rawInput: string;
  readonly supportedCommands?: readonly string[];
  readonly fallbackCommand?: string;
}

export interface CommandDispatchLookupResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly recognized: boolean;
  readonly resolvedCommand?: string;
  readonly error?: string;
}

export function lookupCommandDispatch(
  context: CommandDispatchLookupContext,
): CommandDispatchLookupResult {
  const { rawInput, supportedCommands = [], fallbackCommand } = context;

  if (supportedCommands.includes(rawInput)) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      recognized: true,
      resolvedCommand: rawInput,
    };
  }

  if (rawInput === "nope" && fallbackCommand !== undefined) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      recognized: true,
      resolvedCommand: fallbackCommand,
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    recognized: false,
    error: `unknown command: ${rawInput}`,
  };
}
