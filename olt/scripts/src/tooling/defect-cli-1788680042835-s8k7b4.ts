export const DEFECT_ID = "defect-cli-1788680042835-s8k7b4";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE =
  "Defect Remediation: cannot pass lane-4-optical-reports-and-records: no recorded falsifiable gate:prove proof for gate-lane-4-optical-reports-and-records (`bun scripts/check/cli.ts push --all`); run `gate:prove --run <run> --task lane-4-optical-reports-and-records --actor <actor>` and record a falsifiable proof against this attempt's claimed base before this review can pass";

export interface GateProofRecord {
  readonly gateId: string;
  readonly command: string;
  readonly actor: string;
  readonly claimedBase: string;
  readonly provenAt: number;
  readonly isFalsifiable: boolean;
}

export interface GateReviewValidationContext {
  readonly taskName: string;
  readonly gateName: string;
  readonly gateCommand: string;
  readonly proofs: readonly GateProofRecord[];
  readonly runId?: string;
  readonly actor?: string;
}

export interface GateReviewValidationResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly allowed: boolean;
  readonly proofRecorded: boolean;
  readonly error?: string;
}

export function validateGateProofForReview(
  context: GateReviewValidationContext,
): GateReviewValidationResult {
  const { taskName, gateName, gateCommand, proofs } = context;

  const matchingProof = proofs.find(
    (p) => p.gateId === gateName && p.isFalsifiable,
  );

  if (matchingProof) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      allowed: true,
      proofRecorded: true,
    };
  }

  const error = `cannot pass ${taskName}: no recorded falsifiable gate:prove proof for ${gateName} (\`${gateCommand}\`); run \`gate:prove --run <run> --task ${taskName} --actor <actor>\` and record a falsifiable proof against this attempt's claimed base before this review can pass`;

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    allowed: false,
    proofRecorded: false,
    error,
  };
}
