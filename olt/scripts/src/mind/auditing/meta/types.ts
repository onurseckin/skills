export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { FeedbackPriority, FeedbackCategory, FeedbackItem } from "../../feedback/index.ts";
import type { AgentGrantRecord, HarnessEvent } from "../../../core/contracts/index.ts";
export type { FeedbackPriority, FeedbackCategory, FeedbackItem, AgentGrantRecord, HarnessEvent };

export type RootCauseCategory =
  | "TOKEN_BURNING"
  | "FALSE_SERIALIZATION"
  | "ROLE_BOUNDARY_DEVIATION"
  | "POLLING_WASTE"
  | "CONTEXT_OVERFLOW"
  | "GHOST_LEASE"
  | "STRAGGLER";

export const ROOT_CAUSE_CATEGORIES: readonly RootCauseCategory[] = [
  "TOKEN_BURNING",
  "FALSE_SERIALIZATION",
  "ROLE_BOUNDARY_DEVIATION",
  "POLLING_WASTE",
  "CONTEXT_OVERFLOW",
  "GHOST_LEASE",
  "STRAGGLER",
] as const;

export type ForensicsCategory = RootCauseCategory;

export type ForensicsSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export const FORENSICS_SEVERITIES: readonly ForensicsSeverity[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
] as const;

export interface ForensicsIncident {
  readonly id: string;
  readonly category: RootCauseCategory;
  readonly severity: ForensicsSeverity;
  readonly title: string;
  readonly description: string;
  readonly observation: string;
  readonly remediation: string;
  readonly recommendation: string;
  readonly agentId?: string | undefined;
  readonly agent_id?: string | undefined;
  readonly taskId?: string | undefined;
  readonly task_id?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly root_cause?: string | undefined;
  readonly rootCause?: string | undefined;
  readonly impact?: string | undefined;
  readonly toolCallsCount?: number | undefined;
  readonly evidence?: Readonly<Record<string, unknown>> | undefined;
}

export interface ForensicsEfficiencyMetrics {
  readonly total_events_analyzed: number;
  readonly total_tool_calls: number;
  readonly exploration_reads_count: number;
  readonly polling_calls_count: number;
  readonly concurrency_bottlenecks_detected: number;
  readonly role_boundary_deviations: number;
  readonly total_token_waste_estimate?: number | undefined;
  readonly efficiency_score?: number | undefined;
}

export interface ForensicsMetrics extends ForensicsEfficiencyMetrics {
  readonly totalAgents: number;
  readonly totalTasks: number;
  readonly totalEvents: number;
  readonly totalTokensIn: number;
  readonly totalTokensOut: number;
  readonly totalToolCalls: number;
  readonly fileReadCount: number;
  readonly fileWriteCount: number;
  readonly readToWriteRatio: number;
  readonly pollingCallsCount: number;
  readonly sequentialWaveBottlenecks: number;
  readonly boundaryDeviationsCount: number;
  readonly stragglerTasksCount: number;
  readonly ghostLeasesCount: number;
  readonly contextOverflowCount: number;
  readonly efficiencyScore: number;
  readonly incidentCountsByCategory: Readonly<Record<RootCauseCategory, number>>;
  readonly incidentCountsBySeverity: Readonly<Record<ForensicsSeverity, number>>;
}

export interface ForensicsSummary {
  readonly clean: boolean;
  readonly total_incidents: number;
  readonly critical_count: number;
  readonly high_count: number;
  readonly medium_count: number;
  readonly low_count: number;
  readonly text: string;
  toString(): string;
}

export interface PlanInjectionProposal {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly priority: FeedbackPriority;
  readonly category: FeedbackCategory;
  readonly rootCause: RootCauseCategory;
  readonly targetRole?: string | undefined;
  readonly targetAgent?: string | undefined;
  readonly remediationDirective: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface ForensicsAnalysisResult {
  readonly runId: string;
  readonly capsuleRoot: string;
  readonly run_root: string;
  readonly analyzedAt: string;
  readonly analyzed_at: string;
  readonly agent_filter?: string | undefined;
  readonly isClean: boolean;
  readonly efficiencyScore: number;
  readonly summary: ForensicsSummary;
  readonly metrics: ForensicsMetrics;
  readonly incidents: readonly ForensicsIncident[];
  readonly proposals: readonly PlanInjectionProposal[];
}

export type ForensicsAnalysisReport = ForensicsAnalysisResult;

export interface AnalyzeRunForensicsOptions {
  readonly runRoot?: string | undefined;
  readonly run?: string | undefined;
  readonly runId?: string | undefined;
  readonly agent?: string | undefined;
  readonly verbose?: boolean | undefined;
  readonly inject?: boolean | undefined;
  readonly transcripts?: readonly string[] | undefined;
  readonly eventsPath?: string | undefined;
  readonly statePath?: string | undefined;
  readonly manifestPath?: string | undefined;
  readonly commandsDir?: string | undefined;
  readonly customFeedbackQueuePath?: string | undefined;
  readonly agentLedger?: readonly AgentGrantRecord[] | undefined;
}

export type MetaAuditAnalysisOptions = AnalyzeRunForensicsOptions;

export interface FeedbackInjectionOptions {
  readonly run?: string | undefined;
  readonly queue_path?: string | undefined;
  readonly customRoot?: string | undefined;
}

export interface ForensicsInjectionResult {
  readonly injectedCount: number;
  readonly injected_count: number;
  readonly itemIds: readonly string[];
  readonly injected_items: readonly string[];
  readonly queue_path?: string | undefined;
  readonly feedbackItems?: readonly FeedbackItem[] | undefined;
  readonly feedback_items?: readonly FeedbackItem[] | undefined;
}

export type FeedbackInjectionResult = ForensicsInjectionResult;

export interface ExtractedToolCall {
  readonly agentId?: string | undefined;
  readonly agentRole?: string | undefined;
  readonly taskId?: string | undefined;
  readonly name: string;
  readonly toolName?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly isRead: boolean;
  readonly isWrite: boolean;
  readonly isPoll: boolean;
  readonly targetPath?: string | undefined;
  readonly waitMsBeforeAsync?: number | undefined;
  readonly rawArguments?: Readonly<Record<string, unknown>> | undefined;
}

export interface HeuristicsContext {
  readonly allToolCalls: readonly ExtractedToolCall[];
  readonly events: readonly Record<string, unknown>[];
  readonly state: Record<string, unknown> | null;
  readonly agentLedger: readonly AgentGrantRecord[];
  readonly agentId?: string | undefined;
  readonly addIncident: (inc: ForensicsIncident) => void;
}

export const READ_TOOLS: ReadonlySet<string> = new Set([
  "view_file",
  "list_dir",
  "find_by_name",
  "grep_search",
  "read_resource",
  "read_url_content",
  "read_browser_page",
  "list_resources",
  "list_console_messages",
  "list_network_requests",
  "get_console_message",
  "get_network_request",
]);

export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "write_to_file",
  "replace_file_content",
  "notebook_edit",
  "generate_image",
  "edit_file",
]);

export const POLL_TOOLS: ReadonlySet<string> = new Set(["manage_task", "schedule"]);

export function safeParseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function generateIncidentId(category: RootCauseCategory, suffix: string): string {
  const hash = createHash("sha256")
    .update(`${category}:${suffix}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 8);
  return `inc-${category.toLowerCase().replace(/_/g, "-")}-${hash}`;
}

export function generateProposalId(category: RootCauseCategory): string {
  const rand = randomBytes(4).toString("hex");
  return `prop-${category.toLowerCase().replace(/_/g, "-")}-${rand}`;
}

export function isReadTool(toolName: string): boolean {
  const norm = toolName.toLowerCase().replace(/^mcp_[^_]+_/, "");
  return (
    READ_TOOLS.has(norm) ||
    norm.includes("read") ||
    norm.includes("view") ||
    norm.includes("list") ||
    norm.includes("find") ||
    norm.includes("grep")
  );
}

export function isWriteTool(toolName: string): boolean {
  const norm = toolName.toLowerCase().replace(/^mcp_[^_]+_/, "");
  return (
    WRITE_TOOLS.has(norm) ||
    norm.includes("write") ||
    norm.includes("replace") ||
    norm.includes("edit")
  );
}

export function isPollTool(toolName: string, args?: Readonly<Record<string, unknown>>): boolean {
  const norm = toolName.toLowerCase().replace(/^mcp_[^_]+_/, "");
  if (POLL_TOOLS.has(norm)) {
    if (args && typeof args["Action"] === "string") {
      const act = args["Action"].toLowerCase();
      return act === "status" || act === "list";
    }
    return true;
  }
  return false;
}

export function parseEventsFile(filePath: string): HarnessEvent[] {
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, "utf8");
    const lines = raw.split("\n");
    const events: HarnessEvent[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = safeParseJson(trimmed);
      if (
        isJsonObject(parsed) &&
        typeof parsed["kind"] === "string" &&
        typeof parsed["sequence"] === "number"
      ) {
        events.push(parsed as unknown as HarnessEvent);
      }
    }
    return events;
  } catch {
    return [];
  }
}
