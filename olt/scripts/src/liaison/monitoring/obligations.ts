import type {
  BindingState,
  ObligationBindingProof,
  ObligationDirective,
  ObligationStateItem,
  SystemObligationSummary,
} from "./types.ts";

export interface ObligationEvaluationInput {
  readonly directive: ObligationDirective;
  readonly deliveredAt?: string | null | undefined;
  readonly boundAt?: string | null | undefined;
  readonly proof?: ObligationBindingProof | null | undefined;
  readonly refusalReason?: string | null | undefined;
}

/**
 * Checks whether a named path is covered by a given write scope directory or file path.
 */
export function isPathInScope(namedPath: string, scopePath: string): boolean {
  const normNamed = namedPath.trim().replace(/\/+$/, "");
  const normScope = scopePath.trim().replace(/\/+$/, "");

  if (normNamed === normScope) {
    return true;
  }
  return normNamed.startsWith(normScope + "/");
}

/**
 * Verifies whether all named paths in a directive are covered by the bound scope paths,
 * or whether valid artifact/commit proof is attached (protocol.md §2).
 */
export function verifyBindingProof(
  namedPaths: readonly string[],
  proof: ObligationBindingProof | null | undefined,
): boolean {
  if (!proof) {
    return false;
  }

  if (proof.artifactPath !== undefined && proof.artifactPath.trim().length > 0) {
    return true;
  }

  if (proof.commitHash !== undefined && proof.commitHash.trim().length > 0) {
    return true;
  }

  const scopes = proof.boundScopePaths ?? [];
  if (namedPaths.length === 0) {
    return (proof.taskId !== undefined && proof.taskId.length > 0) || scopes.length > 0;
  }

  return namedPaths.every((named) => scopes.some((scope) => isPathInScope(named, scope)));
}

/**
 * Evaluates the lifecycle state of an obligation relative to current time.
 */
export function evaluateObligation(
  input: ObligationEvaluationInput,
  nowInput?: Date | string | undefined,
): ObligationStateItem {
  const now =
    nowInput instanceof Date
      ? nowInput
      : typeof nowInput === "string"
        ? new Date(nowInput)
        : new Date();

  const directive = input.directive;
  const deliveredAt = input.deliveredAt ?? null;
  const boundAt = input.boundAt ?? null;
  const proof = input.proof ?? null;
  const refusalReason = input.refusalReason ?? null;

  const baselineTime = deliveredAt
    ? new Date(deliveredAt).getTime()
    : new Date(directive.timestamp).getTime();
  const elapsedMs = Math.max(0, now.getTime() - baselineTime);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  let bindingState: BindingState;
  let isOverdue = false;

  if (refusalReason !== null && refusalReason.trim().length > 0) {
    bindingState = "refused";
  } else if (boundAt !== null) {
    bindingState = "bound";
  } else {
    if (elapsedSeconds > directive.overdueWindowSeconds) {
      bindingState = "overdue";
      isOverdue = true;
    } else {
      bindingState = "delivered";
    }
  }

  return Object.freeze({
    directive,
    bindingState,
    deliveredAt,
    boundAt,
    proof,
    refusalReason,
    isOverdue,
    elapsedSeconds,
  });
}

/**
 * Summarizes a collection of obligations into aggregate metrics.
 */
export function summarizeObligations(
  obligations: readonly ObligationStateItem[],
): SystemObligationSummary {
  const immutableList = Object.freeze([...obligations]);

  let boundCount = 0;
  let refusedCount = 0;
  let overdueCount = 0;
  let deliveredCount = 0;

  for (const item of immutableList) {
    switch (item.bindingState) {
      case "bound":
        boundCount++;
        break;
      case "refused":
        refusedCount++;
        break;
      case "overdue":
        overdueCount++;
        break;
      case "delivered":
        deliveredCount++;
        break;
    }
  }

  return Object.freeze({
    obligations: immutableList,
    totalObligations: immutableList.length,
    openCount: deliveredCount + overdueCount,
    boundCount,
    refusedCount,
    overdueCount,
  });
}

/**
 * Filters obligations by binding state.
 */
export function filterObligationsByState(
  obligations: readonly ObligationStateItem[],
  state: BindingState,
): readonly ObligationStateItem[] {
  return Object.freeze(obligations.filter((o) => o.bindingState === state));
}
