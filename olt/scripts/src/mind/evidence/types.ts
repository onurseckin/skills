export type MilestoneType = "ignition" | "pulse" | "execution" | "completion" | (string & {});

export interface HashChainVerification {
  readonly valid: boolean;
  readonly totalEvents: number;
  readonly headHash: string | null;
  readonly brokenAtSequence?: number | undefined;
  readonly error?: string | undefined;
}

export interface CommandReceiptInfo {
  readonly taskId?: string | undefined;
  readonly actor: string;
  readonly command: string;
  readonly argv?: readonly string[] | undefined;
  readonly exitCode: number;
  readonly stdoutHash?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly valid: boolean;
  readonly source: "event" | "state";
}

export interface MilestoneEvidenceVerification {
  readonly certified: boolean;
  readonly milestone: string;
  readonly capsulePath: string;
  readonly hashChain: HashChainVerification;
  readonly commandReceipts: readonly CommandReceiptInfo[];
  readonly requiredEvents: readonly string[];
  readonly missingEvents: readonly string[];
  readonly failedReceipts: readonly CommandReceiptInfo[];
  readonly errors: readonly string[];
  readonly summary: string;
}

export interface MilestoneRequirements {
  readonly requiredEvents: readonly string[];
  readonly requireCommandReceipts: boolean;
  readonly minimumSequence: number;
  readonly allowedExitCodes: readonly number[];
}
