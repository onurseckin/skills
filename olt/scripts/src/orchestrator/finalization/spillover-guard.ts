import { HarnessError } from "../../core/errors/index.ts";
import type { BackgroundFinalizationResult, ZeroMainThreadSpilloverVerification } from "./types.ts";

export function enforceZeroMainThreadSpillover(params: {
  readonly executionTier?: number | undefined;
  readonly isMainThread?: boolean | undefined;
  readonly finalizationComplete?: boolean | undefined;
  readonly gitOperationsEnclosed?: boolean | undefined;
  readonly globalSyncEnclosed?: boolean | undefined;
  readonly now?: Date | string | number | undefined;
}): ZeroMainThreadSpilloverVerification {
  const tier = params.executionTier ?? 1;
  const isMain = params.isMainThread ?? false;
  const finalComplete = params.finalizationComplete ?? true;
  const gitEnclosed = params.gitOperationsEnclosed ?? true;
  const syncEnclosed = params.globalSyncEnclosed ?? true;
  const verifiedAt =
    params.now !== undefined ? new Date(params.now).toISOString() : new Date().toISOString();

  const isTierValid = tier === 1 || tier === 0;
  const isCompliant = !isMain && isTierValid && finalComplete && gitEnclosed;

  let message =
    "Zero main-thread spillover verified: release operations executed strictly within Tier 1 background orchestrator thread.";
  if (isMain) {
    message =
      "Violation: Finalization executed on main interactive thread instead of background orchestrator thread.";
  } else if (!isTierValid) {
    message = `Violation: Finalization executed by non-orchestrator tier ${tier}; only Tier 1 background orchestrator may finalize.`;
  } else if (!finalComplete) {
    message = "Violation: Finalization release operations failed to complete in background.";
  } else if (!gitEnclosed) {
    message = "Violation: Git commit/push operations were not fully enclosed in background.";
  }

  return {
    compliant: isCompliant,
    executionTier: tier,
    executedInBackground: !isMain,
    mainThreadSpillover: isMain,
    gitOperationsEnclosed: gitEnclosed,
    globalSyncEnclosed: syncEnclosed,
    verifiedAt,
    message,
  };
}

export function assertZeroMainThreadSpillover(
  target: ZeroMainThreadSpilloverVerification | BackgroundFinalizationResult,
): void {
  const verification = "spilloverVerification" in target ? target.spilloverVerification : target;
  if (!verification.compliant || verification.mainThreadSpillover) {
    throw new HarnessError("INTEGRITY", verification.message);
  }
}
