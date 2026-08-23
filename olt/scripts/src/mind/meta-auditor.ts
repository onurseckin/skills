import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { AgentGrantRecord } from "../contracts/agents.ts";
import type { HarnessEvent, Manifest, RunState } from "../contracts/capsule.ts";
import { isJsonObject } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import {
  appendFeedbackItem,
  readFeedbackQueue,
  resolveCanonicalFeedbackQueuePath,
  resolveFeedbackQueuePath,
  writeFeedbackQueue,
  type FeedbackCategory,
  type FeedbackItem,
  type FeedbackPriority,
} from "./feedback-queue.ts";

/**
 * Root-cause classification categories for behavioral forensics.
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

/**
 * Severity levels for forensics incidents.
 */
export type ForensicsSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export const FORENSICS_SEVERITIES: readonly ForensicsSeverity[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
] as const;

/**
 * An individual behavioral defect or anomaly incident detected during run forensics.
 */
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
  readonly evidence?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Efficiency metrics formatted for reports and CLI.
 */
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

/**
 * Comprehensive operational and efficiency metrics gathered during forensics analysis.
 */
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

/**
 * Summary structure of a forensics run.
 */
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

/**
 * Remediation proposal synthesized from forensics incidents for injection into the feedback queue.
 */
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

/**
 * The top-level output of the deep behavioral forensics engine.
 */
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

/**
 * Options for running deep behavioral forensics.
 */
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

/**
 * Options for feedback queue injection.
 */
export interface FeedbackInjectionOptions {
  readonly run?: string | undefined;
  readonly queue_path?: string | undefined;
  readonly customRoot?: string | undefined;
}

/**
 * Result of injecting proposals into the feedback queue.
 */
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

/**
 * Tool call record extracted from transcripts or event logs.
 */
export interface ExtractedToolCall {
  readonly agentId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly name: string;
  readonly timestamp?: string | undefined;
  readonly isRead: boolean;
  readonly isWrite: boolean;
  readonly isPoll: boolean;
  readonly targetPath?: string | undefined;
  readonly waitMsBeforeAsync?: number | undefined;
  readonly rawArguments?: Readonly<Record<string, unknown>> | undefined;
}

const READ_TOOLS: ReadonlySet<string> = new Set([
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

const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "write_to_file",
  "replace_file_content",
  "notebook_edit",
  "generate_image",
  "edit_file",
]);

const POLL_TOOLS: ReadonlySet<string> = new Set(["manage_task", "schedule"]);

/**
 * Safely parses a JSON string into an unknown object or null.
 */
function safeParseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Generates a unique incident ID.
 */
function generateIncidentId(category: RootCauseCategory, suffix: string): string {
  const hash = createHash("sha256")
    .update(`${category}:${suffix}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 8);
  return `inc-${category.toLowerCase().replace(/_/g, "-")}-${hash}`;
}

/**
 * Generates a proposal ID.
 */
function generateProposalId(category: RootCauseCategory): string {
  const rand = randomBytes(4).toString("hex");
  return `prop-${category.toLowerCase().replace(/_/g, "-")}-${rand}`;
}

/**
 * Checks whether a tool name is a reading/browsing tool.
 */
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

/**
 * Checks whether a tool name is a writing/editing tool.
 */
export function isWriteTool(toolName: string): boolean {
  const norm = toolName.toLowerCase().replace(/^mcp_[^_]+_/, "");
  return (
    WRITE_TOOLS.has(norm) ||
    norm.includes("write") ||
    norm.includes("replace") ||
    norm.includes("edit")
  );
}

/**
 * Checks whether a tool call is a polling/status management tool call.
 */
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

/**
 * Parses events from an events.jsonl file path.
 */
function parseEventsFile(filePath: string): HarnessEvent[] {
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

/**
 * Parses a state.json file.
 */
function parseStateFile(filePath: string): RunState | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = safeParseJson(raw);
    if (isJsonObject(parsed)) {
      return parsed as unknown as RunState;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parses manifest.json file.
 */
function parseManifestFile(filePath: string): Manifest | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = safeParseJson(raw);
    if (isJsonObject(parsed)) {
      return parsed as unknown as Manifest;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts tool calls from raw transcript strings or files.
 */
function extractToolCallsFromTranscripts(transcripts: readonly string[]): ExtractedToolCall[] {
  const calls: ExtractedToolCall[] = [];

  for (const item of transcripts) {
    let text = item;
    if (existsSync(item)) {
      try {
        text = readFileSync(item, "utf8");
      } catch {
        text = item;
      }
    }

    const parsed = safeParseJson(text);
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (isJsonObject(entry)) {
          const name =
            typeof entry["name"] === "string"
              ? (entry["name"] as string)
              : typeof entry["tool"] === "string"
                ? (entry["tool"] as string)
                : "unknown";
          const args = isJsonObject(entry["arguments"])
            ? (entry["arguments"] as Record<string, unknown>)
            : isJsonObject(entry["parameters"])
              ? (entry["parameters"] as Record<string, unknown>)
              : undefined;
          const agentId =
            typeof entry["agent_id"] === "string"
              ? (entry["agent_id"] as string)
              : typeof entry["agentId"] === "string"
                ? (entry["agentId"] as string)
                : undefined;
          const taskId =
            typeof entry["task_id"] === "string"
              ? (entry["task_id"] as string)
              : typeof entry["taskId"] === "string"
                ? (entry["taskId"] as string)
                : undefined;
          const timestamp =
            typeof entry["timestamp"] === "string" ? (entry["timestamp"] as string) : undefined;
          const waitMs =
            typeof args?.["WaitMsBeforeAsync"] === "number"
              ? (args["WaitMsBeforeAsync"] as number)
              : undefined;
          const targetPath =
            typeof args?.["AbsolutePath"] === "string"
              ? (args["AbsolutePath"] as string)
              : typeof args?.["TargetFile"] === "string"
                ? (args["TargetFile"] as string)
                : typeof args?.["DirectoryPath"] === "string"
                  ? (args["DirectoryPath"] as string)
                  : undefined;

          calls.push({
            agentId,
            taskId,
            name,
            timestamp,
            isRead: isReadTool(name),
            isWrite: isWriteTool(name),
            isPoll: isPollTool(name, args),
            targetPath,
            waitMsBeforeAsync: waitMs,
            rawArguments: args,
          });
        }
      }
      continue;
    }

    const toolRegex =
      /(?:call:\s*(?:default_api:)?([a-zA-Z0-9_-]+)|Tool Use:\s*([a-zA-Z0-9_-]+)|"toolAction":\s*"([^"]+)")/g;
    let match: RegExpExecArray | null = toolRegex.exec(text);
    while (match !== null) {
      const toolName = match[1] ?? match[2] ?? match[3] ?? "unknown";
      calls.push({
        name: toolName,
        isRead: isReadTool(toolName),
        isWrite: isWriteTool(toolName),
        isPoll: isPollTool(toolName),
      });
      match = toolRegex.exec(text);
    }
  }

  return calls;
}

/**
 * Extracts tool calls from events.jsonl
 */
function extractToolCallsFromEvents(events: readonly HarnessEvent[]): ExtractedToolCall[] {
  const calls: ExtractedToolCall[] = [];

  for (const event of events) {
    const actor = event.actor;
    const kind = event.kind;
    const payload = event.payload;

    if (kind === "command-started" || kind === "command-executed" || kind === "tool-called") {
      const toolName =
        typeof payload["tool"] === "string"
          ? (payload["tool"] as string)
          : typeof payload["command"] === "string"
            ? (payload["command"] as string)
            : kind;
      const args = isJsonObject(payload["arguments"])
        ? (payload["arguments"] as Record<string, unknown>)
        : undefined;
      const taskId =
        typeof payload["task_id"] === "string" ? (payload["task_id"] as string) : undefined;
      const waitMs =
        typeof args?.["WaitMsBeforeAsync"] === "number"
          ? (args["WaitMsBeforeAsync"] as number)
          : undefined;
      const targetPath =
        typeof args?.["AbsolutePath"] === "string"
          ? (args["AbsolutePath"] as string)
          : typeof args?.["TargetFile"] === "string"
            ? (args["TargetFile"] as string)
            : undefined;

      calls.push({
        agentId: actor,
        taskId,
        name: toolName,
        timestamp: event.timestamp,
        isRead: isReadTool(toolName),
        isWrite: isWriteTool(toolName),
        isPoll: isPollTool(toolName, args),
        targetPath,
        waitMsBeforeAsync: waitMs,
        rawArguments: args,
      });
    }
  }

  return calls;
}

/**
 * Deterministically computes an efficiency score between 0.0 and 100.0.
 */
export function calculateEfficiencyScore(
  metrics: Partial<ForensicsMetrics>,
  incidents: readonly ForensicsIncident[],
): number {
  let score = 100.0;

  for (const inc of incidents) {
    switch (inc.severity) {
      case "CRITICAL":
        score -= 25.0;
        break;
      case "HIGH":
        score -= 15.0;
        break;
      case "MEDIUM":
        score -= 8.0;
        break;
      case "LOW":
        score -= 3.0;
        break;
    }
  }

  const readToWrite = metrics.readToWriteRatio ?? 0;
  if (readToWrite > 15.0) {
    score -= Math.min(20.0, (readToWrite - 15.0) * 1.5);
  }

  const polling = metrics.pollingCallsCount ?? 0;
  if (polling > 5) {
    score -= Math.min(15.0, (polling - 5) * 2.0);
  }

  const seqBottlenecks = metrics.sequentialWaveBottlenecks ?? 0;
  if (seqBottlenecks > 0) {
    score -= Math.min(15.0, seqBottlenecks * 5.0);
  }

  return Math.max(0.0, Math.min(100.0, Math.round(score * 10) / 10));
}

/**
 * Formats a comprehensive markdown report from a forensics analysis result.
 */
export function formatForensicsReport(result: ForensicsAnalysisResult): string {
  const lines: string[] = [];

  lines.push(`# Skill Meta-Auditor Deep Behavioral Forensics Report`);
  lines.push(``);
  lines.push(`- **Run ID**: \`${result.runId}\``);
  lines.push(`- **Capsule Root**: \`${result.capsuleRoot}\``);
  lines.push(`- **Analyzed At**: \`${result.analyzedAt}\``);
  lines.push(`- **Efficiency Score**: **${result.efficiencyScore.toFixed(1)} / 100**`);
  lines.push(
    `- **Overall Verdict**: **${result.isClean ? "CLEAN / OPTIMIZED" : "DEVIATIONS DETECTED"}**`,
  );
  lines.push(``);

  lines.push(`## Operational Metrics`);
  lines.push(``);
  lines.push(`| Metric | Value | Reference Baseline |`);
  lines.push(`| :--- | :--- | :--- |`);
  lines.push(`| Total Subagents | \`${result.metrics.totalAgents}\` | N/A |`);
  lines.push(`| Total Tasks | \`${result.metrics.totalTasks}\` | N/A |`);
  lines.push(`| Total Events | \`${result.metrics.totalEvents}\` | N/A |`);
  lines.push(
    `| Total Tokens (In / Out) | \`${result.metrics.totalTokensIn.toLocaleString()}\` / \`${result.metrics.totalTokensOut.toLocaleString()}\` | Token efficiency |`,
  );
  lines.push(
    `| File Reads / Writes | \`${result.metrics.fileReadCount}\` / \`${result.metrics.fileWriteCount}\` | Read/Write ratio \`${result.metrics.readToWriteRatio.toFixed(2)}\` |`,
  );
  lines.push(
    `| Polling / Status Calls | \`${result.metrics.pollingCallsCount}\` | Baseline: 0 (reactive only) |`,
  );
  lines.push(
    `| Sequential Wave Bottlenecks | \`${result.metrics.sequentialWaveBottlenecks}\` | Target: 0 |`,
  );
  lines.push(
    `| Role Boundary Deviations | \`${result.metrics.boundaryDeviationsCount}\` | Invariant: 0 |`,
  );
  lines.push(`| Straggler Tasks | \`${result.metrics.stragglerTasksCount}\` | Target: 0 |`);
  lines.push(`| Ghost Leases | \`${result.metrics.ghostLeasesCount}\` | Invariant: 0 |`);
  lines.push(``);

  lines.push(`## Behavioral Forensics Incidents (${result.incidents.length})`);
  lines.push(``);

  if (result.incidents.length === 0) {
    lines.push(`> [!NOTE]`);
    lines.push(
      `> No behavioral deviations, token burning, or concurrency bottlenecks were detected in this run.`,
    );
    lines.push(``);
  } else {
    for (const inc of result.incidents) {
      lines.push(`### [${inc.severity}] ${inc.title} (\`${inc.id}\`)`);
      lines.push(`- **Category**: \`${inc.category}\``);
      if (inc.agentId) lines.push(`- **Agent**: \`${inc.agentId}\``);
      if (inc.taskId) lines.push(`- **Task**: \`${inc.taskId}\``);
      lines.push(`- **Description**: ${inc.description}`);
      lines.push(`- **Recommendation**: ${inc.recommendation}`);
      lines.push(``);
    }
  }

  lines.push(`## Autonomous Remediation Proposals (${result.proposals.length})`);
  lines.push(``);

  if (result.proposals.length === 0) {
    lines.push(`No remediation proposals required.`);
  } else {
    for (const prop of result.proposals) {
      lines.push(`- **[${prop.priority}] ${prop.title}** (\`${prop.id}\`)`);
      lines.push(`  * Root Cause: \`${prop.rootCause}\` | Category: \`${prop.category}\``);
      lines.push(`  * Directive: ${prop.remediationDirective}`);
      lines.push(``);
    }
  }

  return lines.join("\n");
}

/**
 * Renders an ASCII table summary of forensics incidents.
 */
export function renderForensicsAsciiTable(incidents: readonly ForensicsIncident[]): string {
  if (incidents.length === 0) {
    return "+-------------------------------------------------------------------------+\n| No forensics incidents detected. Run is fully compliant.                |\n+-------------------------------------------------------------------------+";
  }

  const rows = incidents.map((inc) => {
    const id = inc.id.padEnd(24).slice(0, 24);
    const cat = inc.category.padEnd(22).slice(0, 22);
    const sev = inc.severity.padEnd(8).slice(0, 8);
    const agent = (inc.agentId ?? inc.taskId ?? "N/A").padEnd(20).slice(0, 20);
    const title = inc.title.slice(0, 40);
    return `| ${id} | ${cat} | ${sev} | ${agent} | ${title.padEnd(40)} |`;
  });

  const sep =
    "+--------------------------+------------------------+----------+----------------------+------------------------------------------+";
  const header = `| ID                       | Category               | Severity | Target               | Title                                    |\n${sep}`;
  return `${sep}\n${header}\n${rows.join("\n")}\n${sep}`;
}

/**
 * Synthesizes actionable plan injection proposals from detected forensics incidents.
 */
export function synthesizeRemediationPlan(
  incidents: readonly ForensicsIncident[],
): readonly PlanInjectionProposal[] {
  const proposals: PlanInjectionProposal[] = [];
  const seenCategories = new Set<RootCauseCategory>();

  for (const incident of incidents) {
    if (seenCategories.has(incident.category)) {
      continue;
    }
    seenCategories.add(incident.category);

    switch (incident.category) {
      case "TOKEN_BURNING":
        proposals.push({
          id: generateProposalId("TOKEN_BURNING"),
          title: "Enforce Zero-Exploration Exact-Anchor Briefings for Task Implementers",
          content:
            "Forensics identified excessive exploratory reads (>5 browsed files before first edit or high read/write ratio). Enforce exact line ranges, symbol locations, and drop-in code chunks in task briefings to ensure zero-exploration single-turn edits.",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "CORE_ENGINE",
          rootCause: "TOKEN_BURNING",
          targetRole: "coordinator",
          remediationDirective:
            "Generate Exact-Anchor task briefings with explicit file targets, line ranges, and drop-in replacement chunks prior to dispatching implementers.",
          metadata: { incident_ids: [incident.id], detected_at: incident.timestamp },
        });
        break;

      case "FALSE_SERIALIZATION":
        proposals.push({
          id: generateProposalId("FALSE_SERIALIZATION"),
          title: "Maximize Parallel Wave Concurrency for Disjoint Write Scopes",
          content:
            "Forensics detected sequential execution of independent tasks that possessed disjoint write scopes. Implement wave-based concurrency to dispatch independent tasks in parallel.",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "SCALING",
          rootCause: "FALSE_SERIALIZATION",
          targetRole: "coordinator",
          remediationDirective:
            "Batch all tasks with disjoint write scopes into simultaneous execution waves rather than serializing them.",
          metadata: { incident_ids: [incident.id], detected_at: incident.timestamp },
        });
        break;

      case "ROLE_BOUNDARY_DEVIATION":
        proposals.push({
          id: generateProposalId("ROLE_BOUNDARY_DEVIATION"),
          title: "Enforce Supervisory Role Boundary Guardrails & Tool Prohibitions",
          content:
            "Forensics detected role boundary deviations (such as coordinators editing codebase files directly or cognitive validators executing bash/test commands). Enforce strict tool and lease isolation.",
          priority: "CRITICAL_USER_FEEDBACK",
          category: "AGENT_CONTRACTS",
          rootCause: "ROLE_BOUNDARY_DEVIATION",
          targetRole: incident.agentId ?? "coordinator",
          remediationDirective:
            "Prohibit coordinators from direct file edits (delegate to Tier 3 implementers) and prohibit cognitive validators from executing arbitrary write operations.",
          metadata: { incident_ids: [incident.id], detected_at: incident.timestamp },
        });
        break;

      case "POLLING_WASTE":
        proposals.push({
          id: generateProposalId("POLLING_WASTE"),
          title: "Mandate Standard Async WaitMsBeforeAsync: 10000 to Eliminate Polling Waste",
          content:
            "Forensics detected high-frequency status polling loops. Mandate WaitMsBeforeAsync: 10000 across all tool calls and utilize reactive wakeup notifications instead of active poll loops.",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "CLI_TOOLING",
          rootCause: "POLLING_WASTE",
          targetRole: "implementer",
          remediationDirective:
            "Configure WaitMsBeforeAsync: 10000 on command calls and end turns to receive automatic reactive resume notifications.",
          metadata: { incident_ids: [incident.id], detected_at: incident.timestamp },
        });
        break;

      case "CONTEXT_OVERFLOW":
        proposals.push({
          id: generateProposalId("CONTEXT_OVERFLOW"),
          title: "Implement Stream Chunking and Context Truncation for Subagents",
          content:
            "Forensics detected token context saturation or oversized event payloads exceeding safety thresholds. Implement rigorous token caps and stream pruning.",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "CORE_ENGINE",
          rootCause: "CONTEXT_OVERFLOW",
          targetRole: "orchestrator",
          remediationDirective:
            "Truncate verbose tool outputs and enforce Cowan-chunked context limits per subagent turn.",
          metadata: { incident_ids: [incident.id], detected_at: incident.timestamp },
        });
        break;

      case "GHOST_LEASE":
        proposals.push({
          id: generateProposalId("GHOST_LEASE"),
          title: "Enforce Automatic Lease Expiration and Idle Task Reclaim",
          content:
            "Forensics detected ghost leases where tasks were claimed but remained idle without code modifications. Enforce heartbeat deadlines and automated reclamation.",
          priority: "NORMAL",
          category: "WATCHDOG",
          rootCause: "GHOST_LEASE",
          targetRole: "watchdog",
          remediationDirective:
            "Reclaim task leases immediately upon expiration or inactivity timeout exceeding 600 seconds.",
          metadata: { incident_ids: [incident.id], detected_at: incident.timestamp },
        });
        break;

      case "STRAGGLER":
        proposals.push({
          id: generateProposalId("STRAGGLER"),
          title: "Enforce Granular Task Decomposition to Eliminate Straggler Spans",
          content:
            "Forensics detected straggler tasks that disproportionately dominated the execution span. Enforce strict task decomposition to 1-2 files per work unit.",
          priority: "NORMAL",
          category: "ARCHITECTURE",
          rootCause: "STRAGGLER",
          targetRole: "orchestrator",
          remediationDirective:
            "Decompose complex requirements into discrete sub-tasks with small, isolated write scopes.",
          metadata: { incident_ids: [incident.id], detected_at: incident.timestamp },
        });
        break;
    }
  }

  return proposals;
}

/**
 * Injects remediation proposals into the feedback queue.
 */
export function injectRemediationToFeedbackQueue(
  proposalsOrIncidents: readonly (PlanInjectionProposal | ForensicsIncident)[],
  optionsOrRoot?: string | FeedbackInjectionOptions,
): ForensicsInjectionResult {
  if (proposalsOrIncidents.length === 0) {
    return {
      injectedCount: 0,
      injected_count: 0,
      itemIds: [],
      injected_items: [],
      feedbackItems: [],
      feedback_items: [],
    };
  }

  // If passed incidents, synthesize proposals first
  const proposals: readonly PlanInjectionProposal[] =
    proposalsOrIncidents.length > 0 && "remediationDirective" in proposalsOrIncidents[0]!
      ? (proposalsOrIncidents as readonly PlanInjectionProposal[])
      : synthesizeRemediationPlan(proposalsOrIncidents as readonly ForensicsIncident[]);

  let customRoot: string | undefined;
  let customQueuePath: string | undefined;

  if (typeof optionsOrRoot === "string") {
    customRoot = optionsOrRoot;
  } else if (optionsOrRoot !== undefined) {
    customRoot = optionsOrRoot.customRoot ?? optionsOrRoot.run;
    customQueuePath = optionsOrRoot.queue_path;
  }

  const queuePath = customQueuePath
    ? resolve(customQueuePath)
    : resolveFeedbackQueuePath(
        customRoot ? resolveCanonicalFeedbackQueuePath(customRoot) : undefined,
      );

  const existingItems = readFeedbackQueue(queuePath);
  const existingTitles = new Set(existingItems.map((item) => item.title.trim().toLowerCase()));

  const itemIds: string[] = [];
  const injectedItems: FeedbackItem[] = [];

  for (const prop of proposals) {
    const titleNorm = prop.title.trim().toLowerCase();
    if (existingTitles.has(titleNorm)) {
      continue;
    }

    const newItem: FeedbackItem = {
      id: `fb-${Date.now()}-${randomBytes(3).toString("hex")}`,
      timestamp: new Date().toISOString(),
      priority: prop.priority,
      status: "PENDING",
      category: prop.category,
      title: prop.title,
      content: `${prop.content}\n\n**Remediation Directive**: ${prop.remediationDirective}`,
      metadata: {
        root_cause: prop.rootCause,
        target_role: prop.targetRole,
        proposal_id: prop.id,
        ...prop.metadata,
      },
    };

    try {
      appendFeedbackItem(newItem, queuePath);
      itemIds.push(newItem.id);
      injectedItems.push(newItem);
      existingTitles.add(titleNorm);
    } catch {
      const current = readFeedbackQueue(queuePath);
      writeFeedbackQueue([...current, newItem], queuePath);
      itemIds.push(newItem.id);
      injectedItems.push(newItem);
      existingTitles.add(titleNorm);
    }
  }

  return {
    injectedCount: itemIds.length,
    injected_count: itemIds.length,
    itemIds,
    injected_items: itemIds,
    queue_path: queuePath,
    feedbackItems: injectedItems,
    feedback_items: injectedItems,
  };
}

interface TaskOrderEntry {
  readonly id: string;
  readonly writeScope: readonly string[];
  readonly startedAt?: number | undefined;
  readonly completedAt?: number | undefined;
}

/**
 * Analyzes a capsule run root and produces a comprehensive behavioral forensics result.
 */
export function analyzeRunForensics(options: AnalyzeRunForensicsOptions): ForensicsAnalysisResult {
  const rootRaw = options.runRoot ?? options.run;
  if (!rootRaw || !rootRaw.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "runRoot option is required for forensics analysis");
  }

  const runRootPath = resolve(rootRaw.trim());
  const eventsFile = options.eventsPath ?? join(runRootPath, "events.jsonl");
  const stateFile = options.statePath ?? join(runRootPath, "state.json");
  const manifestFile = options.manifestPath ?? join(runRootPath, "manifest.json");

  const events = parseEventsFile(eventsFile);
  const state = parseStateFile(stateFile);
  const manifest = parseManifestFile(manifestFile);

  const runId = options.runId ?? manifest?.run_id ?? basename(runRootPath);
  const analyzedAt = new Date().toISOString();

  // Extract agent ledger
  let agentLedger: readonly AgentGrantRecord[] = [];
  if (options.agentLedger && options.agentLedger.length > 0) {
    agentLedger = options.agentLedger;
  } else if (state && Array.isArray(state["agents"])) {
    agentLedger = state["agents"] as unknown as AgentGrantRecord[];
  }

  // Filter agent ledger if agent filter requested
  if (options.agent) {
    agentLedger = agentLedger.filter((a) => a.id === options.agent);
  }

  // Gather tool calls from transcripts and events
  const transcriptCalls =
    options.transcripts && options.transcripts.length > 0
      ? extractToolCallsFromTranscripts(options.transcripts)
      : [];
  const eventCalls = extractToolCallsFromEvents(events);
  let allToolCalls = [...eventCalls, ...transcriptCalls];

  if (options.agent) {
    allToolCalls = allToolCalls.filter((c) => c.agentId === options.agent);
  }

  // Aggregation variables
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let fileReadCount = 0;
  let fileWriteCount = 0;
  let pollingCallsCount = 0;

  for (const agent of agentLedger) {
    if (typeof agent.tokens_in === "number") totalTokensIn += agent.tokens_in;
    else if (isJsonObject(agent.tokens_in) && typeof agent.tokens_in["value"] === "number") {
      totalTokensIn += agent.tokens_in["value"] as number;
    }
    if (typeof agent.tokens_out === "number") totalTokensOut += agent.tokens_out;
    else if (isJsonObject(agent.tokens_out) && typeof agent.tokens_out["value"] === "number") {
      totalTokensOut += agent.tokens_out["value"] as number;
    }
  }

  for (const call of allToolCalls) {
    if (call.isRead) fileReadCount++;
    if (call.isWrite) fileWriteCount++;
    if (call.isPoll) pollingCallsCount++;
  }

  // Count events that are polling
  for (const ev of events) {
    if (ev.kind === "task-polled" || ev.kind === "agent-polled") {
      pollingCallsCount++;
    }
  }

  const readToWriteRatio = fileWriteCount > 0 ? fileReadCount / fileWriteCount : fileReadCount;

  // Extract tasks from state
  const stateTasks: Record<string, Record<string, unknown>> = {};
  if (state && isJsonObject(state["tasks"])) {
    const rawTasks = state["tasks"] as Record<string, unknown>;
    for (const [k, v] of Object.entries(rawTasks)) {
      if (isJsonObject(v)) stateTasks[k] = v as Record<string, unknown>;
    }
  }

  // Incident collection
  const incidents: ForensicsIncident[] = [];
  const categoryCounts: Record<RootCauseCategory, number> = {
    TOKEN_BURNING: 0,
    FALSE_SERIALIZATION: 0,
    ROLE_BOUNDARY_DEVIATION: 0,
    POLLING_WASTE: 0,
    CONTEXT_OVERFLOW: 0,
    GHOST_LEASE: 0,
    STRAGGLER: 0,
  };
  const severityCounts: Record<ForensicsSeverity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };

  function addIncident(incident: ForensicsIncident): void {
    if (options.agent && incident.agentId && incident.agentId !== options.agent) {
      return;
    }
    incidents.push(incident);
    categoryCounts[incident.category]++;
    severityCounts[incident.severity]++;
  }

  // --- HEURISTIC 1: Token Burning (File browsing before edit / excessive reads) ---
  const agentCallsMap = new Map<string, ExtractedToolCall[]>();
  for (const call of allToolCalls) {
    const agKey = call.agentId ?? "unknown-agent";
    const existing = agentCallsMap.get(agKey) ?? [];
    existing.push(call);
    agentCallsMap.set(agKey, existing);
  }

  for (const [agentId, calls] of agentCallsMap.entries()) {
    let readsBeforeFirstWrite = 0;
    let hasWritten = false;
    const browsedPaths: string[] = [];

    for (const call of calls) {
      if (call.isWrite) {
        hasWritten = true;
        break;
      }
      if (call.isRead) {
        readsBeforeFirstWrite++;
        if (call.targetPath) browsedPaths.push(call.targetPath);
      }
    }

    if (readsBeforeFirstWrite > 5) {
      const title = `Excessive Exploratory Browsing by Agent \`${agentId}\` (${readsBeforeFirstWrite} reads before edit)`;
      const desc = `Agent \`${agentId}\` performed ${readsBeforeFirstWrite} consecutive read/browse tool calls before performing its first code edit. This indicates lack of exact-anchor briefings and burns significant context tokens.`;
      const rec =
        "Provide zero-exploration exact-anchor task briefings containing precise file paths, line ranges, and drop-in code replacements so implementers can make immediate edits.";

      addIncident({
        id: generateIncidentId("TOKEN_BURNING", agentId),
        category: "TOKEN_BURNING",
        severity: readsBeforeFirstWrite > 12 ? "CRITICAL" : "HIGH",
        title,
        description: desc,
        observation: desc,
        remediation: rec,
        recommendation: rec,
        agentId,
        agent_id: agentId,
        root_cause: "Lack of exact-anchor task briefing forcing blind search",
        rootCause: "Lack of exact-anchor task briefing forcing blind search",
        impact: `Wasted ~${readsBeforeFirstWrite * 2000} input tokens in exploratory file reads`,
        evidence: {
          readsBeforeFirstWrite,
          hasWritten,
          browsedPaths: browsedPaths.slice(0, 10),
        },
      });
    }
  }

  // Check overall read-to-write ratio token burning
  if (fileReadCount > 15 && readToWriteRatio > 10.0) {
    const title = `Disproportionate Read-to-Write Ratio (${readToWriteRatio.toFixed(1)}:1)`;
    const desc = `Run executed ${fileReadCount} file read operations against only ${fileWriteCount} write operations (ratio ${readToWriteRatio.toFixed(1)}:1). Blind search and directory browsing dominated over implementation work.`;
    const rec =
      "Equip implementer agents with exact line targets and drop-in anchors to collapse exploration overhead.";

    addIncident({
      id: generateIncidentId("TOKEN_BURNING", "global-ratio"),
      category: "TOKEN_BURNING",
      severity: readToWriteRatio > 25.0 ? "CRITICAL" : "HIGH",
      title,
      description: desc,
      observation: desc,
      remediation: rec,
      recommendation: rec,
      root_cause: "High exploration-to-edit ratio across run",
      rootCause: "High exploration-to-edit ratio across run",
      impact: `Wasted approximately ${Math.round((fileReadCount - 5) * 1800)} tokens on file context`,
      evidence: { fileReadCount, fileWriteCount, readToWriteRatio },
    });
  }

  // --- HEURISTIC 2: False Serialization & Concurrency Bottlenecks ---
  const taskOrder: TaskOrderEntry[] = [];
  for (const [taskId, tObj] of Object.entries(stateTasks)) {
    const ws = Array.isArray(tObj["write_scope"]) ? (tObj["write_scope"] as string[]) : [];
    let sAt: number | undefined = undefined;
    let cAt: number | undefined = undefined;

    if (Array.isArray(tObj["attempts"])) {
      for (const att of tObj["attempts"]) {
        if (isJsonObject(att)) {
          if (typeof att["started_at"] === "string") sAt = Date.parse(att["started_at"] as string);
          if (typeof att["completed_at"] === "string")
            cAt = Date.parse(att["completed_at"] as string);
        }
      }
    }
    taskOrder.push({
      id: taskId,
      writeScope: ws,
      ...(sAt !== undefined ? { startedAt: sAt } : {}),
      ...(cAt !== undefined ? { completedAt: cAt } : {}),
    });
  }

  let sequentialWaveBottlenecks = 0;
  for (let i = 0; i < taskOrder.length - 1; i++) {
    const tA = taskOrder[i];
    const tB = taskOrder[i + 1];
    if (tA && tB && tA.writeScope.length > 0 && tB.writeScope.length > 0) {
      const overlap = tA.writeScope.some((f) => tB.writeScope.includes(f));
      if (!overlap && tA.completedAt && tB.startedAt && tB.startedAt >= tA.completedAt) {
        sequentialWaveBottlenecks++;
      }
    }
  }

  if (sequentialWaveBottlenecks >= 2) {
    const title = `False Serialization Detected: ${sequentialWaveBottlenecks} Disjoint Tasks Executed Serially`;
    const desc = `Identified ${sequentialWaveBottlenecks} instances where tasks with non-overlapping write scopes were executed in sequence rather than parallel wave concurrency.`;
    const rec =
      "Implement Wave Concurrency by grouping ready tasks with disjoint write scopes and dispatching them simultaneously.";

    addIncident({
      id: generateIncidentId("FALSE_SERIALIZATION", "disjoint-tasks"),
      category: "FALSE_SERIALIZATION",
      severity: sequentialWaveBottlenecks >= 4 ? "HIGH" : "MEDIUM",
      title,
      description: desc,
      observation: desc,
      remediation: rec,
      recommendation: rec,
      root_cause: "Missing wave concurrency scheduling for independent task scopes",
      rootCause: "Missing wave concurrency scheduling for independent task scopes",
      impact: `Increased total wall-clock span by approx ${sequentialWaveBottlenecks * 20}s`,
      evidence: { sequentialWaveBottlenecks },
    });
  }

  // --- HEURISTIC 3: Role Boundary Deviation ---
  let boundaryDeviationsCount = 0;
  for (const call of allToolCalls) {
    const agId = (call.agentId ?? "").toLowerCase();
    const isCoordinator = agId.includes("coord") || agId.includes("orchestrat");
    const isValidator = agId.includes("validator") || agId.includes("val_");

    if (isCoordinator && call.isWrite) {
      boundaryDeviationsCount++;
      const title = `Coordinator Direct Code Modification Deviation (\`${call.agentId}\`)`;
      const desc = `Coordinator agent \`${call.agentId}\` directly invoked write tool \`${call.name}\` on \`${call.targetPath ?? "target"}\`. Coordinators must strictly delegate code edits to Tier 3 implementers.`;
      const rec =
        "Enforce strict supervisory persona invariants prohibiting coordinator write actions.";

      addIncident({
        id: generateIncidentId(
          "ROLE_BOUNDARY_DEVIATION",
          `coord-write-${call.targetPath ?? "file"}`,
        ),
        category: "ROLE_BOUNDARY_DEVIATION",
        severity: "CRITICAL",
        title,
        description: desc,
        observation: desc,
        remediation: rec,
        recommendation: rec,
        agentId: call.agentId,
        agent_id: call.agentId,
        root_cause: "Supervisory role directly editing source code",
        rootCause: "Supervisory role directly editing source code",
        impact: "Breached separation of concerns and lease-bounded write scope policy",
        evidence: { tool: call.name, target: call.targetPath },
      });
    }

    if (
      isValidator &&
      (call.isWrite ||
        (call.name === "run_command" &&
          call.rawArguments?.["CommandLine"] &&
          !(call.rawArguments["CommandLine"] as string).includes("test")))
    ) {
      boundaryDeviationsCount++;
      const title = `Validator Execution Boundary Deviation (\`${call.agentId}\`)`;
      const desc = `Validator agent \`${call.agentId}\` performed non-validation execution or write tool \`${call.name}\`. Validators must remain pure cognitive verification actors.`;
      const rec = "Restrict validator tool grants to read, test execution, and packet review APIs.";

      addIncident({
        id: generateIncidentId("ROLE_BOUNDARY_DEVIATION", `validator-action-${call.name}`),
        category: "ROLE_BOUNDARY_DEVIATION",
        severity: "HIGH",
        title,
        description: desc,
        observation: desc,
        remediation: rec,
        recommendation: rec,
        agentId: call.agentId,
        agent_id: call.agentId,
        root_cause: "Validator executing arbitrary bash commands or file modifications",
        rootCause: "Validator executing arbitrary bash commands or file modifications",
        impact: "Bypasses validator cognitive independence",
        evidence: { tool: call.name, arguments: call.rawArguments },
      });
    }
  }

  // --- HEURISTIC 4: Polling Waste ---
  if (pollingCallsCount >= 4) {
    const title = `Excessive Async Polling Loops (${pollingCallsCount} poll calls)`;
    const desc = `Run recorded ${pollingCallsCount} active status/poll requests. Active polling wastes tokens and turns; agents should leverage reactive wakeup notifications with WaitMsBeforeAsync: 10000.`;
    const rec =
      "Enforce WaitMsBeforeAsync: 10000 and stop tool calling to await automatic reactive resumption.";

    addIncident({
      id: generateIncidentId("POLLING_WASTE", "status-loop"),
      category: "POLLING_WASTE",
      severity: pollingCallsCount >= 10 ? "HIGH" : "MEDIUM",
      title,
      description: desc,
      observation: desc,
      remediation: rec,
      recommendation: rec,
      root_cause: "Active status polling instead of reactive wakeup sleep",
      rootCause: "Active status polling instead of reactive wakeup sleep",
      impact: `Wasted approximately ${pollingCallsCount * 500} tokens in redundant status checks`,
      evidence: { pollingCallsCount },
    });
  }

  // --- HEURISTIC 5: Context Overflow ---
  let contextOverflowCount = 0;
  for (const agent of agentLedger) {
    let tIn = 0;
    if (typeof agent.tokens_in === "number") tIn = agent.tokens_in;
    else if (isJsonObject(agent.tokens_in) && typeof agent.tokens_in["value"] === "number") {
      tIn = agent.tokens_in["value"] as number;
    }

    if (tIn > 150000) {
      contextOverflowCount++;
      const title = `Context Saturation for Agent \`${agent.id}\` (${tIn.toLocaleString()} tokens in)`;
      const desc = `Agent \`${agent.id}\` consumed ${tIn.toLocaleString()} prompt input tokens, exceeding the 150,000 threshold and approaching maximum window saturation.`;
      const rec =
        "Implement transcript chunking and purge verbose diagnostic logs prior to subagent turns.";

      addIncident({
        id: generateIncidentId("CONTEXT_OVERFLOW", agent.id),
        category: "CONTEXT_OVERFLOW",
        severity: tIn > 180000 ? "CRITICAL" : "HIGH",
        title,
        description: desc,
        observation: desc,
        remediation: rec,
        recommendation: rec,
        agentId: agent.id,
        agent_id: agent.id,
        root_cause: "Unbounded context accumulation in subagent session",
        rootCause: "Unbounded context accumulation in subagent session",
        impact: "Severe risk of context overflow and degradation of reasoning quality",
        evidence: { agentId: agent.id, tokensIn: tIn },
      });
    }
  }

  // --- HEURISTIC 6: Ghost Lease ---
  let ghostLeasesCount = 0;
  for (const [taskId, tObj] of Object.entries(stateTasks)) {
    const status = tObj["status"];
    const lease = isJsonObject(tObj["lease"]) ? (tObj["lease"] as Record<string, unknown>) : null;
    const originalImplementer =
      typeof tObj["original_implementer"] === "string"
        ? (tObj["original_implementer"] as string)
        : undefined;

    if (status === "leased" || status === "stale") {
      const holder = (lease?.["agent_id"] as string | undefined) ?? originalImplementer;
      if (holder) {
        const agentRecord = agentLedger.find((a) => a.id === holder);
        if (agentRecord?.status === "released") {
          ghostLeasesCount++;
          const title = `Ghost Lease on Task \`${taskId}\` by Released Agent \`${holder}\``;
          const desc = `Task \`${taskId}\` remains leased to agent \`${holder}\`, but the agent grant has already been released without task completion or explicit surrender.`;
          const rec = "Reclaim stale leases immediately upon agent release or heartbeat expiry.";

          addIncident({
            id: generateIncidentId("GHOST_LEASE", taskId),
            category: "GHOST_LEASE",
            severity: "HIGH",
            title,
            description: desc,
            observation: desc,
            remediation: rec,
            recommendation: rec,
            taskId,
            task_id: taskId,
            agentId: holder,
            agent_id: holder,
            root_cause: "Agent released without task surrender or completion",
            rootCause: "Agent released without task surrender or completion",
            impact: "Task deadlock preventing subsequent implementers from claiming work",
            evidence: { taskId, agentId: holder, taskStatus: status },
          });
        }
      }
    }
  }

  // --- HEURISTIC 7: Straggler Tasks ---
  let stragglerTasksCount = 0;
  const taskDurations: Array<{ id: string; durationMs: number }> = [];
  for (const t of taskOrder) {
    if (t.startedAt && t.completedAt && t.completedAt > t.startedAt) {
      taskDurations.push({ id: t.id, durationMs: t.completedAt - t.startedAt });
    }
  }

  if (taskDurations.length >= 3) {
    const avgDuration =
      taskDurations.reduce((sum, d) => sum + d.durationMs, 0) / taskDurations.length;
    for (const td of taskDurations) {
      if (td.durationMs > Math.max(120000, avgDuration * 3.0)) {
        stragglerTasksCount++;
        const title = `Straggler Task Detected: \`${td.id}\` (${Math.round(td.durationMs / 1000)}s runtime)`;
        const desc = `Task \`${td.id}\` required ${Math.round(td.durationMs / 1000)}s to complete, exceeding 3x the average task duration (${Math.round(avgDuration / 1000)}s).`;
        const rec = "Decompose large multi-file tasks into smaller 1-file atomic tasks.";

        addIncident({
          id: generateIncidentId("STRAGGLER", td.id),
          category: "STRAGGLER",
          severity: td.durationMs > 600000 ? "HIGH" : "MEDIUM",
          title,
          description: desc,
          observation: desc,
          remediation: rec,
          recommendation: rec,
          taskId: td.id,
          task_id: td.id,
          root_cause: "Oversized task scope with broad multi-file edit requirements",
          rootCause: "Oversized task scope with broad multi-file edit requirements",
          impact: "Serial execution bottleneck delaying wave completion",
          evidence: { taskId: td.id, durationMs: td.durationMs, avgDurationMs: avgDuration },
        });
      }
    }
  }

  // Synthesize remediation proposals
  const proposals = synthesizeRemediationPlan(incidents);

  // Compute token waste estimate
  const totalTokenWasteEstimate = Math.max(
    0,
    (fileReadCount > 5 ? (fileReadCount - 5) * 2000 : 0) +
      pollingCallsCount * 800 +
      boundaryDeviationsCount * 2500 +
      contextOverflowCount * 20000,
  );

  // Compute metrics
  const partialMetrics: ForensicsMetrics = {
    totalAgents: agentLedger.length,
    totalTasks: Object.keys(stateTasks).length,
    totalEvents: events.length,
    totalTokensIn,
    totalTokensOut,
    totalToolCalls: allToolCalls.length,
    fileReadCount,
    fileWriteCount,
    readToWriteRatio,
    pollingCallsCount,
    sequentialWaveBottlenecks,
    boundaryDeviationsCount,
    stragglerTasksCount,
    ghostLeasesCount,
    contextOverflowCount,
    efficiencyScore: 0,
    total_events_analyzed: events.length,
    total_tool_calls: allToolCalls.length,
    exploration_reads_count: fileReadCount,
    polling_calls_count: pollingCallsCount,
    concurrency_bottlenecks_detected: sequentialWaveBottlenecks,
    role_boundary_deviations: boundaryDeviationsCount,
    total_token_waste_estimate: totalTokenWasteEstimate,
    incidentCountsByCategory: categoryCounts,
    incidentCountsBySeverity: severityCounts,
  };

  const efficiencyScore = calculateEfficiencyScore(partialMetrics, incidents);
  const finalMetrics: ForensicsMetrics = {
    ...partialMetrics,
    efficiencyScore,
    efficiency_score: efficiencyScore,
  };

  const isClean =
    incidents.length === 0 || (severityCounts.CRITICAL === 0 && severityCounts.HIGH === 0);

  const summaryText = isClean
    ? `Run \`${runId}\` achieved high behavioral efficiency (Score: ${efficiencyScore.toFixed(1)}/100) with 0 critical/high deviations.`
    : `Run \`${runId}\` exhibited ${incidents.length} behavioral forensics incidents (Efficiency Score: ${efficiencyScore.toFixed(1)}/100). Synthesized ${proposals.length} remediation proposals.`;

  const summaryObj: ForensicsSummary = {
    clean: isClean,
    total_incidents: incidents.length,
    critical_count: severityCounts.CRITICAL,
    high_count: severityCounts.HIGH,
    medium_count: severityCounts.MEDIUM,
    low_count: severityCounts.LOW,
    text: summaryText,
    toString(): string {
      return summaryText;
    },
  };

  return {
    runId,
    capsuleRoot: runRootPath,
    run_root: runRootPath,
    analyzedAt,
    analyzed_at: analyzedAt,
    ...(options.agent ? { agent_filter: options.agent } : {}),
    isClean,
    efficiencyScore,
    metrics: finalMetrics,
    incidents,
    proposals,
    summary: summaryObj,
  };
}
