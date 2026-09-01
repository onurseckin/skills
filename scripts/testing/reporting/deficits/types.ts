export type DeficitCategory =
  | "error-handling"
  | "branching"
  | "unexercised-logic"
  | "initialization";

export interface DeficitCategoryBreakdown {
  readonly "error-handling": number;
  readonly branching: number;
  readonly "unexercised-logic": number;
  readonly initialization: number;
}

export interface DeficitCluster {
  readonly id: string;
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly lineCount: number;
  readonly category: DeficitCategory;
  readonly categoryReason: string;
  readonly repoImpactPct: number;
  readonly fileImpactPct: number;
  readonly sampleCodeSnippet?: string | undefined;
}

export interface DeficitRoadmap {
  readonly totalUncoveredLines: number;
  readonly totalClusters: number;
  readonly totalRepoLines: number;
  readonly categoryBreakdown: DeficitCategoryBreakdown;
  readonly clusters: readonly DeficitCluster[];
}

export interface DeficitClusteringOptions {
  readonly topN?: number | undefined;
  readonly sourceResolver?: ((file: string) => string | readonly string[] | undefined) | undefined;
  readonly rootDir?: string | undefined;
}
