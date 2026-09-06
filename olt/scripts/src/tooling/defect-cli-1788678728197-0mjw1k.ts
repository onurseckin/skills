export const DEFECT_ID = "defect-cli-1788678728197-0mjw1k";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE = "Defect Remediation: unknown command: nope";

export interface CommandLookupContext {
  readonly command: string;
  readonly validSubcommands?: readonly string[];
}

export interface CommandLookupResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly success: boolean;
  readonly error?: string;
}

export function evaluateCommandLookup(
  context: CommandLookupContext,
): CommandLookupResult {
  const { command, validSubcommands = [] } = context;

  if (validSubcommands.includes(command)) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      success: true,
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    success: false,
    error: `unknown command: ${command}`,
  };
}
