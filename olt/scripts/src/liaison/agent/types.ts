import type { MailboxEnvelope } from "../../communication/types.ts";

export type LiaisonAgentId = `liaison_${string}`;

export const TIER_0_INVARIANTS = [
  "NO_PLANNING",
  "NO_WORK_CLAIMS",
  "NO_IMPLEMENTATION",
  "NO_GATE_EXECUTION",
  "NO_RUN_SEALING",
  "CROSS_SYSTEM_TRANSPORT_ONLY",
] as const;

export type Tier0Invariant = (typeof TIER_0_INVARIANTS)[number];

export type AllowedLiaisonAction =
  | "DRAIN_MAILBOX"
  | "EMIT_RECEIPT"
  | "EMIT_HEARTBEAT"
  | "ANSWER_QUERY"
  | "ROUTE_ESCALATION"
  | "CHECK_OBLIGATION";

export type ForbiddenLiaisonAction =
  | "PLAN"
  | "CLAIM_TASK"
  | "CLAIM_LEASE"
  | "IMPLEMENT"
  | "EDIT_CODE"
  | "RUN_GATE"
  | "SEAL_RUN";

export type LiaisonAction = AllowedLiaisonAction | ForbiddenLiaisonAction;

export interface LiaisonIdentity {
  readonly agentId: LiaisonAgentId;
  readonly system: string;
  readonly tier: 0;
  readonly role: "liaison";
  readonly invariants: readonly Tier0Invariant[];
}

export type ReceiptType = "RECEIPT_DELIVERED" | "RECEIPT_BOUND" | "RECEIPT_REFUSED";

export type ExpectationType = "receipt" | "verdict" | "nothing";

export interface DirectivePayload {
  readonly directiveId: string;
  readonly targetPaths: readonly string[];
  readonly requirements?: readonly string[];
  readonly expectation?: ExpectationType;
}

export interface LaneScope {
  readonly laneId: string;
  readonly runId: string;
  readonly writeScope: readonly string[];
  readonly status?: string;
  readonly leaseHolder?: string;
}

export interface PlanOrState {
  readonly runId: string;
  readonly lanes: readonly LaneScope[];
}

export interface ObligationPathCheck {
  readonly path: string;
  readonly isCovered: boolean;
  readonly coveredByLaneId?: string;
  readonly coveredByRunId?: string;
  readonly matchedPattern?: string;
}

export interface ObligationBindingProof {
  readonly runId: string;
  readonly bindings: readonly {
    readonly path: string;
    readonly laneId: string;
  }[];
}

export interface ObligationVerificationResult {
  readonly directiveId: string;
  readonly isFullyBound: boolean;
  readonly isPartiallyBound: boolean;
  readonly isUnbound: boolean;
  readonly pathChecks: readonly ObligationPathCheck[];
  readonly boundLanes: readonly LaneScope[];
  readonly unboundPaths: readonly string[];
  readonly receiptType: "RECEIPT_BOUND" | "RECEIPT_REFUSED";
  readonly proof?: ObligationBindingProof;
  readonly refusalReason?: string;
}

export type PeerQueryType =
  | "LIVENESS"
  | "RUN_STATE"
  | "LANE_STATUS"
  | "ROSTER"
  | "OBLIGATIONS"
  | "METRICS"
  | "PING";

export interface PeerQueryRequest {
  readonly queryId: string;
  readonly senderId: string;
  readonly queryType: PeerQueryType;
  readonly targetId?: string;
  readonly timestamp: string;
}

export interface PeerQueryResponse {
  readonly queryId: string;
  readonly responderId: LiaisonAgentId;
  readonly success: boolean;
  readonly timestamp: string;
  readonly payload: Record<string, unknown>;
  readonly error?: string;
}

export interface LiaisonStateProvider {
  getLiveness(): Record<string, unknown>;
  getRunState(runId?: string): Record<string, unknown> | null;
  getLaneStatus(laneId: string): Record<string, unknown> | null;
  getRoster(): readonly Record<string, unknown>[];
  getObligationStatus(obligationId: string): Record<string, unknown> | null;
  getMetrics(): Record<string, unknown>;
}

export interface EscalationEvaluation {
  readonly shouldEscalate: boolean;
  readonly reason: string;
  readonly requiresPlanning: boolean;
  readonly requiresExecution: boolean;
  readonly urgency: "HIGH" | "NORMAL" | "LOW";
}

export interface EscalationMessagePayload {
  readonly sourceMessageId: string;
  readonly sourceSenderId: string;
  readonly correlationId: string;
  readonly reason: string;
  readonly evaluation: EscalationEvaluation;
  readonly originalPayload: unknown;
  readonly escalationTimestamp: string;
}

export interface RouteEscalationOptions {
  readonly orchestratorId: string;
  readonly orchestratorRole?: string;
  readonly baseDir?: string;
  readonly secretKey?: string;
  readonly planOrState?: PlanOrState;
}

export interface EscalationRouteResult {
  readonly escalated: boolean;
  readonly decision: EscalationEvaluation;
  readonly dispatchedEnvelopeId?: string;
}

export type DrainStatus =
  | "delivered"
  | "bound"
  | "refused"
  | "answered"
  | "escalated"
  | "ignored"
  | "quarantined";

export interface DrainItemResult {
  readonly messageId: string;
  readonly correlationId: string;
  readonly status: DrainStatus;
  readonly detail?: string;
}

export interface ContinuousDrainMetrics {
  totalDrained: number;
  totalProcessed: number;
  totalDeliveredReceiptsEmitted: number;
  totalEscalated: number;
  totalQueriesAnswered: number;
  totalErrors: number;
  lastDrainedAt: string | null;
  cyclesCompleted: number;
}

export interface ContinuousDrainOptions {
  readonly agentId: LiaisonAgentId | string;
  readonly baseDir?: string;
  readonly secretKey?: string;
  readonly idleWaitMs?: number;
  readonly batchSize?: number;
  readonly autoAdvanceCursor?: boolean;
  readonly emitDeliveredReceipts?: boolean;
  readonly stateProvider?: LiaisonStateProvider;
  readonly planOrState?: PlanOrState;
  readonly orchestratorId?: string;
  readonly orchestratorRole?: string;
  readonly onMessage?: (
    envelope: MailboxEnvelope<unknown>,
  ) => Promise<DrainItemResult> | DrainItemResult;
  readonly onError?: (error: unknown) => void;
}

export interface ContinuousDrainHandle {
  readonly isRunning: boolean;
  stop(): Promise<void>;
  getMetrics(): ContinuousDrainMetrics;
  triggerDrain(): Promise<readonly DrainItemResult[]>;
}
