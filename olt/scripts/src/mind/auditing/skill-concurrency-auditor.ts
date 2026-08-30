import type {
  AssemblyStation,
  ConcurrencyAuditResult,
  StragglerAssessment,
} from "../preplanning/types.ts";
import { calculateBrentDecomposition } from "../../orchestrator/velocity-rebalancer.ts";

export const SKILL_CONCURRENCY_UNDER_SATURATED = "SKILL_CONCURRENCY_UNDER_SATURATED" as const;
export const UNSTAGED_STATION_DURABILITY_RISK = "UNSTAGED_STATION_DURABILITY_RISK" as const;

export type { ConcurrencyAuditResult };

export interface ConcurrencySaturationReport {
  readonly totalSlots: number;
  readonly activeSlots: number;
  readonly saturationRatio: number;
  readonly underParallelizedTasks: readonly string[];
  readonly isSaturated: boolean;
  readonly findings: readonly string[];
  readonly warnings: readonly string[];
  readonly unstagedStations: readonly string[];
  readonly stragglingTasks: readonly string[];
}

export interface ConcurrencyAuditOptions {
  readonly activeStations?: readonly AssemblyStation[] | undefined;
  readonly totalWorkUnits?: number | undefined;
  readonly spanLength?: number | undefined;
  readonly stragglingAssessments?: readonly StragglerAssessment[] | undefined;
  readonly minSaturationRatio?: number | undefined;
  readonly queuedTasks?: number | readonly string[] | undefined;
  readonly underParallelizedTasks?: readonly string[] | undefined;
  readonly totalSlots?: number | undefined;
  readonly activeSlots?: number | undefined;
}

export function auditConcurrencySaturation(
  options?: ConcurrencyAuditOptions | undefined,
): ConcurrencySaturationReport {
  const stations = options?.activeStations ?? [];
  const remainingWorkUnits = stations.filter(
    (s) => s.status !== "LANDED" && s.status !== "FAILED",
  ).length;

  const queuedCount =
    typeof options?.queuedTasks === "number"
      ? options.queuedTasks
      : Array.isArray(options?.queuedTasks)
        ? options.queuedTasks.length
        : 0;

  const totalWorkUnits = Math.max(
    0,
    options?.totalWorkUnits ?? (queuedCount > 0 ? queuedCount : remainingWorkUnits),
  );
  const spanLength = Math.max(1, options?.spanLength ?? 1);
  const minRatio = options?.minSaturationRatio ?? 0.8;

  const optimalPlan = calculateBrentDecomposition({
    workUnits: totalWorkUnits,
    spanLength,
  });

  const optimalConcurrency = options?.totalSlots ?? optimalPlan.optimal_parallelism;
  const totalSlots = optimalConcurrency;

  const activeSlots =
    options?.activeSlots !== undefined
      ? options.activeSlots
      : stations.filter((s) => s.status === "IN_PROGRESS" || s.status === "VERIFIED").length;

  const saturationRatio = totalSlots === 0 ? 1 : Number((activeSlots / totalSlots).toFixed(2));

  const findings: string[] = [];
  const warnings: string[] = [];
  const unstagedStations: string[] = [];
  const stragglingTasks: string[] = [];
  const underParallelizedTasks: string[] = options?.underParallelizedTasks
    ? [...options.underParallelizedTasks]
    : [];

  const isUnderSaturated =
    (totalWorkUnits > 5 && activeSlots < 2) ||
    (totalWorkUnits >= 5 && activeSlots < optimalConcurrency && saturationRatio < minRatio);

  if (isUnderSaturated) {
    const msg = `${SKILL_CONCURRENCY_UNDER_SATURATED}: Workload of ${totalWorkUnits} units requires ${optimalConcurrency} parallel workers (P = ⌈W/S⌉), but only ${activeSlots} active (${(saturationRatio * 100).toFixed(0)}% saturation).`;
    findings.push(msg);
    warnings.push(msg);

    if (underParallelizedTasks.length === 0) {
      if (Array.isArray(options?.queuedTasks)) {
        underParallelizedTasks.push(...options.queuedTasks);
      } else if (stations.length > 0) {
        const pendingStations = stations
          .filter(
            (s) => s.status !== "IN_PROGRESS" && s.status !== "VERIFIED" && s.status !== "LANDED",
          )
          .map((s) => s.station_id);
        underParallelizedTasks.push(...pendingStations);
      }
      if (underParallelizedTasks.length === 0 && totalWorkUnits > 0) {
        underParallelizedTasks.push(`workload-${totalWorkUnits}-units`);
      }
    }
  }

  for (const station of stations) {
    if (station.status === "LANDED" || station.status === "VERIFIED") {
      if (!station.staging_record || !station.staging_record.git_index_sha) {
        unstagedStations.push(station.station_id);
        const msg = `${UNSTAGED_STATION_DURABILITY_RISK}: Station ${station.station_id} in domain ${station.domain} reached ${station.status} without Git staging invariant record.`;
        findings.push(msg);
        warnings.push(msg);
      }
    }
  }

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
    !isUnderSaturated &&
    (optimalConcurrency === 0 || saturationRatio >= minRatio) &&
    unstagedStations.length === 0 &&
    stragglingTasks.length === 0;

  if (isSaturated && findings.length === 0) {
    findings.push(
      "Skill concurrency is fully saturated; all assembly stations and workers are compliant.",
    );
  }

  return {
    totalSlots,
    activeSlots,
    saturationRatio,
    underParallelizedTasks: Object.freeze(underParallelizedTasks),
    isSaturated,
    findings: Object.freeze(findings),
    warnings: Object.freeze(warnings),
    unstagedStations: Object.freeze(unstagedStations),
    stragglingTasks: Object.freeze(stragglingTasks),
  };
}

export function auditSkillConcurrencySaturation(
  options?: ConcurrencyAuditOptions | undefined,
): ConcurrencyAuditResult {
  const report = auditConcurrencySaturation(options);

  return {
    is_saturated: report.isSaturated,
    active_workers: report.activeSlots,
    optimal_concurrency: report.totalSlots,
    saturation_ratio: report.saturationRatio,
    unstaged_stations: report.unstagedStations,
    straggling_tasks: report.stragglingTasks,
    findings: report.findings,
    warnings: report.warnings,
  };
}
