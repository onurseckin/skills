export const PURITY_BASELINE_SCHEMA = "olt-purity-baseline/v1";

export const DEFAULT_PURITY_BASELINE = "scripts/testing/purity-ratchet/baseline/index.jsonl";

export interface PurityBaselineEntry {
  readonly file: string;
  readonly rule: string;
  readonly count: number;
  readonly reason?: string | undefined;
}

export interface PurityBaseline {
  readonly schema: typeof PURITY_BASELINE_SCHEMA;
  readonly entries: readonly PurityBaselineEntry[];
}
