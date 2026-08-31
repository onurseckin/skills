/**
 * @file types.ts
 * Type definitions for behavioral forensics, token burn detection, and efficiency scoring.
 */

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

export type FeedbackPriority =
  | "CRITICAL_USER_FEEDBACK"
  | "HIGH_ARCHITECTURAL_FEATURE"
  | "NORMAL"
  | "LOW";

export type FeedbackCategory =
  | "CORE_ENGINE"
  | "AGENT_CONTRACTS"
  | "CLI_TOOLING"
  | "SCALING"
  | "WATCHDOG"
  | "ARCHITECTURE"
  | "HEURISTICS";

export interface BehavioralForensicsIncident {
  readonly id: string;
  readonly category: RootCauseCategory;
  readonly severity: ForensicsSeverity;
  readonly title: string;
  readonly description: string;
  readonly observation: string;
  readonly remediation: string;
  readonly recommendation: string;
  readonly agentId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly toolCallsCount?: number | undefined;
  readonly metricsSnapshot?: Readonly<Record<string, number | string>> | undefined;
}

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

export interface TaskRecord {
  readonly id: string;
  readonly status: string;
  readonly writeScope: readonly string[];
  readonly dependencies: readonly string[];
  readonly startedAt?: number | undefined;
  readonly completedAt?: number | undefined;
  readonly durationSec?: number | undefined;
  readonly lease?:
    | { readonly agentId?: string | undefined; readonly expiresAt?: number | undefined }
    | undefined;
}

export interface AgentRecord {
  readonly id: string;
  readonly role?: string | undefined;
  readonly status?: string | undefined;
  readonly tokensIn?: number | undefined;
  readonly tokensOut?: number | undefined;
  readonly totalTokens?: number | undefined;
}

export interface BehavioralForensicsContext {
  readonly allToolCalls: readonly ExtractedToolCall[];
  readonly events: readonly Record<string, unknown>[];
  readonly tasks?: readonly TaskRecord[] | undefined;
  readonly agents?: readonly AgentRecord[] | undefined;
  readonly state?: Record<string, unknown> | null | undefined;
  readonly agentId?: string | undefined;
  readonly addIncident: (inc: BehavioralForensicsIncident) => void;
}

export interface QuantitativeDeduction {
  readonly reason: string;
  readonly pointsDeducted: number;
  readonly category: RootCauseCategory | "EFFICIENCY_RATIO" | "POLLING" | "BOTTLENECK";
}

export interface QuantitativeEfficiencyReport {
  readonly rawScore: number;
  readonly boundedScore: number;
  readonly formattedScore: string;
  readonly percentage: number;
  readonly deductions: readonly QuantitativeDeduction[];
  readonly baseline: number;
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

export interface BehavioralForensicsMetrics {
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
  readonly totalTokensIn: number;
  readonly totalTokensOut: number;
  readonly incidentCountsByCategory: Readonly<Record<RootCauseCategory, number>>;
  readonly incidentCountsBySeverity: Readonly<Record<ForensicsSeverity, number>>;
}

export interface BehavioralForensicsSummary {
  readonly clean: boolean;
  readonly totalIncidents: number;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly mediumCount: number;
  readonly lowCount: number;
  readonly summaryText: string;
}

export interface BehavioralForensicsAnalysisResult {
  readonly runId: string;
  readonly analyzedAt: string;
  readonly isClean: boolean;
  readonly efficiencyScore: number;
  readonly efficiencyReport: QuantitativeEfficiencyReport;
  readonly summary: BehavioralForensicsSummary;
  readonly metrics: BehavioralForensicsMetrics;
  readonly incidents: readonly BehavioralForensicsIncident[];
  readonly proposals: readonly PlanInjectionProposal[];
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
