import type { JsonObject } from "../contracts/json.ts";

export type NodeKind = "orchestrator" | "agent" | "tool" | "router" | "join" | "gate" | "critic" | "terminal" | "input";
export type NodeStatus = "pending" | "running" | "success" | "error" | "warning" | "skipped" | "cached";
export type EdgeKind = "sequence" | "spawn" | "conditional" | "loop" | "fallback" | "join" | "data";
export type PayloadKind = "prompt" | "full-context" | "summary" | "artifact" | "decision" | "file";
export type ModelTier = "xs" | "s" | "m" | "l";

export interface FileRef {
  path: string;
  mode?: "read" | "write" | "attach";
  lines?: string;
  additions?: number;
  deletions?: number;
}

export interface IoPort {
  node?: string;
  kind: PayloadKind;
  label: string;
  tokens?: number;
  dataRef?: string;
}

export interface NodeMetrics {
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  durationMs?: number;
  retries?: number;
  commandCount?: number;
}

export interface CommandExecutionDetail {
  id: string;
  argv: string[];
  cwd: string;
  exitCode: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  stdoutTail?: string;
  stderrTail?: string;
  logPath?: string;
}

export interface FindingDetail {
  id: string;
  requirementId: string;
  severity: "critical" | "important" | "suggestion";
  observation: string;
  remediation: string;
  status: "open" | "resolved";
  revalidationProof?: { method: string; evidence: string[] };
}

export interface GraphSection {
  id: string;
  title: string;
  description?: string;
  color?: string;
  nodeIds: string[];
  collapsed?: boolean;
}

export interface GraphNodeData {
  id: string;
  name: string;
  description?: string;
  type?: string;
  kind?: NodeKind;
  status?: NodeStatus;
  model?: string;
  harnessModel?: string;
  tier?: ModelTier;
  sectionId?: string;
  badges?: Array<{ label: string; variant?: "success" | "info" | "amber" | "error" | "gray" }>;
  tools?: Array<{ name: string; type?: "generic" | "custom" }>;
  files?: FileRef[];
  metrics?: NodeMetrics;
  io?: { inputs?: IoPort[]; outputs?: IoPort[] };
  prompt?: string;
  output?: string;
  logs?: string;
  metadata?: {
    commands?: CommandExecutionDetail[];
    findings?: FindingDetail[];
    writeScope?: string[];
    leaseAgent?: string;
    repairRounds?: number;
    [key: string]: unknown;
  };
  rank?: number;
  group?: string;
}

export interface EdgeHandoff {
  kind: PayloadKind;
  summary?: string;
  tokens?: number;
}

export interface GraphEdgeData {
  id: string;
  source: string;
  target: string;
  label?: string;
  directed?: boolean;
  isCycle?: boolean;
  kind?: EdgeKind;
  condition?: string;
  handoff?: EdgeHandoff;
  weight?: number;
  minLen?: number;
}

export interface GraphDataset {
  id: string;
  title: string;
  description?: string;
  directed?: boolean;
  entry?: string;
  exits?: string[];
  sections?: GraphSection[];
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
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

export interface RollupMetrics extends JsonObject {
  run_id: string;
  total_tasks: number;
  satisfied_tasks: number;
  failed_tasks: number;
  repair_rounds_total: number;
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
  outDir?: string;
  capsulePath: string;
  writeToDisk?: boolean;
}
