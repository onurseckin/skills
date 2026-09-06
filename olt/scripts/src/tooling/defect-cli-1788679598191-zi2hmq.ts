export const DEFECT_ID = "defect-cli-1788679598191-zi2hmq";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE =
  "Defect Remediation: unexpected positional argument: /Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/guards/coordinator-tool-guard.ts";

export interface PositionalArgValidationContext {
  readonly command: string;
  readonly positionalArgs: readonly string[];
  readonly allowsPositional?: boolean;
  readonly expectedFlagForPositional?: string;
}

export interface PositionalArgValidationResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly valid: boolean;
  readonly normalizedFlags: Readonly<Record<string, string>>;
  readonly error?: string;
}

export function validatePositionalArguments(
  context: PositionalArgValidationContext,
): PositionalArgValidationResult {
  const {
    positionalArgs,
    allowsPositional = false,
    expectedFlagForPositional = "--file",
  } = context;

  if (positionalArgs.length === 0) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      valid: true,
      normalizedFlags: {},
    };
  }

  if (allowsPositional) {
    const flags: Record<string, string> = {};
    if (positionalArgs[0]) {
      flags[expectedFlagForPositional] = positionalArgs[0];
    }
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      valid: true,
      normalizedFlags: flags,
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    valid: false,
    normalizedFlags: {},
    error: `unexpected positional argument: ${positionalArgs[0]}`,
  };
}
