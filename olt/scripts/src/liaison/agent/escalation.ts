import { dispatchPeerMessage } from "../../communication/mailbox/mailbox-dispatcher.ts";
import type { MailboxEnvelope, MailboxMessageType } from "../../communication/types.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { verifyObligationScope } from "./obligation.ts";
import { isPeerStateQuery } from "./query.ts";
import type {
  DirectivePayload,
  EscalationEvaluation,
  EscalationMessagePayload,
  EscalationRouteResult,
  PlanOrState,
  RouteEscalationOptions,
} from "./types.ts";

function isDirectivePayload(payload: unknown): payload is DirectivePayload {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return typeof p.directiveId === "string" && Array.isArray(p.targetPaths);
}

function payloadRequiresPlanningOrExec(payload: unknown): {
  readonly planning: boolean;
  readonly execution: boolean;
} {
  if (!payload || typeof payload !== "object") {
    return { planning: false, execution: false };
  }
  const p = payload as Record<string, unknown>;
  const planning =
    p.requires_planning === true ||
    p.requiresPlanning === true ||
    p.action === "plan" ||
    p.action === "replan";
  const execution =
    p.requires_execution === true ||
    p.requiresExecution === true ||
    p.action === "execute" ||
    p.action === "dispatch";
  return { planning, execution };
}

export function evaluateEscalation(
  envelope: MailboxEnvelope<unknown>,
  planOrState?: PlanOrState,
): EscalationEvaluation {
  if (!envelope || typeof envelope !== "object") {
    return {
      shouldEscalate: false,
      reason: "Invalid envelope ignored by liaison",
      requiresPlanning: false,
      requiresExecution: false,
      urgency: "LOW",
    };
  }

  // 1. Heartbeats and peer state queries are transport facts handled locally
  if (envelope.message_type === "PULSE_HEARTBEAT" || isPeerStateQuery(envelope)) {
    return {
      shouldEscalate: false,
      reason:
        "Liveness heartbeat and peer state queries are handled locally without waking orchestrator",
      requiresPlanning: false,
      requiresExecution: false,
      urgency: "LOW",
    };
  }

  // 2. Receipts and handoffs are transport acknowledgements handled locally
  if (envelope.message_type === "HANDOFF_RECEIPT") {
    const pl = envelope.payload as Record<string, unknown> | null;
    const isPhase1Or2 =
      pl?.type === "RECEIPT_DELIVERED" ||
      pl?.type === "RECEIPT_BOUND" ||
      pl?.type === "RECEIPT_REFUSED";
    if (isPhase1Or2) {
      return {
        shouldEscalate: false,
        reason: "Transport receipt handled locally without waking orchestrator",
        requiresPlanning: false,
        requiresExecution: false,
        urgency: "LOW",
      };
    }
  }

  // 3. Directives naming paths: check if paths already sit in some lane's write scope
  if (isDirectivePayload(envelope.payload)) {
    if (planOrState) {
      const verification = verifyObligationScope(envelope.payload, planOrState);
      if (verification.isFullyBound) {
        return {
          shouldEscalate: false,
          reason:
            "Directive paths are already bound in active plan write scopes; local receipt emitted",
          requiresPlanning: false,
          requiresExecution: false,
          urgency: "LOW",
        };
      }
      return {
        shouldEscalate: true,
        reason: `Directive paths [${verification.unboundPaths.join(", ")}] are unbound in active plan; requires orchestrator planning`,
        requiresPlanning: true,
        requiresExecution: false,
        urgency: "HIGH",
      };
    }
    // No plan state provided to check paths -> requires orchestrator planning
    return {
      shouldEscalate: true,
      reason:
        "Directive requires write-scope allocation but no local plan state is available; escalating for planning",
      requiresPlanning: true,
      requiresExecution: false,
      urgency: "HIGH",
    };
  }

  // 4. Defect escalations and system alerts require planning/recovery
  if (envelope.message_type === "DEFECT_ESCALATION" || envelope.message_type === "SYSTEM_ALERT") {
    return {
      shouldEscalate: true,
      reason: `Inbound ${envelope.message_type} requires orchestrator intervention`,
      requiresPlanning: true,
      requiresExecution: true,
      urgency: "HIGH",
    };
  }

  // 5. External task dispatch requires planning and execution
  if (envelope.message_type === "DISPATCH_TASK") {
    return {
      shouldEscalate: true,
      reason: "Inbound DISPATCH_TASK requires orchestrator wave planning and execution dispatch",
      requiresPlanning: true,
      requiresExecution: true,
      urgency: "NORMAL",
    };
  }

  // 6. Cognitive pushback or failed validation verdict
  if (envelope.message_type === "COGNITIVE_PUSHBACK") {
    return {
      shouldEscalate: true,
      reason:
        "Cognitive pushback indicates architectural impasse requiring orchestrator resolution",
      requiresPlanning: true,
      requiresExecution: false,
      urgency: "NORMAL",
    };
  }

  if (envelope.message_type === "VALIDATION_VERDICT") {
    const pl = envelope.payload as Record<string, unknown> | null;
    if (pl?.passed === false || pl?.verdict === "FAILED" || pl?.verdict === "REJECTED") {
      return {
        shouldEscalate: true,
        reason:
          "Failed validation verdict requires orchestrator replanning or remediation dispatch",
        requiresPlanning: true,
        requiresExecution: true,
        urgency: "HIGH",
      };
    }
  }

  // 7. Check payload flags
  const flags = payloadRequiresPlanningOrExec(envelope.payload);
  if (flags.planning || flags.execution) {
    return {
      shouldEscalate: true,
      reason: "Message payload explicitly requests planning or execution",
      requiresPlanning: flags.planning,
      requiresExecution: flags.execution,
      urgency: "NORMAL",
    };
  }

  // Default: do not wake orchestrator for informational messages
  return {
    shouldEscalate: false,
    reason: "Message does not require planning or execution; liaison handles or drops locally",
    requiresPlanning: false,
    requiresExecution: false,
    urgency: "LOW",
  };
}

export function routeEscalation(
  envelope: MailboxEnvelope<unknown>,
  senderLiaisonId: string,
  options: RouteEscalationOptions,
): EscalationRouteResult {
  if (!envelope || typeof envelope !== "object") {
    throw new HarnessError("INVALID_ARGUMENT", "Invalid envelope provided to routeEscalation");
  }
  if (!options?.orchestratorId) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "options.orchestratorId is required for escalation routing",
    );
  }

  const evaluation = evaluateEscalation(envelope, options.planOrState);
  if (!evaluation.shouldEscalate) {
    return {
      escalated: false,
      decision: evaluation,
    };
  }

  const escalationPayload: EscalationMessagePayload = {
    sourceMessageId: envelope.id,
    sourceSenderId: envelope.sender_id,
    correlationId: envelope.correlation_id,
    reason: evaluation.reason,
    evaluation,
    originalPayload: envelope.payload,
    escalationTimestamp: new Date().toISOString(),
  };

  const messageType: MailboxMessageType =
    evaluation.urgency === "HIGH" ? "DEFECT_ESCALATION" : "DISPATCH_TASK";

  const dispatched = dispatchPeerMessage<EscalationMessagePayload>({
    senderId: senderLiaisonId,
    senderRole: "liaison",
    recipientRoleOrId: options.orchestratorId,
    messageType,
    payload: escalationPayload,
    correlationId: envelope.correlation_id,
    ...(options.baseDir !== undefined ? { baseDir: options.baseDir } : {}),
    ...(options.secretKey !== undefined ? { secretKey: options.secretKey } : {}),
  });

  return {
    escalated: true,
    decision: evaluation,
    dispatchedEnvelopeId: dispatched.id,
  };
}
