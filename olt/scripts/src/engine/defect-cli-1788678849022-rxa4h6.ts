export const DEFECT_ID = "defect-cli-1788678849022-rxa4h6";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_MESSAGE =
  "agent:register could not load capsule state at --run supervisory-cadence-and-mechanical-interlocks; first-grant genesis requires a readable empty agent ledger, and an unreadable capsule cannot be treated as one";

export interface GenesisLedgerInspection {
  readonly runId: string;
  readonly isReadable: boolean;
  readonly agentCount?: number | undefined;
  readonly isFirstGrantGenesis?: boolean | undefined;
  readonly capsulePath?: string | undefined;
  readonly ledgerExists?: boolean | undefined;
  readonly rawError?: string | undefined;
}

export interface Defect1788678849022Rxa4h6Result {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly allowed: boolean;
  readonly errors: readonly string[];
  readonly inspection: GenesisLedgerInspection;
}

export function formatGenesisLedgerError(
  runId: string = "supervisory-cadence-and-mechanical-interlocks",
  details?: string,
): string {
  const resolvedRun =
    runId && runId.length > 0 ? runId : "supervisory-cadence-and-mechanical-interlocks";
  const base = `agent:register could not load capsule state at --run ${resolvedRun}; first-grant genesis requires a readable empty agent ledger, and an unreadable capsule cannot be treated as one`;
  if (details && details.length > 0) {
    return `${base}: ${details}`;
  }
  return base;
}

export function evaluateGenesisLedgerState(inspection: GenesisLedgerInspection): boolean {
  if (!inspection.isReadable) {
    return false;
  }
  const isFirstGrant =
    inspection.isFirstGrantGenesis !== undefined ? inspection.isFirstGrantGenesis : true;
  const count = inspection.agentCount !== undefined ? inspection.agentCount : 0;
  if (count < 0) {
    return false;
  }
  if (isFirstGrant) {
    return count === 0;
  }
  return true;
}

export function auditAgentRegisterGenesisLoading(
  inspection?: Partial<GenesisLedgerInspection>,
): Defect1788678849022Rxa4h6Result {
  const runId =
    inspection && inspection.runId
      ? inspection.runId
      : "supervisory-cadence-and-mechanical-interlocks";
  const isReadable =
    inspection && inspection.isReadable !== undefined ? inspection.isReadable : false;
  const agentCount = inspection && inspection.agentCount !== undefined ? inspection.agentCount : 0;
  const isFirstGrantGenesis =
    inspection && inspection.isFirstGrantGenesis !== undefined
      ? inspection.isFirstGrantGenesis
      : true;
  const capsulePath =
    inspection && inspection.capsulePath !== undefined ? inspection.capsulePath : undefined;
  const ledgerExists =
    inspection && inspection.ledgerExists !== undefined ? inspection.ledgerExists : undefined;
  const rawError =
    inspection && inspection.rawError !== undefined ? inspection.rawError : undefined;

  const resolvedInspection: GenesisLedgerInspection = {
    runId,
    isReadable,
    agentCount,
    isFirstGrantGenesis,
    capsulePath,
    ledgerExists,
    rawError,
  };

  const isStateValid = evaluateGenesisLedgerState(resolvedInspection);
  const errors: string[] = [];

  if (!resolvedInspection.isReadable) {
    errors.push(formatGenesisLedgerError(resolvedInspection.runId, resolvedInspection.rawError));
  } else if (isFirstGrantGenesis && agentCount > 0) {
    errors.push(
      `agent:register cannot execute first-grant genesis at --run ${resolvedInspection.runId}; expected empty ledger but found ${resolvedInspection.agentCount} existing agents`,
    );
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    allowed: isStateValid,
    errors,
    inspection: resolvedInspection,
  };
}
