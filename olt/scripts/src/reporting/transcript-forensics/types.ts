export type ForensicHeuristicCategory =
  | "cognitive_validator_lockout"
  | "critic_authentication_failure"
  | "command_ownership_failure"
  | "unknown_cli_option"
  | "source_reverse_engineering"
  | "harness_error";

export interface ForensicRawFinding {
  readonly category: ForensicHeuristicCategory;
  readonly rootCauseHeuristic: string;
  readonly signature: string;
  readonly errorSnippet: string;
  readonly offendingCommand?: string;
  readonly timestamp: string;
  readonly conversationId: string;
  readonly stepIndex?: number;
  readonly transcriptPath?: string;
}

export interface ForensicFindingOccurrence {
  readonly conversationId: string;
  readonly timestamp: string;
  readonly stepIndex?: number;
  readonly errorSnippet: string;
  readonly offendingCommand?: string;
  readonly transcriptPath?: string;
}

export interface ClusteredForensicDefect {
  readonly category: ForensicHeuristicCategory;
  readonly rootCauseHeuristic: string;
  readonly signature: string;
  readonly errorSnippet: string;
  readonly offendingCommand?: string;
  readonly count: number;
  readonly occurrences: readonly ForensicFindingOccurrence[];
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly conversationIds: readonly string[];
}

export interface ForensicScanOptions {
  readonly transcriptPath?: string;
  readonly brainDirectory?: string;
  readonly defectsPath?: string;
  readonly recordDefects?: boolean;
  readonly cwd?: string;
  readonly limit?: number;
}

export interface ForensicScanSummary {
  readonly totalTranscriptsScanned: number;
  readonly totalStepsScanned: number;
  readonly totalFindings: number;
  readonly categories: Record<ForensicHeuristicCategory, number>;
  readonly clusters: readonly ClusteredForensicDefect[];
  readonly recordedDefectCount: number;
}
