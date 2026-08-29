import { MAX_REPAIR_ROUNDS } from "../../core/config/contracts.ts";
import type {
  CoordinatorPushbackCause,
  TaskStatus,
  ValidatorDomain,
} from "../../core/contracts/index.ts";
import type { PushbackHistory, PushbackRoundRecord } from "./types.ts";

export function createPushbackHistory(
  taskId: string,
  maxRepairRounds: number = MAX_REPAIR_ROUNDS,
): PushbackHistory {
  return {
    taskId,
    currentRound: 0,
    maxRepairRounds,
    rounds: [],
    isExhausted: false,
    unresolvedRejectionReasons: [],
  };
}

export function appendPushbackRound(
  history: PushbackHistory,
  roundData: {
    readonly round?: number | undefined;
    readonly timestamp?: string | undefined;
    readonly coordinatorId: string;
    readonly validatorId: string;
    readonly domain: ValidatorDomain;
    readonly cause: CoordinatorPushbackCause;
    readonly observation: string;
    readonly remediation: string;
    readonly rejectionReasons?: readonly string[] | undefined;
    readonly previousEvidenceDigest?: string | undefined;
    readonly previousEvidenceSummary?: string | undefined;
    readonly correctiveGuidance?: readonly string[] | undefined;
    readonly statusAfter?: TaskStatus | undefined;
  },
): PushbackHistory {
  const roundNumber = roundData.round ?? history.currentRound + 1;
  const timestamp = roundData.timestamp ?? new Date().toISOString();
  const id = `cpb-${history.taskId}-r${roundNumber}-${Date.now().toString(36)}`;
  const statusAfter: TaskStatus =
    roundData.statusAfter ??
    (roundData.cause === "procedural"
      ? "validating"
      : roundNumber >= history.maxRepairRounds
        ? "escalated"
        : "changes_requested");

  const rejectionReasons = roundData.rejectionReasons ?? [];
  const correctiveGuidance = roundData.correctiveGuidance ?? [
    `Address observation in round ${roundNumber}: ${roundData.observation}`,
    `Remediation required: ${roundData.remediation}`,
  ];

  const roundRecord: PushbackRoundRecord = {
    round: roundNumber,
    id,
    timestamp,
    coordinatorId: roundData.coordinatorId,
    validatorId: roundData.validatorId,
    domain: roundData.domain,
    cause: roundData.cause,
    observation: roundData.observation,
    remediation: roundData.remediation,
    rejectionReasons,
    previousEvidenceDigest: roundData.previousEvidenceDigest,
    previousEvidenceSummary: roundData.previousEvidenceSummary,
    correctiveGuidance,
    statusAfter,
  };

  const updatedRounds = [...history.rounds, roundRecord];
  const isExhausted = roundNumber >= history.maxRepairRounds && roundData.cause === "substantive";

  return {
    taskId: history.taskId,
    currentRound: roundNumber,
    maxRepairRounds: history.maxRepairRounds,
    rounds: updatedRounds,
    isExhausted,
    lastCause: roundData.cause,
    unresolvedRejectionReasons: rejectionReasons,
  };
}
