import type { EvidenceClass } from "../core/contracts/evidence.ts";
import type { JsonObject, JsonValue } from "../core/contracts/json.ts";
import type {
  ActionKind,
  ActionOutcome,
  ActionStepRecord,
  ActionTarget,
  BadgeDetail,
  BrowserTestRun,
  BrowserTestViewport,
  EdgeContainerDetail,
  EdgeExchange,
  EdgeKind,
  EdgeTrafficDetail,
  EdgeVariant,
  ExchangeFinding,
  ExchangeTransferredFile,
  ExchangeType,
  FileRef,
  FindingDetail,
  GraphDataset,
  GraphEdgeData,
  GraphNodeData as RawGraphNodeData,
  GraphSection,
  IoPort,
  MediaAsset,
  NamedBrowserTestViewport,
  NodeFinding,
  NodeKind,
  NodeRole,
  NodeScript,
  NodeStateTransition,
  NodeStatus,
  NodeTelemetry,
  NodeTool,
  NodeValidatorDomain,
  PayloadKind,
  RunCompletionFacts,
  RunEnhancedPlanFacts,
  RunFacts,
  RunIntegrityFacts,
  RunPromptFacts,
  RunReportFacts,
  RunRepositoryFacts,
  RunRequirementFacts,
} from "./graph/graph-types.ts";

export type {
  ActionKind,
  ActionOutcome,
  ActionStepRecord,
  ActionTarget,
  BadgeDetail,
  BrowserTestRun,
  BrowserTestViewport,
  EdgeContainerDetail,
  EdgeExchange,
  EdgeKind,
  EdgeTrafficDetail,
  EdgeVariant,
  ExchangeFinding,
  ExchangeTransferredFile,
  ExchangeType,
  FileRef,
  FindingDetail,
  GraphDataset,
  GraphEdgeData,
  GraphSection,
  IoPort,
  MediaAsset,
  NamedBrowserTestViewport,
  NodeFinding,
  NodeKind,
  NodeRole,
  NodeScript,
  NodeStateTransition,
  NodeStatus,
  NodeTelemetry,
  NodeTool,
  NodeValidatorDomain,
  PayloadKind,
  RunCompletionFacts,
  RunEnhancedPlanFacts,
  RunFacts,
  RunIntegrityFacts,
  RunPromptFacts,
  RunReportFacts,
  RunRepositoryFacts,
  RunRequirementFacts,
};

export interface TokenUsageDetail {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  reasoningTokens?: number | undefined;
  cacheCreationTokens?: number | undefined;
  cacheReadTokens?: number | undefined;
  totalTokens?: number | undefined;
  costUsd?: number | undefined;
  isEstimated?: boolean | undefined;
  evidenceClass?: EvidenceClass | undefined;
}

export interface HostIdentity {
  hostTool: string;
  evidenceClass: EvidenceClass;
}

export interface TimingBreakdown {
  wallDurationMs: number;
  activeCommandMs: number;
  cognitiveLatencyMs: number;
  validationDurationMs?: number | undefined;
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

export interface GraphNodeData extends Omit<RawGraphNodeData, "metrics" | "metadata"> {
  metrics?: NodeMetrics | undefined;
  metadata?: NodeMetadata | undefined;
}

export interface TimelineEventRecord extends JsonObject {
  sequence: number;
  timestamp: string;
  actor: string;
  event: string;
  phase: string;
  summary: string;
  payload_ref?: string;
  task_id?: string;
  gate_id?: string;
  command_id?: string;
  round?: number;
  tokens?: number;
  cost_usd?: number;
  duration_ms?: number;
  pushback_reason?: string;
  findings?: JsonValue;
  severity?: string;
  validator_id?: string;
}

export interface TokenEstimation extends JsonObject {
  tokens_in: number;
  tokens_out: number;
  total_tokens: number;
}

export interface FileChurnRecord extends JsonObject {
  path: string;
  additions: number;
  deletions: number;
}

export interface PushbackRoundRecord extends JsonObject {
  task_id: string;
  round: number;
  findings_count: number;
  reason?: string;
}

export interface RollupMetrics extends JsonObject {
  run_id: string;
  total_tasks: number;
  satisfied_tasks: number;
  failed_tasks: number;
  repair_rounds_total: number;
  pushbacks_total: number;
  pushback_rounds: PushbackRoundRecord[];
  resolved_findings_total: number;
  open_findings_total: number;
  total_media_assets: number;
  total_edge_traffic_exchanges?: number;
  wall_duration_ms: number;
  active_command_duration_ms: number;
  total_commands_executed: number;
  total_gates_passed: number;
  estimated_tokens: TokenEstimation;
  files_touched: FileChurnRecord[];
}

export interface SummarySuite {
  timeline: TimelineEventRecord[];
  metrics: RollupMetrics;
  graph: GraphDataset;
  markdown: string;
}

export interface SummaryGenerationOptions {
  outDir?: string | undefined;
  capsulePath: string;
  writeToDisk?: boolean | undefined;
}
