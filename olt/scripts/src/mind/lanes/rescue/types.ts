import type { Clock } from "../../../workflow/types.ts";

export interface RescueLaneOptions {
  readonly actor?: string;
  readonly now?: number | Date | string;
  readonly home?: string;
  readonly grantIdleSeconds?: number;
  readonly graceSeconds?: number;
  readonly targetRunRoots?: readonly string[];
  readonly runtimeFreshnessOverride?: {
    readonly drifted: boolean;
    readonly referenceRuntimeVersion: string;
  };
  readonly clock?: Clock;
}

export interface Rung0Result {
  readonly charterDrifted: boolean;
  readonly runtimeDrifted: boolean;
  readonly integrityRepaired: boolean;
  readonly integrityFailed: boolean;
  readonly readRaceRetried: boolean;
  readonly halted: boolean;
  readonly haltReason?: string;
}

export interface Rung1Result {
  readonly liveRunsChecked: number;
  readonly supervisionTicksRun: number;
  readonly skippedDueToActiveCoordinator: readonly string[];
  readonly reclaimedLeasesCount: number;
  readonly escalatedTasksCount: number;
}

export interface Rung2Result {
  readonly abandonedAttempts: readonly {
    readonly runId: string;
    readonly taskId: string;
    readonly agentId?: string;
  }[];
  readonly orphanEvidenceEscalated: readonly {
    readonly runId: string;
    readonly evidenceCount: number;
  }[];
  readonly worktreesReclaimed: readonly {
    readonly runId: string;
    readonly worktreeIds: readonly string[];
  }[];
}

export interface Rung3Result {
  readonly deadAgentsReleased: readonly {
    readonly runId: string;
    readonly agentId: string;
    readonly role: string;
    readonly idleSeconds: number;
  }[];
}

export interface Rung4Result {
  readonly deadPulseReclaimed: boolean;
  readonly reclaimedPulseId?: string;
  readonly consecutiveCrashes: number;
  readonly halted: boolean;
  readonly haltReason?: string;
}

export interface Rung5Result {
  readonly gapExceeded: boolean;
  readonly gapMs?: number;
  readonly armedIntervalMs?: number;
  readonly driverLatenessMs?: number;
  readonly notified: boolean;
}

export interface RescueLaneResult {
  readonly outcome: "rescued" | "halted" | "quiescent";
  readonly rungs: {
    readonly rung0: Rung0Result;
    readonly rung1: Rung1Result;
    readonly rung2: Rung2Result;
    readonly rung3: Rung3Result;
    readonly rung4: Rung4Result;
    readonly rung5: Rung5Result;
  };
  readonly halted: boolean;
  readonly haltReason?: string;
  readonly actionsTaken: readonly string[];
  readonly escalations: readonly string[];
  readonly summary: string;
}
