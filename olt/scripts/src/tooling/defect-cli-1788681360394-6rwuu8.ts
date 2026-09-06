export const DEFECT_ID = "defect-cli-1788681360394-6rwuu8";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE = "Defect Remediation: unknown command: msg";

export interface MailboxCommandResolutionContext {
  readonly rawCommand: string;
  readonly defaultSubcommand?: string;
}

export interface MailboxCommandResolutionResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly resolved: boolean;
  readonly canonicalCommand: string;
  readonly subcommands: readonly string[];
  readonly error?: string;
}

export function resolveMailboxCommand(
  context: MailboxCommandResolutionContext,
): MailboxCommandResolutionResult {
  const { rawCommand, defaultSubcommand = "msg:send" } = context;
  const subcommands = ["msg:send", "msg:recv", "msg:poll", "msg:list"];

  if (rawCommand === "msg") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      canonicalCommand: defaultSubcommand,
      subcommands,
    };
  }

  if (subcommands.includes(rawCommand)) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      canonicalCommand: rawCommand,
      subcommands,
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    resolved: false,
    canonicalCommand: rawCommand,
    subcommands,
    error: `unknown command: ${rawCommand}`,
  };
}
