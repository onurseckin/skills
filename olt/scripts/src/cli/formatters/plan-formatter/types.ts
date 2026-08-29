import type { AuditFinding, AuditNotEvaluated } from "../../../graph/plan-audit.ts";

export interface CapsuleInitParams {
  runId: string;
  runRoot: string;
  promptSha256: string;
  promptBytes?: number;
  assurance: string;
  bunVersion?: string;
  runtimePin?: { sha256: string; files: number };
}

export interface TaskRegisteredParams {
  taskId: string;
  label: string;
  writeScope: readonly string[];
  gateCmd: string;
  deps: readonly string[];
  totalTasks: number;
  requirementLines?: readonly number[] | undefined;
}

export interface PlanEnhanceParams {
  runId: string;
  markdownPath: string;
  jsonPath: string;
  markdownSha256: string;
  promptSha256: string;
  revision: number;
  summaryPresent: boolean;
  counts: {
    observations: number;
    todos: number;
    risks: number;
    openQuestions: number;
    sources: number;
  };
}

export interface PlanCompileTopology {
  revision: number;
  maxParallel: number;
  waves: { wave: number; taskIds: readonly string[] }[];
}

export interface PlanCompileTopologyDeclaration {
  independentRoots: number;
  edgeCount: number;
}

export interface PlanCompileAuditAcceptance {
  invariant: string;
  reason: string;
}

export interface PlanCompileParams {
  revision: number;
  totalTasks: number;
  topology: PlanCompileTopology;
  topologyDeclaration: PlanCompileTopologyDeclaration;
  collisions: number;
  requirementsCount: number;
  runId: string;
  advisories?: string[];
  warnings?: string[];
  auditAccepted?: PlanCompileAuditAcceptance[];
  auditNotEvaluated?: string[];
}

export interface PlanStatusItem {
  id: string;
  label: string;
  writeScope: readonly string[];
  gate: string;
  deps: readonly string[];
}

export interface PlanReplanParams {
  revision: number;
  repairRound: number;
  newTasksCount: number;
  repairTasks: {
    id: string;
    writeScope: readonly string[];
    findingsCount: number;
    gate: string;
    gateSource: "flag" | "finding" | "parent_task";
  }[];
  runId: string;
}

export interface PlanClaimParams {
  runId: string;
  agent: string;
  packetId: string;
}

export interface PlanApplyParams {
  runId: string;
  revision: number;
  totalTasks: number;
}

export interface AutoPartitionParams {
  glob: string;
  groupBy: "file" | "directory";
  taskIds: readonly string[];
  totalTasks: number;
  breadthWarnings: readonly string[];
}

export interface PlanAuditBriefParams {
  runId: string;
  revision: number;
  findings: readonly AuditFinding[];
  notEvaluated: readonly AuditNotEvaluated[];
}

export interface PlanValidateStartParams {
  runId: string;
  validator: string;
  token: string;
  graphRevision: number;
  totalTasks: number;
}

export interface PlanReviewParams {
  runId: string;
  validator: string;
  status: "approved" | "changes_requested";
  graphRevision: number;
  findingsCount: number;
  summary: string;
  dependencyEdgesReviewed: number;
  gateIdsReviewed: number;
}
