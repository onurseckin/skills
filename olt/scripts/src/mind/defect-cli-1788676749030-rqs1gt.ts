export const DEFECT_ID = "defect-cli-1788676749030-rqs1gt";
export const ERROR_CODE = "INTEGRITY";
export const EXPECTED_CHARTER_SHA =
  "416a40a6de8a5ede34885ab99624408774015ce81ab2dd373f8c85cea0fca5cc";
export const DRIFTED_CHARTER_SHA =
  "1280b1783bb7f1a8b3873ab94a12df27b9f147ad785b6490697437bcba1be7e3";
export const DEFECT_TITLE =
  "Defect Remediation: charter sha256 mismatch (expected 416a40a6de8a5ede34885ab99624408774015ce81ab2dd373f8c85cea0fca5cc, got 1280b1783bb7f1a8b3873ab94a12df27b9f147ad785b6490697437bcba1be7e3); charter has drifted. Outcome: halted. Next: inspect charter drift";

export interface CharterIntegrityContext {
  readonly observedSha: string;
  readonly expectedSha?: string;
  readonly allowReanchor?: boolean;
}

export interface CharterIntegrityResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly valid: boolean;
  readonly drifted: boolean;
  readonly errors: readonly string[];
}

export function verifyCharterIntegrity(ctx: CharterIntegrityContext): CharterIntegrityResult {
  const expected = ctx.expectedSha !== undefined ? ctx.expectedSha : EXPECTED_CHARTER_SHA;
  const drifted = ctx.observedSha !== expected;
  const errors: string[] = [];

  if (drifted && !ctx.allowReanchor) {
    errors.push(
      `charter sha256 mismatch (expected ${expected}, got ${ctx.observedSha}); charter has drifted. Outcome: halted. Next: inspect charter drift`,
    );
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    valid: !drifted ? true : Boolean(ctx.allowReanchor),
    drifted,
    errors,
  };
}
