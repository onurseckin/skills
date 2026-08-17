import type { JsonObject, JsonValue } from "../contracts/json.ts";
import type {
  BadgeDetail,
  EdgeContainerDetail,
  EdgeHandoff,
  EdgeKind,
  EdgeTrafficDetail,
  EdgeTrafficExchange,
  ExchangeFinding,
  ExchangeResolutionProof,
  ExchangeTransferredFile,
  FileRef,
  FindingDetail,
  GraphDataset,
  GraphEdgeData,
  GraphNodeData as RawGraphNodeData,
  GraphSection,
  IoPort,
  MediaAsset,
  ModelTier,
  NodeKind,
  NodeStatus,
  PayloadKind,
  PlaywrightMetadata,
} from "./graph-types.ts";

export type {
  BadgeDetail,
  EdgeContainerDetail,
  EdgeHandoff,
  EdgeKind,
  EdgeTrafficDetail,
  EdgeTrafficExchange,
  ExchangeFinding,
  ExchangeResolutionProof,
  ExchangeTransferredFile,
  FileRef,
  FindingDetail,
  GraphDataset,
  GraphEdgeData,
  GraphSection,
  IoPort,
  MediaAsset,
  ModelTier,
  NodeKind,
  NodeStatus,
  PayloadKind,
  PlaywrightMetadata,
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
}

export interface HostAgentMetadata {
  hostTool: "antigravity" | "claude-code" | "cursor" | "codex" | "custom" | "unknown";
  modelName?: string | undefined;
  thinkingLevel?: "high" | "medium" | "low" | "off" | string | undefined;
  modelTier?: "xs" | "s" | "m" | "l" | undefined;
  tokens?: TokenUsageDetail | undefined;
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
  hostAgent?: HostAgentMetadata | undefined;
  timingBreakdown?: TimingBreakdown | undefined;
}

export interface CommandExecutionDetail {
  id: string;
  argv: string[];
  cwd: string;
  exitCode: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  stdoutSnippet?: string | undefined;
  stderrSnippet?: string | undefined;
  stdoutTail?: string | undefined;
  stderrTail?: string | undefined;
  logPath?: string | undefined;
}

export interface GraphNodeData extends Omit<RawGraphNodeData, "metrics" | "metadata"> {
  metrics?: NodeMetrics | undefined;
  metadata?:
    | {
        commands?: CommandExecutionDetail[] | undefined;
        findings?: FindingDetail[] | undefined;
        writeScope?: string[] | undefined;
        leaseAgent?: string | undefined;
        validator_id?: string | undefined;
        validatorId?: string | undefined;
        repairRounds?: number | undefined;
        validationHistory?: unknown[] | undefined;
        mediaAssets?: MediaAsset[] | undefined;
        screenshots?: MediaAsset[] | undefined;
        assets?: MediaAsset[] | undefined;
        playwrightMetadata?: PlaywrightMetadata | undefined;
        opposedChangesCount?: number | undefined;
        pushbackCount?: number | undefined;
        critic_id?: string | undefined;
        criticId?: string | undefined;
        status?: string | undefined;
        unresolved_finding_ids?: string[] | undefined;
        unresolvedFindingIds?: string[] | undefined;
        residual_risks?: unknown[] | undefined;
        requirement_proofs?: unknown[] | undefined;
        [key: string]: unknown;
      }
    | undefined;
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
  total_edge_traffic_exchanges: number;
  total_edge_traffic_tokens: number;
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
