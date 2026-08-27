export type ModularityMode = "ratchet" | "strict";

export type ScanSource = "index" | "tree";

export type ViolationRule =
  | "line_limit"
  | "directory_fanout"
  | "missing_facade"
  | "export_star"
  | "facade_bypass"
  | "dependency_cycle"
  | "root_no_growth"
  | "generated_catalog";

export interface Violation {
  readonly rule: ViolationRule;
  readonly path: string;
  readonly observed: number | string;
  readonly limit?: number;
  readonly detail: string;
}

export interface CheckReport {
  readonly mode: ModularityMode;
  readonly source: ScanSource;
  readonly violations: readonly Violation[];
  readonly baselineDelta: {
    readonly added: readonly Violation[];
    readonly worsened: readonly Violation[];
    readonly resolved: readonly Violation[];
  };
  readonly passed: boolean;
}

export interface ScopeDecision {
  readonly included: boolean;
  readonly lineLimited: boolean;
  readonly fanoutCounted: boolean;
  readonly importScanned: boolean;
}
