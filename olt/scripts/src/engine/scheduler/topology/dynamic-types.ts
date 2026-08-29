import { ValidatorDomain, TopologyDecision } from "../../../core/contracts";

export interface WorkSpanMetrics {
  readonly work: number;
  readonly span: number;
  readonly parallelismFactor: number;
  readonly criticalPath: readonly string[];
  readonly minWaves: number;
}
export interface OrchestratorPartition {
  readonly partitionId: string;
  readonly domain: string;
  readonly taskIds: readonly string[];
  readonly writeScopes: readonly string[];
  readonly dependencies: readonly string[];
  readonly work: number;
  readonly span: number;
  readonly recommendedWorkers: number;
}
export interface CrossOrchestratorBarrier {
  readonly fromPartitionId: string;
  readonly toPartitionId: string;
  readonly prerequisiteTaskId: string;
  readonly dependentTaskId: string;
  readonly wave: number;
}
export interface ValidatorDemand {
  readonly domain: ValidatorDomain;
  readonly taskCount: number;
  readonly recommendedValidators: number;
}
export interface DynamicTopologyWave {
  readonly wave: number;
  readonly taskIds: readonly string[];
  readonly workerDemand: number;
  readonly validatorDemands: readonly ValidatorDemand[];
  readonly criticDemand: number;
}
export interface DynamicTopologyOptions {
  readonly default_max_parallel?: number | undefined;
  readonly max_orchestrator_partitions?: number | undefined;
  readonly target_worker_efficiency?: number | undefined;
  readonly rationales?: Readonly<Record<string, string>> | undefined;
}
export interface ResourceDisjointnessMetrics {
  readonly disjointComponentCount: number;
  readonly disjointnessScore: number;
  readonly componentTaskIds: readonly (readonly string[])[];
}
export interface DynamicTopologySynthesis {
  readonly revision: number;
  readonly work: number;
  readonly span: number;
  readonly parallelismFactor: number;
  readonly criticalPath: readonly string[];
  readonly resourceDisjointness: ResourceDisjointnessMetrics;
  readonly recommendedTier1Orchestrators: number;
  readonly recommendedTier2Coordinators: number;
  readonly recommendedWorkerFleetSize: number;
  readonly recommendedValidatorFleet: Readonly<Record<ValidatorDomain, number>>;
  readonly recommendedCriticConcurrency: number;
  readonly orchestratorPartitions: readonly OrchestratorPartition[];
  readonly crossOrchestratorBarriers: readonly CrossOrchestratorBarrier[];
  readonly waves: readonly DynamicTopologyWave[];
  readonly decisions: readonly TopologyDecision[];
  readonly max_parallel: number;
}
