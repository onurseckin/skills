export const PROSE_ASSERTION_OVER_EVIDENCE_BIAS = "PROSE_ASSERTION_OVER_EVIDENCE_BIAS" as const;
export type ProseAssertionErrorCode = typeof PROSE_ASSERTION_OVER_EVIDENCE_BIAS;

export type MilestoneType =
  | "ignition"
  | "invariant"
  | "execution"
  | "completion"
  | "test_pass"
  | "generic";

export interface ProseMilestoneClaim {
  readonly milestoneId?: string | undefined;
  readonly type: MilestoneType;
  readonly rawText: string;
  readonly claimedCommandsCount?: number | undefined;
  readonly claimedInvariants?: readonly string[] | undefined;
  readonly claimedStatus?: string | undefined;
  readonly sourcePath?: string | undefined;
  readonly line?: number | undefined;
}

export interface CommandReceiptProof {
  readonly taskId: string;
  readonly actor: string;
  readonly command: string;
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly stdoutHash: string;
  readonly timestamp?: string | undefined;
  readonly eventSequence?: number | undefined;
}

export interface EventLogSummary {
  readonly eventsPath: string;
  readonly exists: boolean;
  readonly totalEvents: number;
  readonly maxSequence: number;
  readonly commandReceiptsCount: number;
  readonly commandReceipts: readonly CommandReceiptProof[];
  readonly shaChainValid: boolean;
  readonly containsIgnitionEvent: boolean;
  readonly containsCompletionEvent: boolean;
  readonly parseErrors: readonly string[];
}

export interface ObservedEvidenceState {
  readonly totalEvents: number;
  readonly maxSequence: number;
  readonly commandReceiptsCount: number;
  readonly shaChainValid: boolean;
}

export interface ProseAssertionViolation {
  readonly code: ProseAssertionErrorCode;
  readonly milestoneType: MilestoneType;
  readonly claim: string;
  readonly reason: string;
  readonly requiredEvidence: string;
  readonly observedEvidence: ObservedEvidenceState;
}

export interface EvidenceAuditOptions {
  readonly repoRoot?: string | undefined;
  readonly capsuleRoot?: string | undefined;
  readonly eventsPath?: string | undefined;
  readonly markdownReport?: string | undefined;
  readonly reportPath?: string | undefined;
  readonly minimumSequence?: number | undefined;
  readonly requireCommandReceipts?: boolean | undefined;
  readonly requireShaChainValidation?: boolean | undefined;
  readonly expectedMilestones?: readonly MilestoneType[] | undefined;
  readonly allowProseWithoutEvidence?: boolean | undefined;
}

export interface EvidenceAuditResult {
  readonly valid: boolean;
  readonly defectRemediated: boolean;
  readonly defectId: "defect-prose-assertion-over-evidence-bias";
  readonly errorCode?: ProseAssertionErrorCode | undefined;
  readonly claimsAnalyzed: readonly ProseMilestoneClaim[];
  readonly evidenceSummary: EventLogSummary;
  readonly violations: readonly ProseAssertionViolation[];
  readonly issues: readonly string[];
}
