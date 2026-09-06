import { HarnessError } from "../../core/errors/index.ts";
import type {
  DirectivePayload,
  LaneScope,
  ObligationBindingProof,
  ObligationPathCheck,
  ObligationVerificationResult,
  PlanOrState,
} from "./types.ts";

export function normalizePath(path: string): string {
  if (typeof path !== "string") return "";
  let normalized = path.trim().replace(/\\/g, "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  while (normalized.endsWith("/") && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function isPathCovered(targetPath: string, scopePattern: string): boolean {
  const normTarget = normalizePath(targetPath);
  const normPattern = normalizePath(scopePattern);

  if (!normTarget || !normPattern) return false;
  if (normTarget === normPattern) return true;

  if (normPattern.includes("*")) {
    const escaped = normPattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, ".*")
      .replace(/(?<!\.)\*/g, "[^/]*");
    const regex = new RegExp(`^${escaped}$`);
    return regex.test(normTarget);
  }

  return normTarget.startsWith(`${normPattern}/`);
}

export function findCoveringLane(
  targetPath: string,
  lanes: readonly LaneScope[],
): { readonly lane: LaneScope; readonly matchedScope: string } | null {
  for (const lane of lanes) {
    for (const scopeItem of lane.writeScope) {
      if (isPathCovered(targetPath, scopeItem)) {
        return { lane, matchedScope: scopeItem };
      }
    }
  }
  return null;
}

export function verifyObligationScope(
  directive: DirectivePayload,
  planOrState: PlanOrState,
): ObligationVerificationResult {
  if (!directive || typeof directive !== "object") {
    throw new HarnessError("INVALID_ARGUMENT", "directive must be a valid DirectivePayload");
  }
  if (!planOrState || typeof planOrState !== "object" || !Array.isArray(planOrState.lanes)) {
    throw new HarnessError("INVALID_ARGUMENT", "planOrState must contain a valid lanes array");
  }

  const pathChecks: ObligationPathCheck[] = [];
  const boundLanesMap = new Map<string, LaneScope>();
  const unboundPaths: string[] = [];
  const bindings: { readonly path: string; readonly laneId: string }[] = [];

  for (const rawPath of directive.targetPaths) {
    const normPath = normalizePath(rawPath);
    const match = findCoveringLane(normPath, planOrState.lanes);

    if (match) {
      pathChecks.push({
        path: normPath,
        isCovered: true,
        coveredByLaneId: match.lane.laneId,
        coveredByRunId: match.lane.runId,
        matchedPattern: match.matchedScope,
      });
      boundLanesMap.set(match.lane.laneId, match.lane);
      bindings.push({ path: normPath, laneId: match.lane.laneId });
    } else {
      pathChecks.push({
        path: normPath,
        isCovered: false,
      });
      unboundPaths.push(normPath);
    }
  }

  const totalPaths = directive.targetPaths.length;
  const boundCount = bindings.length;
  const isFullyBound = totalPaths > 0 && boundCount === totalPaths;
  const isPartiallyBound = boundCount > 0 && boundCount < totalPaths;
  const isUnbound = boundCount === 0;

  if (isFullyBound) {
    const proof: ObligationBindingProof = {
      runId: planOrState.runId,
      bindings,
    };
    return {
      directiveId: directive.directiveId,
      isFullyBound: true,
      isPartiallyBound: false,
      isUnbound: false,
      pathChecks,
      boundLanes: Array.from(boundLanesMap.values()),
      unboundPaths: [],
      receiptType: "RECEIPT_BOUND",
      proof,
    };
  }

  const reason =
    unboundPaths.length > 0
      ? `Paths [${unboundPaths.join(", ")}] do not reside in any assigned lane write scope for run '${planOrState.runId}'`
      : "Directive contains no target paths to bind";

  return {
    directiveId: directive.directiveId,
    isFullyBound: false,
    isPartiallyBound,
    isUnbound,
    pathChecks,
    boundLanes: Array.from(boundLanesMap.values()),
    unboundPaths,
    receiptType: "RECEIPT_REFUSED",
    refusalReason: reason,
  };
}

export function createDeliveredReceiptPayload(
  messageId: string,
  correlationId: string,
  timestamp: string = new Date().toISOString(),
): Record<string, unknown> {
  return {
    type: "RECEIPT_DELIVERED",
    message_id: messageId,
    correlation_id: correlationId,
    read_timestamp: timestamp,
  };
}

export function createBoundReceiptPayload(
  directiveId: string,
  correlationId: string,
  proof: ObligationBindingProof,
  timestamp: string = new Date().toISOString(),
): Record<string, unknown> {
  return {
    type: "RECEIPT_BOUND",
    directive_id: directiveId,
    correlation_id: correlationId,
    bound_timestamp: timestamp,
    proof,
  };
}

export function createRefusedReceiptPayload(
  directiveId: string,
  correlationId: string,
  unboundPaths: readonly string[],
  reason: string,
  timestamp: string = new Date().toISOString(),
): Record<string, unknown> {
  return {
    type: "RECEIPT_REFUSED",
    directive_id: directiveId,
    correlation_id: correlationId,
    refused_timestamp: timestamp,
    unbound_paths: unboundPaths,
    reason,
  };
}
