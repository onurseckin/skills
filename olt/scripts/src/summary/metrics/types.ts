import type { EvidenceClass, JsonObject, JsonValue } from "../../core/contracts/index.ts";

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
