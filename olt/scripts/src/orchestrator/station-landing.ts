import type {
  AssemblyStation,
  AssemblyStationStatus,
  DomainCategory,
  GitStagingInvariantRecord,
} from "../mind/preplanning/types.ts";
import { executeGitStagingInvariant, type GitStagingOptions } from "./subdomain-staging.ts";
import {
  notifyPhaseCompletion,
  type NotificationResult,
  type PhaseCompletionNotificationOptions,
} from "../reporting/notifications/index.ts";
import {
  executeLifecycleHooks,
  type LifecycleHookExecutionResult,
  type RepoPolicy,
} from "../policy/index.ts";

export interface StationLandingOptions extends GitStagingOptions {
  readonly phaseName?: string | undefined;
  readonly startedAt?: number | undefined;
  readonly commitSha?: string | undefined;
  readonly taskCount?: number | undefined;
  readonly soundEnabled?: boolean | undefined;
  readonly notify?: boolean | undefined;
  readonly customNotifier?:
    | ((opts: PhaseCompletionNotificationOptions) => NotificationResult)
    | undefined;
  readonly policy?: RepoPolicy | undefined;
  readonly customHookExecutor?: typeof executeLifecycleHooks | undefined;
}

export interface PhaseLandingOptions {
  readonly phaseName: string;
  readonly startedAt: number;
  readonly commitSha?: string | undefined;
  readonly taskCount?: number | undefined;
  readonly soundEnabled?: boolean | undefined;
  readonly notify?: boolean | undefined;
  readonly customNotifier?:
    | ((opts: PhaseCompletionNotificationOptions) => NotificationResult)
    | undefined;
  readonly policy?: RepoPolicy | undefined;
  readonly customHookExecutor?: typeof executeLifecycleHooks | undefined;
  readonly rootDir?: string | undefined;
}

export interface LandStationResult {
  readonly station: AssemblyStation;
  readonly stagingRecord: GitStagingInvariantRecord;
  readonly notificationResult?: NotificationResult | undefined;
  readonly durationMs?: number | undefined;
  readonly hookExecutionResult?: LifecycleHookExecutionResult | undefined;
}

export interface PhaseLandingResult {
  readonly success: boolean;
  readonly durationMs: number;
  readonly notificationResult?: NotificationResult | undefined;
  readonly station?: AssemblyStation | undefined;
  readonly stagingRecord?: GitStagingInvariantRecord | undefined;
  readonly hookExecutionResult?: LifecycleHookExecutionResult | undefined;
}

function dispatchPhaseCompletionHook(
  hookExecutor: typeof executeLifecycleHooks | undefined,
  context: {
    readonly phaseName: string;
    readonly commitSha?: string | undefined;
    readonly taskCount?: number | undefined;
    readonly durationMs: number;
    readonly status: string;
  },
  rootDir?: string | undefined,
  policy?: RepoPolicy | undefined,
): LifecycleHookExecutionResult {
  const executor = hookExecutor ?? executeLifecycleHooks;
  try {
    return executor({
      event: "on_phase_completion",
      context,
      repoRoot: rootDir,
      policy,
    });
  } catch (err) {
    return {
      event: "on_phase_completion",
      commandCount: 0,
      executedCommands: [],
      records: [],
      skipped: false,
      errors: [err instanceof Error ? err.message : String(err)],
      success: false,
    };
  }
}

export function createStation(
  stationId: string,
  domain: DomainCategory,
  milestoneId: string,
  assignedFiles: readonly string[],
): AssemblyStation {
  return {
    station_id: stationId,
    domain,
    milestone_id: milestoneId,
    assigned_files: Object.freeze([...assignedFiles]),
    status: "PENDING",
  };
}

export function claimStation(station: AssemblyStation): AssemblyStation {
  if (station.status !== "PENDING") {
    throw new Error(`Cannot claim station ${station.station_id} with status ${station.status}`);
  }
  return {
    ...station,
    status: "IN_PROGRESS",
    claimed_at: new Date().toISOString(),
  };
}

export function verifyStation(
  station: AssemblyStation,
  testProof?: { testPath: string; passed: boolean } | undefined,
): AssemblyStation {
  if (station.status !== "IN_PROGRESS") {
    throw new Error(`Cannot verify station ${station.station_id} with status ${station.status}`);
  }
  if (testProof && !testProof.passed) {
    return { ...station, status: "FAILED" };
  }
  return {
    ...station,
    status: "VERIFIED",
    verified_at: new Date().toISOString(),
  };
}

export function landStation(
  station: AssemblyStation,
  stagingOptions?: StationLandingOptions | undefined,
): LandStationResult {
  if (station.status !== "VERIFIED") {
    throw new Error(
      `Cannot land station ${station.station_id} before verification (current status: ${station.status})`,
    );
  }

  const stagingRecord = executeGitStagingInvariant({
    milestoneId: station.milestone_id,
    subdomain: station.domain,
    filesToStage: station.assigned_files,
    rootDir: stagingOptions?.rootDir,
    customGitRunner: stagingOptions?.customGitRunner,
  });

  const landedStation: AssemblyStation = {
    ...station,
    status: "LANDED",
    landed_at: stagingRecord.staged_at,
    staging_record: stagingRecord,
  };

  const rawStartedAt =
    stagingOptions?.startedAt ??
    (station.claimed_at ? Date.parse(station.claimed_at) : undefined) ??
    Date.now();
  const startedAt = Number.isFinite(rawStartedAt) ? rawStartedAt : Date.now();
  const durationMs = Math.max(0, Date.now() - startedAt);
  const phaseName = stagingOptions?.phaseName ?? `${station.domain} (${station.milestone_id})`;
  const commitSha = stagingOptions?.commitSha ?? stagingRecord.git_index_sha;
  const taskCount = stagingOptions?.taskCount ?? station.assigned_files.length;

  let notificationResult: NotificationResult | undefined;
  if (stagingOptions?.notify) {
    const notifier = stagingOptions.customNotifier ?? notifyPhaseCompletion;
    notificationResult = notifier({
      phaseName,
      commitSha,
      taskCount,
      durationMs,
      soundEnabled: stagingOptions.soundEnabled ?? true,
    });
  }

  const hookExecutionResult = dispatchPhaseCompletionHook(
    stagingOptions?.customHookExecutor,
    { phaseName, commitSha, taskCount, durationMs, status: "SUCCESS" },
    stagingOptions?.rootDir,
    stagingOptions?.policy,
  );

  return {
    station: landedStation,
    stagingRecord,
    ...(notificationResult ? { notificationResult } : {}),
    ...(stagingOptions?.notify || stagingOptions?.startedAt !== undefined ? { durationMs } : {}),
    hookExecutionResult,
  };
}

export function landPhaseRelease(options: PhaseLandingOptions): PhaseLandingResult {
  const durationMs = Math.max(0, Date.now() - options.startedAt);
  let notificationResult: NotificationResult | undefined;

  if (options.notify ?? true) {
    const notifier = options.customNotifier ?? notifyPhaseCompletion;
    notificationResult = notifier({
      phaseName: options.phaseName,
      commitSha: options.commitSha,
      taskCount: options.taskCount,
      durationMs,
      soundEnabled: options.soundEnabled ?? true,
    });
  }

  const hookExecutionResult = dispatchPhaseCompletionHook(
    options.customHookExecutor,
    {
      phaseName: options.phaseName,
      commitSha: options.commitSha,
      taskCount: options.taskCount,
      durationMs,
      status: "SUCCESS",
    },
    options.rootDir,
    options.policy,
  );

  return {
    success: true,
    durationMs,
    ...(notificationResult ? { notificationResult } : {}),
    hookExecutionResult,
  };
}

export interface AssemblyPipelineStatus {
  readonly total_stations: number;
  readonly pending_stations: number;
  readonly in_progress_stations: number;
  readonly verified_stations: number;
  readonly landed_stations: number;
  readonly failed_stations: number;
  readonly is_all_landed: boolean;
  readonly stations: readonly AssemblyStation[];
}

export class AssemblyStationRegistry {
  private readonly stations = new Map<string, AssemblyStation>();

  public registerStation(station: AssemblyStation): void {
    this.stations.set(station.station_id, station);
  }

  public getStation(stationId: string): AssemblyStation | undefined {
    return this.stations.get(stationId);
  }

  public getAllStations(): readonly AssemblyStation[] {
    return Object.freeze(Array.from(this.stations.values()));
  }

  public updateStation(station: AssemblyStation): void {
    this.stations.set(station.station_id, station);
  }

  public getStatus(): AssemblyPipelineStatus {
    const all = Array.from(this.stations.values());
    const total = all.length;
    let pending = 0;
    let inProgress = 0;
    let verified = 0;
    let landed = 0;
    let failed = 0;

    for (const st of all) {
      if (st.status === "PENDING") pending++;
      else if (st.status === "IN_PROGRESS") inProgress++;
      else if (st.status === "VERIFIED") verified++;
      else if (st.status === "LANDED") landed++;
      else if (st.status === "FAILED") failed++;
    }

    return {
      total_stations: total,
      pending_stations: pending,
      in_progress_stations: inProgress,
      verified_stations: verified,
      landed_stations: landed,
      failed_stations: failed,
      is_all_landed: total > 0 && landed === total,
      stations: Object.freeze(all),
    };
  }
}
