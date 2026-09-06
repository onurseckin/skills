import type {
  ExpectationDeclaration,
  ExpectationType,
  ObligationAssessment,
  ObligationStatus,
  Phase2Receipt,
  ReceiptDelivered,
  TrackedObligation,
} from "./types.ts";

export const DEFAULT_OBLIGATION_TIMEOUT_MS = 60_000;

export function isExpectationType(value: unknown): value is ExpectationType {
  return value === "receipt" || value === "verdict" || value === "nothing";
}

export function createExpectationDeclaration(
  messageId: string,
  correlationId: string,
  expectation: ExpectationType,
  timeoutMs: number = DEFAULT_OBLIGATION_TIMEOUT_MS,
  declaredAt: string = new Date().toISOString(),
): ExpectationDeclaration {
  return {
    message_id: messageId,
    correlation_id: correlationId,
    expectation,
    timeout_ms: timeoutMs,
    declared_at: declaredAt,
  };
}

export function evaluateObligationStatus(
  obligation: TrackedObligation,
  nowMs: number = Date.now(),
): ObligationAssessment {
  if (obligation.expectation === "nothing") {
    return {
      message_id: obligation.message_id,
      correlation_id: obligation.correlation_id,
      expectation: obligation.expectation,
      status: "INFORMATIONAL",
      is_overdue: false,
      elapsed_ms: 0,
      remaining_ms: 0,
    };
  }

  if (obligation.phase2_receipt) {
    const status: ObligationStatus =
      obligation.phase2_receipt.type === "RECEIPT_BOUND" ? "RESOLVED_BOUND" : "RESOLVED_REFUSED";
    return {
      message_id: obligation.message_id,
      correlation_id: obligation.correlation_id,
      expectation: obligation.expectation,
      status,
      is_overdue: false,
      elapsed_ms: 0,
      remaining_ms: 0,
    };
  }

  if (!obligation.delivered_receipt) {
    return {
      message_id: obligation.message_id,
      correlation_id: obligation.correlation_id,
      expectation: obligation.expectation,
      status: "PENDING_DELIVERY",
      is_overdue: false,
      elapsed_ms: 0,
      remaining_ms: obligation.timeout_ms,
    };
  }

  const deliveredMs = new Date(obligation.delivered_receipt.timestamp).getTime();
  const elapsedMs = Math.max(0, nowMs - deliveredMs);
  const remainingMs = Math.max(0, obligation.timeout_ms - elapsedMs);
  const isOverdue = elapsedMs > obligation.timeout_ms;

  return {
    message_id: obligation.message_id,
    correlation_id: obligation.correlation_id,
    expectation: obligation.expectation,
    status: isOverdue ? "OVERDUE" : "AWAITING_BINDING",
    is_overdue: isOverdue,
    elapsed_ms: elapsedMs,
    remaining_ms: remainingMs,
  };
}

export function detectOverdueObligations(
  obligations: readonly TrackedObligation[],
  nowMs: number = Date.now(),
): readonly ObligationAssessment[] {
  const overdue: ObligationAssessment[] = [];
  for (const obligation of obligations) {
    const assessment = evaluateObligationStatus(obligation, nowMs);
    if (assessment.is_overdue) {
      overdue.push(assessment);
    }
  }
  return overdue;
}

export class ObligationTracker {
  private readonly obligations = new Map<string, TrackedObligation>();

  registerExpectation(declaration: ExpectationDeclaration): TrackedObligation {
    const existing = this.obligations.get(declaration.message_id);
    const tracked: TrackedObligation = {
      message_id: declaration.message_id,
      correlation_id: declaration.correlation_id,
      expectation: declaration.expectation,
      timeout_ms: declaration.timeout_ms ?? DEFAULT_OBLIGATION_TIMEOUT_MS,
      created_at: declaration.declared_at,
      delivered_receipt: existing?.delivered_receipt,
      phase2_receipt: existing?.phase2_receipt,
    };
    this.obligations.set(declaration.message_id, tracked);
    return tracked;
  }

  recordDelivered(receipt: ReceiptDelivered): TrackedObligation {
    const existing = this.obligations.get(receipt.message_id);
    const updated: TrackedObligation = {
      message_id: receipt.message_id,
      correlation_id: receipt.correlation_id,
      expectation: existing?.expectation ?? "receipt",
      timeout_ms: existing?.timeout_ms ?? DEFAULT_OBLIGATION_TIMEOUT_MS,
      created_at: existing?.created_at ?? receipt.timestamp,
      delivered_receipt: receipt,
      phase2_receipt: existing?.phase2_receipt,
    };
    this.obligations.set(receipt.message_id, updated);
    return updated;
  }

  recordPhase2(receipt: Phase2Receipt): TrackedObligation {
    const existing = this.obligations.get(receipt.message_id);
    const updated: TrackedObligation = {
      message_id: receipt.message_id,
      correlation_id: receipt.correlation_id,
      expectation: existing?.expectation ?? "receipt",
      timeout_ms: existing?.timeout_ms ?? DEFAULT_OBLIGATION_TIMEOUT_MS,
      created_at: existing?.created_at ?? receipt.timestamp,
      delivered_receipt: existing?.delivered_receipt,
      phase2_receipt: receipt,
    };
    this.obligations.set(receipt.message_id, updated);
    return updated;
  }

  getObligation(messageId: string): TrackedObligation | undefined {
    return this.obligations.get(messageId);
  }

  assessObligation(
    messageId: string,
    nowMs: number = Date.now(),
  ): ObligationAssessment | undefined {
    const obligation = this.obligations.get(messageId);
    if (!obligation) return undefined;
    return evaluateObligationStatus(obligation, nowMs);
  }

  getOverdueObligations(nowMs: number = Date.now()): readonly ObligationAssessment[] {
    const all = Array.from(this.obligations.values());
    return detectOverdueObligations(all, nowMs);
  }

  getAllAssessments(nowMs: number = Date.now()): readonly ObligationAssessment[] {
    const assessments: ObligationAssessment[] = [];
    for (const obligation of this.obligations.values()) {
      assessments.push(evaluateObligationStatus(obligation, nowMs));
    }
    return assessments;
  }

  isBlockedOnVerdict(messageId: string, nowMs: number = Date.now()): boolean {
    const obligation = this.obligations.get(messageId);
    if (!obligation) return false;
    if (obligation.expectation !== "verdict") return false;
    const assessment = evaluateObligationStatus(obligation, nowMs);
    return assessment.status !== "RESOLVED_BOUND" && assessment.status !== "RESOLVED_REFUSED";
  }
}
