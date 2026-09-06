export const DEFECT_ID = "defect-cli-1788676700970-efamy2";
export const ERROR_CODE = "AUTHENTICATION_FAILURE";
export const DEFECT_TITLE =
  "Defect Remediation: mind:wake requires a verified caller session backed by an active run grant; explicit identity flags cannot establish authority";

export interface MindWakeSessionContext {
  readonly callerActor?: string;
  readonly sessionToken?: string;
  readonly runGrantActive?: boolean;
  readonly explicitIdentityFlag?: boolean;
  readonly runId?: string;
}

export interface MindWakeAuthResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly authorized: boolean;
  readonly errors: readonly string[];
}

export function evaluateMindWakeAuthority(ctx: MindWakeSessionContext): MindWakeAuthResult {
  const errors: string[] = [];
  if (ctx.explicitIdentityFlag && !ctx.sessionToken) {
    errors.push(
      "Explicit identity flags cannot establish authority without a verified caller session token",
    );
  }
  if (!ctx.sessionToken ? true : ctx.sessionToken.trim().length === 0) {
    errors.push("Missing verified caller session token");
  }
  if (ctx.runGrantActive !== true) {
    errors.push("Caller session is not backed by an active run grant");
  }

  const authorized = errors.length === 0;
  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    authorized,
    errors,
  };
}
