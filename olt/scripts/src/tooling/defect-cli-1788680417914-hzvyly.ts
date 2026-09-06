export const DEFECT_ID = "defect-cli-1788680417914-hzvyly";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE =
  "Defect Remediation: requirement proof command is invalid: C-4d96270c-8122-4e98-a4cf-94434c945f85";

export interface RequirementCommandEvidence {
  readonly commandId: string;
  readonly exitCode: number;
  readonly passed: boolean;
  readonly hasTerminalOutput: boolean;
}

export interface RequirementProofValidationContext {
  readonly requirementId: string;
  readonly proofCommandId: string;
  readonly recordedCommands: readonly RequirementCommandEvidence[];
}

export interface RequirementProofValidationResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly valid: boolean;
  readonly proofCommandId: string;
  readonly error?: string;
}

export function validateRequirementProofCommand(
  context: RequirementProofValidationContext,
): RequirementProofValidationResult {
  const { proofCommandId, recordedCommands } = context;

  const cmd = recordedCommands.find((c) => c.commandId === proofCommandId);

  if (cmd && cmd.passed && cmd.exitCode === 0 && cmd.hasTerminalOutput) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      valid: true,
      proofCommandId,
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    valid: false,
    proofCommandId,
    error: `requirement proof command is invalid: ${proofCommandId}`,
  };
}
