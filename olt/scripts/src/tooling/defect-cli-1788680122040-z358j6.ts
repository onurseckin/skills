export const DEFECT_ID = "defect-cli-1788680122040-z358j6";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE = "Defect Remediation: command event actor does not match command actor";

export interface CommandActorValidationContext {
  readonly commandId: string;
  readonly commandActor: string;
  readonly eventActor: string;
  readonly eventType?: string;
  readonly timestamp?: number;
}

export interface CommandActorValidationResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly valid: boolean;
  readonly commandActor: string;
  readonly eventActor: string;
  readonly error?: string;
}

export function validateCommandEventActor(
  context: CommandActorValidationContext,
): CommandActorValidationResult {
  const { commandActor, eventActor } = context;

  if (commandActor === eventActor) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      valid: true,
      commandActor,
      eventActor,
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    valid: false,
    commandActor,
    eventActor,
    error: "command event actor does not match command actor",
  };
}
