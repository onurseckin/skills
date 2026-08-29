export interface SubtaskDecomposition {
  readonly id: string;
  readonly label: string;
  readonly writeScope: readonly string[];
  readonly gate: string | readonly string[];
  readonly deps?: readonly string[] | undefined;
  readonly depReasons?: Readonly<Record<string, string>> | undefined;
  readonly goal?: string | undefined;
  readonly criteria?: readonly string[] | undefined;
  readonly priority?: number | undefined;
  readonly effort?: number | undefined;
  readonly requirementLines?: readonly number[] | undefined;
  readonly role?:
    | "implementer"
    | "sub_implementer"
    | "repairer"
    | "validator"
    | "sub_validator"
    | undefined;
  readonly assignedAgent?: string | undefined;
  readonly validatorId?: string | undefined;
  readonly validatorGate?: string | readonly string[] | undefined;
  readonly validatorScope?: readonly string[] | undefined;
}

export interface DeeperExpansionRequest {
  readonly parentTaskId: string;
  readonly subtasks: readonly SubtaskDecomposition[];
  readonly decompositionRationale?: string | undefined;
  readonly autoPairValidators?: boolean | undefined;
  readonly rewireDependents?: boolean | undefined;
  readonly rewirePrerequisites?: boolean | undefined;
}

export interface WiderExpansionRequest {
  readonly newTasks: readonly SubtaskDecomposition[];
  readonly admissionRationale?: string | undefined;
  readonly autoPairValidators?: boolean | undefined;
  readonly connectToRunGate?: boolean | undefined;
}

export interface DynamicExpansionOptions {
  readonly allowScopeGrowth?: boolean | undefined;
  readonly preserveJustifiedEdges?: boolean | undefined;
  readonly autoPromoteReady?: boolean | undefined;
  readonly strictBypassCheck?: boolean | undefined;
  readonly maxLanes?: number | undefined;
  readonly revision?: number | undefined;
}

export interface SuggestedEdge {
  readonly source: string;
  readonly target: string;
  readonly type?: string | undefined;
}

export interface CognitiveGuidance {
  readonly summary: string;
  readonly invariant: string;
  readonly rationale: string;
  readonly remediationAction: string;
  readonly suggestedRemediationEdges: readonly SuggestedEdge[];
}

export interface BypassViolation {
  readonly code: "TRANSITIVE_BYPASS_VIOLATION";
  readonly edge: { readonly source: string; readonly target: string };
  readonly bypassedPath: readonly string[];
  readonly bypassedStage: string;
  readonly reason: string;
  readonly guidance: CognitiveGuidance;
}

export interface TransitiveBypassCheckResult {
  readonly hasBypass: boolean;
  readonly violations: readonly BypassViolation[];
  readonly warnings: readonly string[];
}

export interface TaskRolePair {
  readonly implementerTask: Record<string, unknown>;
  readonly validatorTask: Record<string, unknown>;
  readonly artifactNode: Record<string, unknown>;
  readonly valArtifactNode: Record<string, unknown>;
  readonly producesEdge: Record<string, unknown>;
  readonly valProducesEdge: Record<string, unknown>;
  readonly validationEdge: Record<string, unknown>;
  readonly gateNode: Record<string, unknown>;
  readonly validatorGateNode?: Record<string, unknown> | undefined;
}

export interface DynamicExpansionResult {
  readonly success: boolean;
  readonly graphDocument: Record<string, unknown>;
  readonly addedTasks: readonly Record<string, unknown>[];
  readonly addedEdges: readonly Record<string, unknown>[];
  readonly addedGates: readonly Record<string, unknown>[];
  readonly pairedTasks: readonly {
    readonly implementerTaskId: string;
    readonly validatorTaskId: string;
  }[];
  readonly bypassViolations: readonly BypassViolation[];
  readonly cognitiveGuidance: readonly CognitiveGuidance[];
  readonly revision: number;
  readonly warnings: readonly string[];
}

export interface ImplementerValidatorConfig {
  readonly taskId: string;
  readonly label: string;
  readonly writeScope: readonly string[];
  readonly gate: string | readonly string[];
  readonly validatorId?: string | undefined;
  readonly validatorGate?: string | readonly string[] | undefined;
  readonly validatorScope?: readonly string[] | undefined;
  readonly priority?: number | undefined;
  readonly effort?: number | undefined;
  readonly requirementIds?: readonly string[] | undefined;
  readonly status?: string | undefined;
  readonly deps?: readonly string[] | undefined;
  readonly role?: string | undefined;
  readonly createdOrder?: number | undefined;
}

export interface DynamicExpansionPlan {
  readonly deeper?: readonly DeeperExpansionRequest[] | undefined;
  readonly wider?: readonly WiderExpansionRequest[] | undefined;
}

export interface AllocatedTaskElements {
  readonly nodes: readonly Record<string, unknown>[];
  readonly edges: readonly Record<string, unknown>[];
  readonly gates: readonly Record<string, unknown>[];
  readonly addedTasks: readonly Record<string, unknown>[];
  readonly addedEdges: readonly Record<string, unknown>[];
  readonly addedGates: readonly Record<string, unknown>[];
  readonly pairedTask?:
    | {
        readonly implementerTaskId: string;
        readonly validatorTaskId: string;
      }
    | undefined;
  readonly nextOrder: number;
}
