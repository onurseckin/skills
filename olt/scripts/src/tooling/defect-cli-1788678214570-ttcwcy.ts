export const DEFECT_ID = "defect-cli-1788678214570-ttcwcy";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE = "Defect Remediation: unknown command: nope";

export interface CommandValidationContext {
  readonly requestedCommand: string;
  readonly availableCommands?: readonly string[];
  readonly actor?: string;
  readonly role?: string;
}

export interface CommandValidationResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly valid: boolean;
  readonly error?: string;
  readonly suggestion?: string;
}

export function validateCommandDispatch(
  context: CommandValidationContext,
): CommandValidationResult {
  const { requestedCommand, availableCommands = [] } = context;

  if (availableCommands.includes(requestedCommand)) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      valid: true,
    };
  }

  let suggestion: string | undefined;
  if (requestedCommand === "nope") {
    suggestion = availableCommands.find((c) => c.includes("node") || c.includes("none"));
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    valid: false,
    error: `unknown command: ${requestedCommand}`,
    ...(suggestion !== undefined ? { suggestion } : {}),
  };
}
