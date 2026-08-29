/**
 * Shared Leaf Contracts for Proposals & Decision Governance
 */

export type ProposalStatus =
  | "proposed"
  | "admitted"
  | "declined"
  | "in_progress"
  | "completed"
  | "failed"
  | "quarantined";

export const VALID_PROPOSAL_TRANSITIONS: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = {
  proposed: ["admitted", "declined", "quarantined"],
  admitted: ["in_progress", "declined", "quarantined"],
  in_progress: ["completed", "failed", "quarantined"],
  completed: [],
  failed: ["proposed", "quarantined"],
  declined: ["proposed"],
  quarantined: ["proposed"],
};

export interface ProposalRecord {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: ProposalStatus;
  readonly category: string;
  readonly priority: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface ProposalDecision {
  readonly proposalId: string;
  readonly decision: "admit" | "decline" | "quarantine";
  readonly rationale: string;
  readonly decidedAt: string;
  readonly decider?: string | undefined;
}

export interface ProposalCandidate {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly writeScope: readonly string[];
}
