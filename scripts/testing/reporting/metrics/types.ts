export interface MetricItem {
  readonly total: number;
  readonly covered: number;
  readonly skipped: number;
  readonly pct: number;
}

export interface FileCoverageMetric {
  readonly file: string;
  readonly lines: MetricItem;
  readonly statements: MetricItem;
  readonly functions: MetricItem;
  readonly uncoveredLines: readonly number[];
  readonly lineHits: ReadonlyMap<number, number>;
}

export function calculatePct(covered: number, total: number): number {
  if (total <= 0) return 100;
  const pct = (covered / total) * 100;
  return Math.round(pct * 100) / 100;
}

export function createMetricItem(covered: number, total: number): MetricItem {
  return {
    total,
    covered,
    skipped: 0,
    pct: calculatePct(covered, total),
  };
}
