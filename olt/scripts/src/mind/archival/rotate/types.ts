import type { ArchivedObjectiveRecord } from "../types.ts";

export interface RotateMindOptions {
  readonly sourceRunRoot: string;
  readonly targetRunId?: string | undefined;
  readonly nextRunId?: string | undefined;
  readonly targetRunRoot?: string | undefined;
  readonly nextRunRoot?: string | undefined;
  readonly charterSourcePath?: string | undefined;
  readonly actor?: string | undefined;
  readonly capsulesDir?: string | undefined;
  readonly now?: string | number | Date | undefined;
}

export interface RotateMindResult {
  readonly sourceRunRoot: string;
  readonly sourceRunId: string;
  readonly targetRunRoot: string;
  readonly targetRunId: string;
  readonly sourceGeneration: number;
  readonly targetGeneration: number;
  readonly charterSha256: string;
  readonly charterSourcePath: string;
  readonly previousEventHead: string | null;
  readonly pulseCounter: number;
  readonly carriedCandidates: readonly Record<string, unknown>[];
  readonly openCandidatesCount: number;
  readonly declinedCandidatesCount: number;
  readonly archivedRecords: readonly ArchivedObjectiveRecord[];
  readonly archivedCount: number;
  readonly carriedObjectives: readonly Record<string, unknown>[];
  readonly carriedGrantsCount: number;
  readonly rotatedAt: string;
}
