import type {
  AssemblyStation,
  AssemblyStationStatus,
  DomainCategory,
  GitStagingInvariantRecord,
} from "../mind/preplanning/types.ts";
import { executeGitStagingInvariant, type GitStagingOptions } from "./subdomain-staging.ts";

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
    return {
      ...station,
      status: "FAILED",
    };
  }

  return {
    ...station,
    status: "VERIFIED",
    verified_at: new Date().toISOString(),
  };
}

export function landStation(
  station: AssemblyStation,
  stagingOptions?: GitStagingOptions | undefined,
): { station: AssemblyStation; stagingRecord: GitStagingInvariantRecord } {
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

  return {
    station: landedStation,
    stagingRecord,
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
      switch (st.status) {
        case "PENDING":
          pending++;
          break;
        case "IN_PROGRESS":
          inProgress++;
          break;
        case "VERIFIED":
          verified++;
          break;
        case "LANDED":
          landed++;
          break;
        case "FAILED":
          failed++;
          break;
      }
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
