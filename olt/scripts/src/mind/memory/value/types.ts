export const INCLUDED_VALUE_METRICS = [
  "leases_reclaimed",
  "findings_resolved",
  "gates_flipped_red_to_green",
  "tasks_reaching_done",
  "candidates_admitted",
  "proposals_recorded",
] as const;

export const EXCLUDED_VALUE_METRICS = [
  "tokens_spent",
  "files_touched",
  "commands_run",
  "agents_deployed",
  "words_written",
] as const;

export type IncludedValueMetric = (typeof INCLUDED_VALUE_METRICS)[number];
export type ExcludedValueMetric = (typeof EXCLUDED_VALUE_METRICS)[number];

export function isIncludedValueMetric(metric: string): metric is IncludedValueMetric {
  const norm = metric.replace(/([A-Z])/g, "_$1").toLowerCase();
  return (INCLUDED_VALUE_METRICS as readonly string[]).includes(norm);
}

export function isExcludedValueMetric(metric: string): metric is ExcludedValueMetric {
  const norm = metric.replace(/([A-Z])/g, "_$1").toLowerCase();
  return (EXCLUDED_VALUE_METRICS as readonly string[]).includes(norm);
}

export interface PulseValueMetrics {
  readonly leases_reclaimed?: number;
  readonly findings_resolved?: number;
  readonly gates_flipped_red_to_green?: number;
  readonly tasks_reaching_done?: number;
  readonly candidates_admitted?: number;
  readonly proposals_recorded?: number;
  readonly leasesReclaimed?: number;
  readonly findingsResolved?: number;
  readonly gatesFlippedRedToGreen?: number;
  readonly tasksReachingDone?: number;
  readonly candidatesAdmitted?: number;
  readonly proposalsRecorded?: number;
  readonly [key: string]: number | undefined;
}

export type ValuePulseMetrics = PulseValueMetrics;

export function calculatePulseValue(metrics: PulseValueMetrics): number {
  const leases = Math.max(0, Math.floor(metrics.leases_reclaimed ?? metrics.leasesReclaimed ?? 0));
  const findings = Math.max(
    0,
    Math.floor(metrics.findings_resolved ?? metrics.findingsResolved ?? 0),
  );
  const gates = Math.max(
    0,
    Math.floor(metrics.gates_flipped_red_to_green ?? metrics.gatesFlippedRedToGreen ?? 0),
  );
  const tasks = Math.max(
    0,
    Math.floor(metrics.tasks_reaching_done ?? metrics.tasksReachingDone ?? 0),
  );
  const candidates = Math.max(
    0,
    Math.floor(metrics.candidates_admitted ?? metrics.candidatesAdmitted ?? 0),
  );
  const rawProposals = Math.max(
    0,
    Math.floor(metrics.proposals_recorded ?? metrics.proposalsRecorded ?? 0),
  );
  const proposals = rawProposals > 0 ? 1 : 0;

  return leases + findings + gates + tasks + candidates + proposals;
}

export const DEFAULT_VALUE_WEIGHTS: Record<string, number> = {
  leases_reclaimed: 1,
  findings_resolved: 1,
  gates_flipped_red_to_green: 1,
  tasks_reaching_done: 1,
  candidates_admitted: 1,
  proposals_recorded: 1,
};
export type ValueWeightMap = typeof DEFAULT_VALUE_WEIGHTS;
