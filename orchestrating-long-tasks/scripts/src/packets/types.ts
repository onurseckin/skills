import type { AgentRole } from "../contracts/packets.ts";
import type { BranchSubTask } from "../contracts/branch.ts";
import type { JsonObject } from "../contracts/json.ts";
import type { Clock, RequirementRuntime, TaskRecord, WorkflowState } from "../workflow/types.ts";
import type { RoleContract } from "./role-contract.ts";

export interface PacketInput {
  runId: string;
  graphRevision: number;
  role: AgentRole;
  agentId: string;
  task?: TaskRecord;
  subTask?: BranchSubTask;
  state: WorkflowState;
  commonInstructions: CanonicalCommonInstructions;
  roleContract?: RoleContract;
  authoritativeContext: JsonObject;
  evidenceSchema: JsonObject;
  targetedCommands: string[][];
  planningWriteScope?: string[];
  leaseToken?: string;
  attempt: number;
  clock?: Clock;
}

export interface CanonicalCommonInstructions {
  bytes: Uint8Array;
  sha256: string;
}

export interface BuiltPacket {
  markdown: string;
  metadata: JsonObject;
}

export type CognitiveStepCategory =
  | "criterion_verification"
  | "evidence_audit"
  | "falsifiability_check"
  | "boundary_verification"
  | "domain_invariant";

export interface CognitiveValidationStep {
  readonly stepNumber: number;
  readonly totalSteps: number;
  readonly requirementId: string;
  readonly criterionId: string;
  readonly criterion: string;
  readonly evidenceRequirements: readonly string[];
  readonly category: CognitiveStepCategory;
  readonly directive: string;
  readonly instructions: string;
  readonly falsifiabilityPrompt: string;
}

export interface ExtractedCriterion {
  readonly requirementId: string;
  readonly criterionId: string;
  readonly criterion: string;
  readonly evidenceRequirements: readonly string[];
}

export interface DynamicStepPlan {
  readonly criteriaCount: number;
  readonly totalSteps: number;
  readonly steps: readonly CognitiveValidationStep[];
  readonly mappedRequirementIds: readonly string[];
  readonly summary: string;
  readonly renderedMarkdown: string;
}

export interface DynamicStepInput {
  readonly task?: TaskRecord | BranchSubTask | null | undefined;
  readonly requirements?: readonly JsonObject[] | readonly RequirementRuntime[] | undefined;
  readonly mappedRequirementIds?: readonly string[] | undefined;
  readonly originalPrompt?: string | undefined;
}

export interface CognitiveStepCoverageIssue {
  readonly stepNumber: number;
  readonly criterionId: string;
  readonly requirementId: string;
  readonly reason: string;
}

export interface CognitiveStepCoverageResult {
  readonly covered: boolean;
  readonly totalSteps: number;
  readonly coveredStepsCount: number;
  readonly missingStepsCount: number;
  readonly issues: readonly CognitiveStepCoverageIssue[];
}
