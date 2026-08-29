import type { AgentGrantRecord } from "../../core/contracts/index.ts";
import type { BranchRecord } from "../../core/contracts/index.ts";
import type { EvidenceClass, Evidenced } from "../../core/contracts/index.ts";
import type { JsonObject } from "../../core/contracts/index.ts";
import type { TopologyRecord } from "../../core/contracts/index.ts";
import type {
  BrowserTestRun,
  NodeRole,
  NodeScript,
  NodeTelemetry,
  NodeTool,
  NodeValidatorDomain,
} from "./graph-agent-types.ts";
import type { TimingBreakdown, TokenUsageDetail } from "../metrics/index.ts";
import type {
  BadgeDetail,
  EdgeContainerDetail,
  EdgeExchange,
  EdgeKind,
  EdgeTrafficDetail,
  EdgeVariant,
  ExchangeFinding,
  ExchangeTransferredFile,
  ExchangeType,
  GraphEdgeData,
  PayloadKind,
} from "./graph-edge-types.ts";

export type {
  BadgeDetail,
  EdgeContainerDetail,
  EdgeExchange,
  EdgeKind,
  EdgeTrafficDetail,
  EdgeVariant,
  ExchangeFinding,
  ExchangeTransferredFile,
  ExchangeType,
  GraphEdgeData,
  PayloadKind,
};

export type NodeKind =
  | "orchestrator"
  | "agent"
  | "tool"
  | "router"
  | "join"
  | "gate"
  | "critic"
  | "terminal"
  | "input";

export type {
  BrowserTestRun,
  BrowserTestViewport,
  NamedBrowserTestViewport,
  NodeRole,
  NodeScript,
  NodeTelemetry,
  NodeTool,
  NodeValidatorDomain,
} from "./graph-agent-types.ts";

export type NodeStatus =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "warning"
  | "skipped"
  | "cached";

export type ActionKind =
  | "command"
  | "file"
  | "agent"
  | "lease"
  | "packet"
  | "finding"
  | "probe"
  | "review"
  | "branch"
  | "gate"
  | "plan"
  | "task"
  | "tool"
  | "run";

export type ActionOutcome = "success" | "failure" | "pending" | "unknown";

export interface ActionTarget {
  taskId?: string | undefined;
  gateId?: string | undefined;
  branchId?: string | undefined;
  subTaskId?: string | undefined;
  agentId?: string | undefined;
  commandId?: string | undefined;
  packetId?: string | undefined;
  requirementId?: string | undefined;
  path?: string | undefined;
  nodeId?: string | undefined;
}

export interface ActionStepRecord {
  step: number;
  timestamp: string;
  actor: string;
  kind: ActionKind;
  rawKind: string;
  target: ActionTarget;
  outcome: ActionOutcome;
  evidence_class: EvidenceClass;
  summary: string;
}

export interface FileRef {
  path: string;
  mode?: "read" | "write" | "attach" | undefined;
  lines?: string | undefined;
  diff?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
  evidence_class?: EvidenceClass | undefined;
  statusCode?: string | undefined;
  sha256?: string | null | undefined;
  rationale?: string | undefined;
  requirementIds?: string[] | undefined;
  step?: number | undefined;
}

export interface IoPort {
  node?: string | undefined;
  kind: PayloadKind;
  label: string;
  tokens?: number | undefined;
  preview?: string | undefined;
  dataRef?: string | undefined;
}

export interface MediaAsset {
  id: string;
  type: "image" | "video" | "audio" | "document" | "code" | "log" | "diagram" | string;
  url: string;
  title?: string | undefined;
  description?: string | undefined;
  thumbnailUrl?: string | undefined;
  timestamp?: string | undefined;
  step?: number | string | undefined;
  author?: string | undefined;
  mimeType?: string | undefined;
  sizeBytes?: number | undefined;
  dimensions?: { width: number; height: number } | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface FindingDetail {
  id: string;
  requirementId?: string | undefined;
  severity: "critical" | "important" | "suggestion";
  observation: string;
  pushbackReason?: string | undefined;
  opposedChanges?: string | undefined;
  remediation?: string | undefined;
  rejectionRound?: number | undefined;
  round?: number | undefined;
  author?: string | undefined;
  validatorId?: string | undefined;
  timestamp?: string | undefined;
  status: "open" | "resolved";
  targetFiles?: string[] | undefined;
  fileRefs?: FileRef[] | undefined;
  revalidationProof?: { method: string; evidence: string[] } | undefined;
  remediationProof?: { method: string; evidence: string[] } | undefined;
  resolvedAt?: string | undefined;
  resolvedBy?: string | undefined;
  class?: string | undefined;
  evidence?:
    | Array<{
        kind?: string | undefined;
        reference?: string | undefined;
        observation?: string | undefined;
        url?: string | undefined;
      }>
    | undefined;
  screenshots?: MediaAsset[] | undefined;
  [key: string]: unknown;
}

export interface NodeFinding extends FindingDetail {
  screenshots?: undefined;
  screenshotAssetIds?: string[] | undefined;
}

export interface GraphSection {
  id: string;
  title: string;
  description?: string | undefined;
  nodeIds: string[];
  collapsed?: boolean | undefined;
  reason?: string | undefined;
  parentNodeId?: string | undefined;
  status?: string | undefined;
  depth?: number | undefined;
  openedAt?: string | undefined;
  closedAt?: string | undefined;
  outcomeSummary?: string | undefined;
  filesChanged?: Evidenced<string[]> | undefined;
  files?: FileRef[] | undefined;
}

export interface NodeStateTransition {
  at: string;
  actor: string;
  from: string;
  to: string;
  reason: string;
  attempt: number;
  evidence_class: EvidenceClass;
  verdict?: string | undefined;
  round?: number | undefined;
  findingClass?: string | undefined;
  findingCount?: number | undefined;
}

export interface NodeMetrics {
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  costUsd?: number | undefined;
  durationMs?: number | undefined;
  retries?: number | undefined;
  commandCount?: number | undefined;
  tokens?: TokenUsageDetail | undefined;
  timingBreakdown?: TimingBreakdown | undefined;
}

export interface NodeMetadata {
  role?: NodeRole | undefined;
  agentId?: string | undefined;
  findings?: NodeFinding[] | undefined;
  writeScope?: string[] | undefined;
  validatorId?: string | undefined;
  validatorDomain?: NodeValidatorDomain | undefined;
  repairRounds?: number | undefined;
  probeRounds?: number | undefined;
  validationHistory?: unknown[] | undefined;
  branchId?: string | undefined;
  branchReason?: string | undefined;
  subTaskId?: string | undefined;
  criticId?: string | undefined;
  status?: string | undefined;
  unresolvedFindingIds?: string[] | undefined;
  residualRisks?: unknown[] | undefined;
  requirementProofs?: unknown[] | undefined;
  worktreeCommit?:
    | { sha: string; subject: string; changedLines: number; overLimit: boolean }
    | undefined;
  [key: string]: unknown;
}

export interface GraphNodeData {
  id: string;
  name: string;
  description?: string | undefined;
  type?: string | undefined;
  kind?: NodeKind | undefined;
  status?: NodeStatus | undefined;
  step?: number | undefined;
  stepLabel?: string | undefined;
  badge?: BadgeDetail | undefined;
  badges?:
    | Array<{
        label: string;
        variant?: "success" | "info" | "amber" | "error" | "gray" | undefined;
      }>
    | undefined;
  telemetry?: NodeTelemetry | undefined;
  sectionId?: string | undefined;
  tools?: NodeTool[] | undefined;
  scripts?: NodeScript[] | undefined;
  stateTransitions?: NodeStateTransition[] | undefined;
  assets?: MediaAsset[] | undefined;
  browserTests?: BrowserTestRun[] | undefined;
  files?: FileRef[] | undefined;
  metrics?: NodeMetrics | undefined;
  io?: { inputs?: IoPort[] | undefined; outputs?: IoPort[] | undefined } | undefined;
  prompt?: string | undefined;
  output?: string | undefined;
  logs?: string | undefined;
  metadata?: NodeMetadata | undefined;
  rank?: number | undefined;
  group?: string | undefined;
}

export interface RunPromptFacts {
  text: string;
  bytes: number;
  sha256?: string | undefined;
  path?: string | undefined;
  evidence_class: EvidenceClass;
}

export interface RunEnhancedPlanFacts {
  revision?: number | undefined;
  recordedAt?: string | undefined;
  actor?: string | undefined;
  promptSha256?: string | undefined;
  markdownPath?: string | undefined;
  jsonPath?: string | undefined;
  markdownSha256?: string | undefined;
  jsonSha256?: string | undefined;
  markdown?: string | undefined;
  document?: JsonObject | undefined;
  evidence_class: EvidenceClass;
}

export interface RunReportFacts {
  path: string;
  document: JsonObject;
  evidence_class: EvidenceClass;
}

export interface RunRequirementFacts {
  schema?: string | undefined;
  version?: number | undefined;
  promptSha256?: string | undefined;
  requirements: JsonObject[];
  dispositions: JsonObject[];
  evidence_class: EvidenceClass;
}

export interface RunRepositoryFacts {
  baselineBinding?: JsonObject | undefined;
  currentBinding?: JsonObject | undefined;
  baselineInspectionSha256?: string | undefined;
  currentInspectionSha256?: string | undefined;
  inspections?: JsonObject[] | undefined;
  evidence_class: EvidenceClass;
}

export interface RunIntegrityFacts {
  schema?: string | undefined;
  version?: number | undefined;
  revision?: number | undefined;
  eventSequence?: number | undefined;
  eventHead?: string | null | undefined;
  graphRevision?: number | undefined;
  evidence_class: EvidenceClass;
}

export interface RunCompletionFacts {
  critic?: JsonObject | undefined;
  criticHistory?: JsonObject[] | undefined;
  review?: JsonObject | undefined;
  reviews?: JsonObject[] | undefined;
  remediations?: JsonObject[] | undefined;
  verification?: JsonObject | undefined;
  result?: JsonObject | undefined;
  evidence?: JsonObject | undefined;
}

export interface RunFacts {
  runId: string;
  capsuleId?: string | undefined;
  prompt: RunPromptFacts;
  enhancedPlan?: RunEnhancedPlanFacts | undefined;
  requirements?: RunRequirementFacts | undefined;
  topology?: TopologyRecord | undefined;
  taskOrder?: string[] | undefined;
  gates?: JsonObject[] | undefined;
  branches?: BranchRecord[] | undefined;
  agents?: AgentGrantRecord[] | undefined;
  agentLedgerIssue?: string | undefined;
  reports?: RunReportFacts[] | undefined;
  planGraph?: JsonObject | undefined;
  planHistory?: JsonObject[] | undefined;
  planningTasks?: JsonObject[] | undefined;
  planningBuffer?: JsonObject[] | undefined;
  packets?: JsonObject[] | undefined;
  repository?: RunRepositoryFacts | undefined;
  integrity?: RunIntegrityFacts | undefined;
  events?: JsonObject[] | undefined;
  steps?: ActionStepRecord[] | undefined;
  manifest?: JsonObject | undefined;
  completion?: RunCompletionFacts | undefined;
  orphanEvidence?: JsonObject[] | undefined;
  orphanEvidenceDispositions?: JsonObject[] | undefined;
}

export interface GraphDataset {
  id: string;
  title: string;
  description?: string | undefined;
  directed?: boolean | undefined;
  entry?: string | undefined;
  exits?: string[] | undefined;
  sections?: GraphSection[] | undefined;
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  run?: RunFacts | undefined;
}
