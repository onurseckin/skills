import { ValidatorDomain, TopologyDecision } from "../../../core/contracts";
import { ScheduledTask } from "../conflict/rank";

export interface UnlimitedDepthSchedulerConfig {
  readonly default_max_parallel?: number | undefined;
  readonly max_depth?: number | null | undefined;
  readonly allow_unbounded_waves?: boolean | undefined;
  readonly require_strict_validator_pairing?: boolean | undefined;
  readonly enforce_zero_leak?: boolean | undefined;
  readonly rationales?: Readonly<Record<string, string>> | undefined;
  readonly requirement_texts?: Readonly<Record<string, readonly string[]>> | undefined;
}
export interface ValidatorPairingRecord {
  readonly taskId: string;
  readonly assignedImplementer?: string | null | undefined;
  readonly applicableDomains: readonly ValidatorDomain[];
  readonly pairedValidatorDomains: readonly ValidatorDomain[];
  readonly isPaired: boolean;
  readonly pairingStrictness: "strict" | "relaxed" | "multi-round";
  readonly reason?: string | undefined;
}
export interface UnboundedWavePartition {
  readonly wave: number;
  readonly taskIds: readonly string[];
  readonly tasks: readonly ScheduledTask[];
  readonly depth: number;
  readonly parallelism: number;
  readonly validatorPairings: readonly ValidatorPairingRecord[];
  readonly isolatedWriteScopes: readonly string[];
  readonly isUnbounded: boolean;
}
export interface DepthMetrics {
  readonly totalTasks: number;
  readonly maxWaveDepth: number;
  readonly criticalPathLength: number;
  readonly criticalPathTasks: readonly string[];
  readonly longestChainEffort: number;
  readonly maxConcurrentWidth: number;
  readonly averageConcurrency: number;
  readonly unboundedSafetyVerified: boolean;
  readonly validatorPairingRate: number;
}
export interface CriticalPathDepthResult {
  readonly depth: number;
  readonly criticalPath: readonly string[];
  readonly longestChainEffort: number;
}
export interface DepthInvariantValidationResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
}
export interface PairValidatorsOptions {
  readonly requireAllDomains?: boolean | undefined;
  readonly pairingStrictness?: "strict" | "relaxed" | "multi-round" | undefined;
  readonly requirementTexts?:
    | ReadonlyMap<string, readonly string[]>
    | Readonly<Record<string, readonly string[]>>
    | undefined;
  readonly assignedImplementers?:
    | ReadonlyMap<string, string>
    | Readonly<Record<string, string>>
    | undefined;
}
export interface UnlimitedDepthScheduleResult {
  readonly revision: number;
  readonly waves: readonly UnboundedWavePartition[];
  readonly metrics: DepthMetrics;
  readonly pairings: readonly ValidatorPairingRecord[];
  readonly decisions: readonly TopologyDecision[];
  readonly max_parallel: number;
}
