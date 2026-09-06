import { dispatchPeerMessage } from "../../communication/mailbox/mailbox-dispatcher.ts";
import type { MailboxEnvelope } from "../../communication/types.ts";
import { HarnessError } from "../../core/errors/index.ts";
import type {
  LiaisonAgentId,
  LiaisonStateProvider,
  PeerQueryRequest,
  PeerQueryResponse,
  PeerQueryType,
} from "./types.ts";

const VALID_QUERY_TYPES = new Set<PeerQueryType>([
  "LIVENESS",
  "RUN_STATE",
  "LANE_STATUS",
  "ROSTER",
  "OBLIGATIONS",
  "METRICS",
  "PING",
]);

export function isPeerStateQuery(envelope: MailboxEnvelope<unknown>): boolean {
  if (!envelope || typeof envelope !== "object") return false;
  const p = envelope.payload;
  if (!p || typeof p !== "object") return false;
  const rec = p as Record<string, unknown>;
  const rawType = rec.queryType ?? rec.query_type;
  return typeof rawType === "string" && VALID_QUERY_TYPES.has(rawType as PeerQueryType);
}

export function parsePeerQuery(envelope: MailboxEnvelope<unknown>): PeerQueryRequest {
  if (!isPeerStateQuery(envelope)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Envelope does not contain a valid peer state query",
    );
  }
  const p = envelope.payload as Record<string, unknown>;
  const rawType = ((p.queryType ?? p.query_type) as string).toUpperCase() as PeerQueryType;
  const queryId = typeof p.queryId === "string" ? p.queryId : envelope.id;
  const targetId = typeof p.targetId === "string" ? p.targetId : undefined;

  return {
    queryId,
    senderId: envelope.sender_id,
    queryType: rawType,
    ...(targetId ? { targetId } : {}),
    timestamp: envelope.timestamp,
  };
}

export function answerPeerStateQuery(
  query: PeerQueryRequest,
  stateProvider: LiaisonStateProvider,
  liaisonId: LiaisonAgentId,
): PeerQueryResponse {
  const timestamp = new Date().toISOString();

  switch (query.queryType) {
    case "PING":
    case "LIVENESS": {
      const liveness = stateProvider.getLiveness();
      return {
        queryId: query.queryId,
        responderId: liaisonId,
        success: true,
        timestamp,
        payload: {
          status: "alive",
          responderId: liaisonId,
          liveness,
        },
      };
    }

    case "RUN_STATE": {
      const runState = stateProvider.getRunState(query.targetId);
      if (!runState) {
        return {
          queryId: query.queryId,
          responderId: liaisonId,
          success: false,
          timestamp,
          payload: {},
          error: `Run state not found for target '${query.targetId ?? "active"}'`,
        };
      }
      return {
        queryId: query.queryId,
        responderId: liaisonId,
        success: true,
        timestamp,
        payload: runState,
      };
    }

    case "LANE_STATUS": {
      if (!query.targetId) {
        return {
          queryId: query.queryId,
          responderId: liaisonId,
          success: false,
          timestamp,
          payload: {},
          error: "Missing targetId for LANE_STATUS query",
        };
      }
      const laneStatus = stateProvider.getLaneStatus(query.targetId);
      if (!laneStatus) {
        return {
          queryId: query.queryId,
          responderId: liaisonId,
          success: false,
          timestamp,
          payload: {},
          error: `Lane '${query.targetId}' not found in state`,
        };
      }
      return {
        queryId: query.queryId,
        responderId: liaisonId,
        success: true,
        timestamp,
        payload: laneStatus,
      };
    }

    case "ROSTER": {
      const roster = stateProvider.getRoster();
      return {
        queryId: query.queryId,
        responderId: liaisonId,
        success: true,
        timestamp,
        payload: { roster },
      };
    }

    case "OBLIGATIONS": {
      if (!query.targetId) {
        return {
          queryId: query.queryId,
          responderId: liaisonId,
          success: false,
          timestamp,
          payload: {},
          error: "Missing targetId for OBLIGATIONS query",
        };
      }
      const obligationStatus = stateProvider.getObligationStatus(query.targetId);
      if (!obligationStatus) {
        return {
          queryId: query.queryId,
          responderId: liaisonId,
          success: false,
          timestamp,
          payload: {},
          error: `Obligation '${query.targetId}' not found`,
        };
      }
      return {
        queryId: query.queryId,
        responderId: liaisonId,
        success: true,
        timestamp,
        payload: obligationStatus,
      };
    }

    case "METRICS": {
      const metrics = stateProvider.getMetrics();
      return {
        queryId: query.queryId,
        responderId: liaisonId,
        success: true,
        timestamp,
        payload: metrics,
      };
    }

    default: {
      return {
        queryId: query.queryId,
        responderId: liaisonId,
        success: false,
        timestamp,
        payload: {},
        error: `Unsupported query type '${query.queryType}'`,
      };
    }
  }
}

export function dispatchPeerStateResponse(
  response: PeerQueryResponse,
  liaisonId: LiaisonAgentId,
  recipientId: string,
  opts?: {
    readonly baseDir?: string;
    readonly secretKey?: string;
    readonly correlationId?: string;
  },
): MailboxEnvelope<PeerQueryResponse> {
  return dispatchPeerMessage<PeerQueryResponse>({
    senderId: liaisonId,
    senderRole: "liaison",
    recipientRoleOrId: recipientId,
    messageType: "HANDOFF_RECEIPT",
    payload: response,
    correlationId: opts?.correlationId ?? response.queryId,
    ...(opts?.baseDir !== undefined ? { baseDir: opts.baseDir } : {}),
    ...(opts?.secretKey !== undefined ? { secretKey: opts.secretKey } : {}),
  });
}
