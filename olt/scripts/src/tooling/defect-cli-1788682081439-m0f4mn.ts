export const DEFECT_ID = "defect-cli-1788682081439-m0f4mn";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE =
  "Defect Remediation: requirement proof command is invalid: C-4ac7f9ea-b9a8-42e9-8bf0-7f4dc83f06de";

export interface RequirementCommandEntry {
  readonly commandId: string;
  readonly exitCode: number;
  readonly verified: boolean;
}

export interface ProofCommandValidationContext {
  readonly proofCommandId: string;
  readonly executedCommands: readonly RequirementCommandEntry[];
}

export interface ProofCommandValidationResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly valid: boolean;
  readonly error?: string;
}

export function validateProofCommand33(
  context: ProofCommandValidationContext,
): ProofCommandValidationResult {
  const { proofCommandId, executedCommands } = context;

  const found = executedCommands.find((c) => c.commandId === proofCommandId);

  if (found && found.exitCode === 0 && found.verified) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      valid: true,
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    valid: false,
    error: `requirement proof command is invalid: ${proofCommandId}`,
  };
}
