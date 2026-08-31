/**
 * Topology synthesis domain types and interfaces.
 */

export interface SynthesizedTaskSpec {
  readonly id: string;
  readonly label?: string | undefined;
  readonly writeScope: readonly string[];
  readonly dependencies?: readonly string[] | undefined;
  readonly priority?: number | undefined;
  readonly effort?: number | undefined;
  readonly requirementIds?: readonly string[] | undefined;
  readonly requiredSkills?: readonly string[] | undefined;
  readonly cognitiveFlavor?: string | undefined;
}

export interface DependencyRule {
  readonly from: string;
  readonly to: string;
  readonly reason?: string | undefined;
}

export interface TopologySynthesisSpec {
  readonly objective?: string | undefined;
  readonly prompt?: string | undefined;
  readonly tasks: readonly SynthesizedTaskSpec[];
  readonly maxParallel?: number | undefined;
  readonly dependencyRules?: readonly DependencyRule[] | undefined;
  readonly enforceScopeIsolation?: boolean | undefined;
  readonly targetSkillQuality?: number | undefined;
  readonly enforceZeroAny?: boolean | undefined;
  readonly enforceZeroSuppressions?: boolean | undefined;
  readonly codeSnippets?:
    | readonly { readonly path: string; readonly content: string }[]
    | undefined;
}

export interface TopologyWavePlan {
  readonly wave: number;
  readonly taskIds: readonly string[];
  readonly capacity: number;
  readonly writeScopes: readonly string[];
  readonly dependenciesSatisfied: readonly string[];
  readonly estimatedEffort: number;
}

export interface TopologyDecisionRecord {
  readonly taskId: string;
  readonly wave: number;
  readonly parallelWith: readonly string[];
  readonly serializedAfter: readonly string[];
  readonly reason: "dependency" | "write_scope_conflict" | "priority_capacity";
  readonly rationale: string;
}

export interface SynthesizedTopology {
  readonly schema: "orchestrator.synthesized_topology";
  readonly version: number;
  readonly revision: number;
  readonly tasks: readonly SynthesizedTaskSpec[];
  readonly waves: readonly TopologyWavePlan[];
  readonly decisions: readonly TopologyDecisionRecord[];
  readonly maxParallel: number;
  readonly criticalPath: readonly string[];
  readonly criticalDepth: number;
  readonly totalEffort: number;
  readonly qualityScore: number;
  readonly isAcyclic: boolean;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface TaskDecomposition {
  readonly parentTaskId: string;
  readonly subTasks: readonly SynthesizedTaskSpec[];
}

export interface SkillRequirementAdjustment {
  readonly taskId: string;
  readonly requiredSkill: string;
  readonly minimumQuality: number;
}

export interface SerializationRule {
  readonly taskId: string;
  readonly serializeAfter: readonly string[];
  readonly reason: string;
}

export interface CriticFeedbackAdjustment {
  readonly feedbackId: string;
  readonly roundNumber: number;
  readonly criticDecision: "approve" | "request_changes" | "rejected" | "escalated";
  readonly feedbackSummary: string;
  readonly blockingFindingIds?: readonly string[] | undefined;
  readonly remediatedTaskIds?: readonly string[] | undefined;
  readonly newTasks?: readonly SynthesizedTaskSpec[] | undefined;
  readonly reorderRules?: readonly SerializationRule[] | undefined;
  readonly skillEnhancements?: readonly SkillRequirementAdjustment[] | undefined;
  readonly splitTasks?: readonly TaskDecomposition[] | undefined;
}

export interface AcyclicityValidationResult {
  readonly isAcyclic: boolean;
  readonly topologicalOrder: readonly string[];
  readonly cycle?: readonly string[] | undefined;
  readonly issues: readonly string[];
}

export interface DominatingSkillQualityReport {
  readonly passed: boolean;
  readonly score: number;
  readonly metrics: {
    readonly anyTypeCount: number;
    readonly suppressionCount: number;
    readonly typeCoverageScore: number;
    readonly errorHandlingScore: number;
    readonly modularityScore: number;
  };
  readonly issues: readonly string[];
}
