import type {
  AssemblyStation,
  ConcurrencyAuditResult,
  StragglerAssessment,
} from "../preplanning/types.ts";
import { calculateBrentDecomposition } from "../../orchestrator/velocity-rebalancer.ts";

export const SKILL_CONCURRENCY_UNDER_SATURATED = "SKILL_CONCURRENCY_UNDER_SATURATED" as const;
export const UNSTAGED_STATION_DURABILITY_RISK = "UNSTAGED_STATION_DURABILITY_RISK" as const;

export interface ConcurrencyAuditOptions {
  readonly activeStations?: readonly AssemblyStation[] | undefined;
  readonly totalWorkUnits?: number | undefined;
  readonly spanLength?: number | undefined;
  readonly stragglingAssessments?: readonly StragglerAssessment[] | undefined;
  readonly minSaturationRatio?: number | undefined;
}

export function auditSkillConcurrencySaturation(
  options?: ConcurrencyAuditOptions | undefined,
): ConcurrencyAuditResult {
  const stations = options?.activeStations ?? [];
  const remainingWorkUnits = stations.filter(
    (s) => s.status !== "LANDED" && s.status !== "FAILED",
  ).length;
  const totalWorkUnits = Math.max(0, options?.totalWorkUnits ?? remainingWorkUnits);
  const spanLength = Math.max(1, options?.spanLength ?? 1);
  const minRatio = options?.minSaturationRatio ?? 0.8;

  const optimalPlan = calculateBrentDecomposition({
    workUnits: totalWorkUnits,
    spanLength,
  });

  const optimalConcurrency = optimalPlan.optimal_parallelism;

  // Active workers are stations currently in progress
  const activeWorkers = stations.filter(
    (s) => s.status === "IN_PROGRESS" || s.status === "VERIFIED",
  ).length;

  const saturationRatio =
    optimalConcurrency === 0 ? 1 : Number((activeWorkers / optimalConcurrency).toFixed(2));

  const findings: string[] = [];
  const warnings: string[] = [];
  const unstagedStations: string[] = [];
  const stragglingTasks: string[] = [];

  // 1. Concurrency Saturation Check
  if (totalWorkUnits >= 5 && activeWorkers < optimalConcurrency && saturationRatio < minRatio) {
    findings.push(
      `${SKILL_CONCURRENCY_UNDER_SATURATED}: Workload of ${totalWorkUnits} units requires ${optimalConcurrency} parallel workers (P = ⌈W/S⌉), but only ${activeWorkers} active (${(saturationRatio * 100).toFixed(0)}% saturation).`,
    );
  }

  // 2. Subdomain Git Staging Durability Check
  for (const station of stations) {
    if (station.status === "LANDED" || station.status === "VERIFIED") {
      if (!station.staging_record || !station.staging_record.git_index_sha) {
        unstagedStations.push(station.station_id);
        findings.push(
          `${UNSTAGED_STATION_DURABILITY_RISK}: Station ${station.station_id} in domain ${station.domain} reached ${station.status} without Git staging invariant record.`,
        );
      }
    }
  }

  // 3. Straggler Task Saturation Check
  if (options?.stragglingAssessments) {
    for (const assessment of options.stragglingAssessments) {
      if (assessment.is_straggler) {
        stragglingTasks.push(assessment.task_id);
        warnings.push(
          `Straggler task ${assessment.task_id} (elapsed ${assessment.elapsed_seconds.toFixed(1)}s) requires dynamic decomposition.`,
        );
      }
    }
  }

  const isSaturated =
    (optimalConcurrency === 0 || saturationRatio >= minRatio) &&
    unstagedStations.length === 0 &&
    stragglingTasks.length === 0;

  if (isSaturated && findings.length === 0) {
    findings.push(
      "Skill concurrency is fully saturated; all assembly stations and workers are compliant.",
    );
  }

  return {
    is_saturated: isSaturated,
    active_workers: activeWorkers,
    optimal_concurrency: optimalConcurrency,
    saturation_ratio: saturationRatio,
    unstaged_stations: Object.freeze(unstagedStations),
    straggling_tasks: Object.freeze(stragglingTasks),
    findings: Object.freeze(findings),
    warnings: Object.freeze(warnings),
  };
}
