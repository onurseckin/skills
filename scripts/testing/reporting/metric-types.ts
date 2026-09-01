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
