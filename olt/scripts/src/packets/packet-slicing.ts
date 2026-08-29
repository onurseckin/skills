import { createHash } from "node:crypto";
import type { JsonObject, JsonPrimitive, JsonValue } from "../core/contracts/index.ts";
import { isJsonObject } from "../core/contracts/index.ts";
import type { AgentRole } from "../core/contracts/index.ts";
import { isAgentRole } from "../core/contracts/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../core/json.ts";
import { HarnessError } from "../core/errors/index.ts";
import type { TaskRecord, WorkflowState } from "../workflow/types.ts";
import { buildPacket } from "./render-packet.ts";
import type { BuiltPacket, PacketInput } from "./types.ts";
import {
  excludeValidatorContamination,
  isolateValidatorContext,
  sanitizeLeanContext,
} from "./validator-context.ts";

export const DEFAULT_PACKET_BYTE_BUDGET = 8192;
export const DEFAULT_BRIEF_BYTE_BUDGET = 4096;
export const DEFAULT_BRIEF_MAX_LINES = 30;
export const DEFAULT_LOG_MAX_LINES = 20;
export const DEFAULT_LOG_MAX_BYTES = 2048;
export const DEFAULT_GRAPH_NEIGHBORHOOD_DEPTH = 1;

export interface PacketSizeMetrics {
  readonly byteSize: number;
  readonly lineCount: number;
  readonly sectionCount: number;
  readonly estimatedTokens: number;
  readonly isLean: boolean;
  readonly sectionBreakdown: Readonly<Record<string, number>>;
}

export interface PacketSliceConfig {
  readonly maxBytes?: number;
  readonly maxLines?: number;
  readonly maxLogLines?: number;
  readonly maxArrayItems?: number;
  readonly includeSections?: readonly string[];
  readonly excludeSections?: readonly string[];
  readonly fieldMask?: readonly string[];
  readonly role?: AgentRole;
  readonly focalTaskId?: string;
  readonly neighborhoodDepth?: number;
}

export interface MarkdownSliceConfig {
  readonly includeSections?: readonly string[];
  readonly excludeSections?: readonly string[];
  readonly maxSectionBytes?: number;
  readonly maxTotalBytes?: number;
}

export interface ContextSliceConfig {
  readonly fieldMask?: readonly string[];
  readonly maxBytes?: number;
  readonly priorityKeys?: readonly string[];
  readonly maxArrayItems?: number;
  readonly role?: AgentRole;
}

export interface TaskContractSlice {
  readonly id: string;
  readonly status: string;
  readonly label?: string;
  readonly write_scope: readonly string[];
  readonly resource_scope?: readonly string[];
  readonly requirement_ids: readonly string[];
  readonly dependencies: readonly string[];
  readonly gate?: string;
  readonly repair_round: number;
  readonly attempt_count: number;
}

export interface GraphNodeSummary {
  readonly id: string;
  readonly label?: string;
  readonly status?: string;
}

export interface GraphEdgeSummary {
  readonly from: string;
  readonly to: string;
}

export interface NeighborhoodGraphSlice {
  readonly focalTaskId: string;
  readonly depth: number;
  readonly nodes: readonly GraphNodeSummary[];
  readonly edges: readonly GraphEdgeSummary[];
  readonly upstreamIds: readonly string[];
  readonly downstreamIds: readonly string[];
  readonly totalOriginalNodes: number;
}

export interface LogSliceOptions {
  readonly maxLines?: number;
  readonly maxBytes?: number;
  readonly commandId?: string;
  readonly logPath?: string;
  readonly logSha256?: string;
}

export interface EvidenceExcerpt {
  readonly commandId?: string;
  readonly originalByteSize: number;
  readonly originalLineCount: number;
  readonly headLines: readonly string[];
  readonly tailLines: readonly string[];
  readonly truncatedLinesCount: number;
  readonly isTruncated: boolean;
  readonly formattedExcerpt: string;
  readonly fullLogPath?: string;
  readonly fullLogSha256?: string;
}

export interface EventSliceOptions {
  readonly taskId?: string;
  readonly types?: readonly string[];
  readonly actor?: string;
  readonly since?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface EventSliceResult {
  readonly events: readonly JsonObject[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

export type MetadataSliceTarget =
  | "task"
  | "graph"
  | "events"
  | "evidence"
  | "commands"
  | "requirements"
  | "custom";

export interface MetadataSliceRequest {
  readonly runId: string;
  readonly target: MetadataSliceTarget;
  readonly taskId?: string;
  readonly fields?: readonly string[];
  readonly filter?: JsonObject;
  readonly offset?: number;
  readonly limit?: number;
  readonly depth?: number;
}

export interface MetadataSliceResult {
  readonly schema: "harness.metadata-slice.v1";
  readonly runId: string;
  readonly target: MetadataSliceTarget;
  readonly totalCount: number;
  readonly returnedCount: number;
  readonly truncated: boolean;
  readonly sliceHash: string;
  readonly data: JsonValue;
  readonly pointerUri?: string;
}

export interface LeanBriefOptions {
  readonly runId?: string;
  readonly task?: TaskRecord | TaskContractSlice | JsonObject;
  readonly agentId: string;
  readonly role: AgentRole;
  readonly token?: string;
  readonly leaseDurationMinutes?: number;
  readonly maxLines?: number;
  readonly customGuidance?: readonly string[];
}

export interface ParsedMarkdownSection {
  readonly title: string;
  readonly header: string;
  readonly content: string;
  readonly level: number;
  readonly rawText: string;
}

export function parseMarkdownSections(markdown: string): readonly ParsedMarkdownSection[] {
  const lines = markdown.split("\n");
  const sections: ParsedMarkdownSection[] = [];

  let currentTitle = "Introduction";
  let currentHeader = "";
  let currentLevel = 1;
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (match && match[1] && match[2]) {
      if (currentLines.length > 0 || currentHeader.length > 0) {
        const content = currentLines.join("\n").trim();
        const rawText = currentHeader ? `${currentHeader}\n\n${content}` : content;
        sections.push({
          title: currentTitle,
          header: currentHeader,
          content,
          level: currentLevel,
          rawText,
        });
      }
      currentLevel = match[1].length;
      currentTitle = match[2].trim();
      currentHeader = line;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0 || currentHeader.length > 0) {
    const content = currentLines.join("\n").trim();
    const rawText = currentHeader ? `${currentHeader}\n\n${content}` : content;
    sections.push({
      title: currentTitle,
      header: currentHeader,
      content,
      level: currentLevel,
      rawText,
    });
  }

  return sections;
}

export function calculatePacketSize(packet: BuiltPacket | string): PacketSizeMetrics {
  const markdownText = typeof packet === "string" ? packet : packet.markdown;
  const buffer = Buffer.from(markdownText, "utf-8");
  const byteSize = buffer.byteLength;
  const lineCount = markdownText.length === 0 ? 0 : markdownText.split("\n").length;
  const sections = parseMarkdownSections(markdownText);
  const sectionCount = sections.length;
  const estimatedTokens = Math.ceil(byteSize / 4);
  const isLean = byteSize <= DEFAULT_PACKET_BYTE_BUDGET;

  const sectionBreakdown: Record<string, number> = {};
  for (const sec of sections) {
    sectionBreakdown[sec.title] = Buffer.from(sec.rawText, "utf-8").byteLength;
  }

  return {
    byteSize,
    lineCount,
    sectionCount,
    estimatedTokens,
    isLean,
    sectionBreakdown,
  };
}

export function enforcePacketBudget(
  packet: BuiltPacket,
  maxBytes: number = DEFAULT_PACKET_BYTE_BUDGET,
): {
  readonly compliant: boolean;
  readonly metrics: PacketSizeMetrics;
  readonly violationReason?: string;
} {
  const metrics = calculatePacketSize(packet);
  if (metrics.byteSize > maxBytes) {
    return {
      compliant: false,
      metrics,
      violationReason: `Packet byte size (${metrics.byteSize} bytes) exceeds maximum budget of ${maxBytes} bytes`,
    };
  }
  return {
    compliant: true,
    metrics,
  };
}

export function sliceMarkdownSections(markdown: string, config: MarkdownSliceConfig = {}): string {
  const sections = parseMarkdownSections(markdown);
  const include = config.includeSections
    ? new Set(config.includeSections.map((s) => s.toLowerCase()))
    : null;
  const exclude = config.excludeSections
    ? new Set(config.excludeSections.map((s) => s.toLowerCase()))
    : null;
  const maxSecBytes = config.maxSectionBytes ?? 4096;

  const resultSections: string[] = [];

  for (const sec of sections) {
    const titleLower = sec.title.toLowerCase();

    if (include && !include.has(titleLower)) {
      continue;
    }
    if (exclude && exclude.has(titleLower)) {
      continue;
    }

    let sectionContent = sec.content;
    const sectionBuffer = Buffer.from(sectionContent, "utf-8");

    if (sectionBuffer.byteLength > maxSecBytes) {
      const codeBlockMatch = /^```([a-z0-9_-]*)\n([\s\S]*?)\n```$/u.exec(sectionContent);
      if (codeBlockMatch && codeBlockMatch[2]) {
        const lang = codeBlockMatch[1] ?? "";
        const rawBody = codeBlockMatch[2];
        const lines = rawBody.split("\n");
        const keepHead = lines.slice(0, 10);
        const keepTail = lines.slice(-5);
        const truncatedSummary = `\n  // ... Payload sliced (${lines.length - 15} lines / ${sectionBuffer.byteLength} bytes). Query full data on demand via Harness CLI ...\n`;
        sectionContent = `\`\`\`${lang}\n${keepHead.join("\n")}${truncatedSummary}${keepTail.join("\n")}\n\`\`\``;
      } else {
        const notice = `\n\n[... Section truncated to budget (${sectionBuffer.byteLength} bytes total) ...]`;
        const noticeBytes = Buffer.from(notice, "utf-8").byteLength;
        const keepBytes = Math.max(0, maxSecBytes - noticeBytes);
        const truncatedBytes = sectionBuffer.subarray(0, keepBytes).toString("utf-8");
        sectionContent = `${truncatedBytes}${notice}`;
      }
    }

    if (sec.header) {
      resultSections.push(`${sec.header}\n\n${sectionContent}`.trim());
    } else if (sectionContent.length > 0) {
      resultSections.push(sectionContent);
    }
  }

  let finalMarkdown = resultSections.join("\n\n").trim();

  if (
    config.maxTotalBytes &&
    Buffer.from(finalMarkdown, "utf-8").byteLength > config.maxTotalBytes
  ) {
    const notice = "\n\n[... Packet truncated to maximum total budget ...]";
    const noticeBytes = Buffer.from(notice, "utf-8").byteLength;
    if (config.maxTotalBytes <= noticeBytes) {
      const buf = Buffer.from(notice, "utf-8").subarray(0, config.maxTotalBytes);
      finalMarkdown = buf.toString("utf-8");
    } else {
      const maxTextBytes = config.maxTotalBytes - noticeBytes;
      let textBuf = Buffer.from(finalMarkdown, "utf-8").subarray(0, maxTextBytes);
      let candidate = `${textBuf.toString("utf-8")}${notice}`;
      while (
        Buffer.from(candidate, "utf-8").byteLength > config.maxTotalBytes &&
        textBuf.byteLength > 0
      ) {
        textBuf = textBuf.subarray(0, textBuf.byteLength - 1);
        candidate = `${textBuf.toString("utf-8")}${notice}`;
      }
      finalMarkdown = candidate;
    }
  }

  return finalMarkdown;
}

export function sliceAuthoritativeContext(
  context: JsonObject,
  config: ContextSliceConfig = {},
): JsonObject {
  let workingContext: JsonObject;

  if (config.role === "validator" || config.role === "sub-validator") {
    workingContext = isolateValidatorContext(context);
  } else if (config.role) {
    workingContext = sanitizeLeanContext(context);
  } else {
    workingContext = excludeValidatorContamination(context);
  }

  if (config.fieldMask && config.fieldMask.length > 0) {
    const maskSet = new Set(config.fieldMask);
    const masked: JsonObject = {};
    for (const key of Object.keys(workingContext)) {
      if (maskSet.has(key)) {
        masked[key] = workingContext[key]!;
      }
    }
    workingContext = masked;
  }

  const maxItems = config.maxArrayItems ?? 10;
  const processed: JsonObject = {};

  for (const [key, value] of Object.entries(workingContext)) {
    if (Array.isArray(value)) {
      if (value.length > maxItems) {
        processed[key] = value.slice(0, maxItems).concat([
          {
            _truncated: true,
            _totalCount: value.length,
            _retainedCount: maxItems,
            _notice: "Array sliced for lean context budget. Query full collection via CLI.",
          } as JsonObject,
        ]);
      } else {
        processed[key] = value;
      }
    } else {
      processed[key] = value;
    }
  }

  return processed;
}

export function sliceTaskContract(
  task: TaskRecord | JsonObject,
  role?: AgentRole,
): TaskContractSlice {
  const taskId = typeof task.id === "string" ? task.id : "unknown-task";
  const status = typeof task.status === "string" ? task.status : "unknown";
  const label = typeof task.label === "string" ? task.label : undefined;

  const writeScope = Array.isArray(task.write_scope)
    ? (task.write_scope.filter(
        (item): item is string => typeof item === "string",
      ) as readonly string[])
    : [];

  const resourceScope = Array.isArray(task.resource_scope)
    ? (task.resource_scope.filter(
        (item): item is string => typeof item === "string",
      ) as readonly string[])
    : undefined;

  const requirementIds = Array.isArray(task.requirement_ids)
    ? (task.requirement_ids.filter(
        (item): item is string => typeof item === "string",
      ) as readonly string[])
    : [];

  const dependencies = Array.isArray(task.dependencies)
    ? (task.dependencies.filter(
        (item): item is string => typeof item === "string",
      ) as readonly string[])
    : [];

  const gate = typeof task.gate === "string" ? task.gate : undefined;
  const repairRound = typeof task.repair_round === "number" ? task.repair_round : 0;
  const attempts = Array.isArray(task.attempts) ? task.attempts.length : 0;

  if (role && (role === "validator" || role === "sub-validator")) {
    return {
      id: taskId,
      status,
      ...(label !== undefined ? { label } : {}),
      write_scope: writeScope,
      ...(resourceScope !== undefined ? { resource_scope: resourceScope } : {}),
      requirement_ids: requirementIds,
      dependencies,
      ...(gate !== undefined ? { gate } : {}),
      repair_round: repairRound,
      attempt_count: attempts,
    };
  }

  return {
    id: taskId,
    status,
    ...(label !== undefined ? { label } : {}),
    write_scope: writeScope,
    ...(resourceScope !== undefined ? { resource_scope: resourceScope } : {}),
    requirement_ids: requirementIds,
    dependencies,
    ...(gate !== undefined ? { gate } : {}),
    repair_round: repairRound,
    attempt_count: attempts,
  };
}

export function sliceGraphNeighborhood(
  graph: {
    readonly nodes?: readonly {
      readonly id: string;
      readonly label?: string;
      readonly status?: string;
    }[];
    readonly edges?: readonly { readonly from: string; readonly to: string }[];
  },
  focalTaskId: string,
  depth: number = DEFAULT_GRAPH_NEIGHBORHOOD_DEPTH,
): NeighborhoodGraphSlice {
  const allNodes = graph.nodes ?? [];
  const allEdges = graph.edges ?? [];

  const nodeMap = new Map<string, GraphNodeSummary>();
  for (const n of allNodes) {
    nodeMap.set(n.id, {
      id: n.id,
      ...(n.label !== undefined ? { label: n.label } : {}),
      ...(n.status !== undefined ? { status: n.status } : {}),
    });
  }

  const focalNode = nodeMap.get(focalTaskId) ?? { id: focalTaskId };
  const neighborhoodNodes = new Map<string, GraphNodeSummary>();
  neighborhoodNodes.set(focalTaskId, focalNode);

  const upstreamIds: string[] = [];
  const downstreamIds: string[] = [];
  const neighborhoodEdges: GraphEdgeSummary[] = [];

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const e of allEdges) {
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    outgoing.get(e.from)!.push(e.to);

    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to)!.push(e.from);
  }

  let currentUpstream = [focalTaskId];
  for (let d = 0; d < depth; d++) {
    const nextUpstream: string[] = [];
    for (const id of currentUpstream) {
      const parents = incoming.get(id) ?? [];
      for (const p of parents) {
        if (!neighborhoodNodes.has(p)) {
          const parentNode = nodeMap.get(p) ?? { id: p };
          neighborhoodNodes.set(p, parentNode);
          upstreamIds.push(p);
          nextUpstream.push(p);
        }
      }
    }
    currentUpstream = nextUpstream;
  }

  let currentDownstream = [focalTaskId];
  for (let d = 0; d < depth; d++) {
    const nextDownstream: string[] = [];
    for (const id of currentDownstream) {
      const children = outgoing.get(id) ?? [];
      for (const c of children) {
        if (!neighborhoodNodes.has(c)) {
          const childNode = nodeMap.get(c) ?? { id: c };
          neighborhoodNodes.set(c, childNode);
          downstreamIds.push(c);
          nextDownstream.push(c);
        }
      }
    }
    currentDownstream = nextDownstream;
  }

  for (const e of allEdges) {
    if (neighborhoodNodes.has(e.from) && neighborhoodNodes.has(e.to)) {
      neighborhoodEdges.push({ from: e.from, to: e.to });
    }
  }

  return {
    focalTaskId,
    depth,
    nodes: Array.from(neighborhoodNodes.values()),
    edges: neighborhoodEdges,
    upstreamIds,
    downstreamIds,
    totalOriginalNodes: allNodes.length,
  };
}

export function sliceEvidenceLog(logText: string, options: LogSliceOptions = {}): EvidenceExcerpt {
  const maxLines = options.maxLines ?? DEFAULT_LOG_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_LOG_MAX_BYTES;

  const originalBuffer = Buffer.from(logText, "utf-8");
  const originalByteSize = originalBuffer.byteLength;
  const lines = logText.length === 0 ? [] : logText.split("\n");
  const originalLineCount = lines.length;

  if (originalLineCount <= maxLines && originalByteSize <= maxBytes) {
    const fullLogSha256 = options.logSha256 ?? sha256Bytes(originalBuffer);
    return {
      ...(options.commandId !== undefined ? { commandId: options.commandId } : {}),
      originalByteSize,
      originalLineCount,
      headLines: lines,
      tailLines: [],
      truncatedLinesCount: 0,
      isTruncated: false,
      formattedExcerpt: logText,
      ...(options.logPath !== undefined ? { fullLogPath: options.logPath } : {}),
      ...(fullLogSha256 !== undefined ? { fullLogSha256 } : {}),
    };
  }

  const half = Math.floor(maxLines / 2);
  const headLines = lines.slice(0, half);
  const tailLines = lines.slice(-half);
  const truncatedLinesCount = Math.max(0, originalLineCount - maxLines);

  const pointerInfo = options.logPath ? ` (full log on disk at: ${options.logPath})` : "";
  const marker = `\n[... Log truncated: omitted ${truncatedLinesCount} lines / ${originalByteSize} total bytes${pointerInfo} ...]\n`;
  const formattedExcerpt = `${headLines.join("\n")}${marker}${tailLines.join("\n")}`;

  const fullLogSha256 = options.logSha256 ?? sha256Bytes(originalBuffer);
  return {
    ...(options.commandId !== undefined ? { commandId: options.commandId } : {}),
    originalByteSize,
    originalLineCount,
    headLines,
    tailLines,
    truncatedLinesCount,
    isTruncated: true,
    formattedExcerpt,
    ...(options.logPath !== undefined ? { fullLogPath: options.logPath } : {}),
    ...(fullLogSha256 !== undefined ? { fullLogSha256 } : {}),
  };
}

export function sliceEventStream(
  events: readonly JsonObject[],
  options: EventSliceOptions = {},
): EventSliceResult {
  let filtered = [...events];

  if (options.taskId) {
    filtered = filtered.filter((evt) => {
      const data = isJsonObject(evt.data) ? evt.data : null;
      return evt.task_id === options.taskId || (data && data.task_id === options.taskId);
    });
  }

  if (options.types && options.types.length > 0) {
    const typeSet = new Set(options.types);
    filtered = filtered.filter((evt) => typeof evt.type === "string" && typeSet.has(evt.type));
  }

  if (options.actor) {
    filtered = filtered.filter(
      (evt) => evt.actor === options.actor || evt.agent_id === options.actor,
    );
  }

  if (options.since) {
    const sinceTime = new Date(options.since).getTime();
    if (!Number.isNaN(sinceTime)) {
      filtered = filtered.filter((evt) => {
        if (typeof evt.timestamp === "string") {
          const t = new Date(evt.timestamp).getTime();
          return !Number.isNaN(t) && t >= sinceTime;
        }
        return true;
      });
    }
  }

  const total = filtered.length;
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, options.limit ?? 50);

  const page = filtered.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  return {
    events: page,
    total,
    offset,
    limit,
    hasMore,
  };
}

export function sliceRepositoryDiff(
  diff: string,
  allowedScope: readonly string[],
  maxBytes: number = 4096,
): string {
  if (diff.trim().length === 0) return "";
  if (allowedScope.length === 0) return "[Scope Empty: No diff displayed]";

  const normalizedScope = allowedScope.map((s) => s.replace(/^\.\//u, ""));
  const blocks = diff.split(/^diff --git /mu);
  const keptBlocks: string[] = [];

  for (const block of blocks) {
    if (block.trim().length === 0) continue;
    const headerLine = block.split("\n")[0] ?? "";
    const isMatching = normalizedScope.some((scopePath) => headerLine.includes(scopePath));
    if (isMatching) {
      keptBlocks.push(`diff --git ${block}`);
    }
  }

  const merged = keptBlocks.join("");
  const mergedBuf = Buffer.from(merged, "utf-8");

  if (mergedBuf.byteLength > maxBytes) {
    const notice = `\n\n[... Diff truncated to budget (${mergedBuf.byteLength} bytes total) ...]`;
    const noticeBytes = Buffer.from(notice, "utf-8").byteLength;
    const keepBytes = Math.max(0, maxBytes - noticeBytes);
    const sliced = mergedBuf.subarray(0, keepBytes).toString("utf-8");
    return `${sliced}${notice}`;
  }

  return merged;
}

export function createMetadataSlice(
  state: WorkflowState | JsonObject,
  request: MetadataSliceRequest,
): MetadataSliceResult {
  const runId = request.runId;
  const target = request.target;

  let rawData: JsonValue = null;
  let totalCount = 0;
  let returnedCount = 0;
  let truncated = false;
  let pointerUri: string | undefined;

  switch (target) {
    case "task": {
      const tasks = isJsonObject(state.tasks) ? state.tasks : {};
      if (request.taskId) {
        const t = isJsonObject(tasks[request.taskId]) ? tasks[request.taskId] : null;
        if (!t) {
          throw new HarnessError("INVALID_ARGUMENT", `Task ${request.taskId} not found in state`);
        }
        const sliced = sliceTaskContract(t as TaskRecord);
        rawData = sliced as unknown as JsonObject;
        totalCount = 1;
        returnedCount = 1;
        pointerUri = `.capsules/${runId}/tasks/${request.taskId}`;
      } else {
        const taskEntries = Object.entries(tasks);
        totalCount = taskEntries.length;
        const offset = request.offset ?? 0;
        const limit = request.limit ?? 20;
        const slicedTasks = taskEntries
          .slice(offset, offset + limit)
          .map(([_, t]) => (isJsonObject(t) ? sliceTaskContract(t as TaskRecord) : null))
          .filter((item): item is TaskContractSlice => item !== null);
        rawData = slicedTasks as unknown as JsonValue[];
        returnedCount = slicedTasks.length;
        truncated = offset + limit < totalCount;
        pointerUri = `.capsules/${runId}/state.json`;
      }
      break;
    }
    case "graph": {
      const graph = isJsonObject(state.graph)
        ? (state.graph as unknown as { nodes: GraphNodeSummary[]; edges: GraphEdgeSummary[] })
        : { nodes: [], edges: [] };
      if (request.taskId) {
        const neighborhood = sliceGraphNeighborhood(graph, request.taskId, request.depth ?? 1);
        rawData = neighborhood as unknown as JsonObject;
        totalCount = graph.nodes ? graph.nodes.length : 0;
        returnedCount = neighborhood.nodes.length;
        truncated = returnedCount < totalCount;
      } else {
        rawData = graph as unknown as JsonObject;
        totalCount = graph.nodes ? graph.nodes.length : 0;
        returnedCount = totalCount;
      }
      pointerUri = `.capsules/${runId}/planning/enhanced-plan.json`;
      break;
    }
    case "events": {
      const events = Array.isArray(state.events) ? (state.events as JsonObject[]) : [];
      const slicedStream = sliceEventStream(events, {
        ...(request.taskId !== undefined ? { taskId: request.taskId } : {}),
        ...(request.offset !== undefined ? { offset: request.offset } : {}),
        limit: request.limit ?? 50,
      });
      rawData = slicedStream.events as unknown as JsonValue[];
      totalCount = slicedStream.total;
      returnedCount = slicedStream.events.length;
      truncated = slicedStream.hasMore;
      pointerUri = `.capsules/${runId}/events.jsonl`;
      break;
    }
    case "requirements": {
      const reqs = Array.isArray(state.requirements) ? (state.requirements as JsonObject[]) : [];
      totalCount = reqs.length;
      if (request.taskId && isJsonObject(state.tasks)) {
        const task = isJsonObject(state.tasks[request.taskId])
          ? (state.tasks[request.taskId] as TaskRecord)
          : null;
        const mappedIds = new Set(task?.requirement_ids ?? []);
        const filtered = reqs.filter((r) => typeof r.id === "string" && mappedIds.has(r.id));
        rawData = filtered as unknown as JsonValue[];
        returnedCount = filtered.length;
      } else {
        rawData = reqs as unknown as JsonValue[];
        returnedCount = reqs.length;
      }
      pointerUri = `.capsules/${runId}/prompt.md`;
      break;
    }
    case "commands":
    case "evidence": {
      const cmds = isJsonObject(state.commands) ? state.commands : {};
      const entries = Object.entries(cmds);
      totalCount = entries.length;
      if (request.taskId) {
        const forTask = entries
          .filter(([_, cmd]) => isJsonObject(cmd) && cmd.task_id === request.taskId)
          .map(([_, cmd]) => cmd);
        rawData = forTask as unknown as JsonValue[];
        returnedCount = forTask.length;
      } else {
        const offset = request.offset ?? 0;
        const limit = request.limit ?? 20;
        const page = entries.slice(offset, offset + limit).map(([_, cmd]) => cmd);
        rawData = page as unknown as JsonValue[];
        returnedCount = page.length;
        truncated = offset + limit < totalCount;
      }
      pointerUri = `.capsules/${runId}/evidence/`;
      break;
    }
    case "custom":
    default: {
      if (request.fields && request.fields.length > 0 && isJsonObject(state)) {
        const projected: JsonObject = {};
        for (const field of request.fields) {
          if (state[field] !== undefined) {
            projected[field] = state[field]!;
          }
        }
        rawData = projected;
        totalCount = Object.keys(projected).length;
        returnedCount = totalCount;
      } else {
        rawData = state as JsonObject;
        totalCount = 1;
        returnedCount = 1;
      }
      break;
    }
  }

  const encodedBytes = canonicalJsonBytes(rawData);
  const sliceHash = sha256Bytes(encodedBytes);

  return {
    schema: "harness.metadata-slice.v1",
    runId,
    target,
    totalCount,
    returnedCount,
    truncated,
    sliceHash,
    data: rawData,
    ...(pointerUri !== undefined ? { pointerUri } : {}),
  };
}

export function formatLeanMarkdownBrief(options: LeanBriefOptions): string {
  const task = options.task ? sliceTaskContract(options.task as TaskRecord) : null;
  const taskId = task ? task.id : "run-level";
  const duration = options.leaseDurationMinutes ?? 20;

  const lines: string[] = [
    `### Task Leased: ${taskId}`,
    `- **Agent**: \`${options.agentId}\``,
    `- **Role**: \`${options.role}\``,
  ];

  if (options.token) {
    lines.push(`- **Lease Token**: \`${options.token}\``);
    lines.push(`- **Duration**: ${duration} minutes`);
  }

  if (task) {
    const scopeStr =
      task.write_scope.length > 0 ? task.write_scope.map((s) => `\`${s}\``).join(", ") : "`none`";
    lines.push(`- **Assigned Write Scope**: ${scopeStr}`);
    if (task.gate) {
      lines.push(`- **Gate**: \`${task.gate}\``);
    }
    if (task.requirement_ids.length > 0) {
      lines.push(`- **Requirements**: ${task.requirement_ids.join(", ")}`);
    }
  }

  if (options.token) {
    lines.push(`- **Note**: Pass \`--token ${options.token}\` to \`task:submit\`.`);
  }

  lines.push("");
  lines.push("⚡ On-Demand Capsule Memory Queries:");
  const runId = options.runId ?? "<run-id>";
  const taskFlag = task ? ` --task ${taskId}` : "";
  lines.push(
    `1. \`bun harness.ts report:task --run .capsules/${runId}${taskFlag}\` — Detailed task & review state`,
  );
  lines.push(`2. \`bun harness.ts stream:events --run .capsules/${runId}\` — Event timeline slice`);
  lines.push(`3. \`bun harness.ts dag:view --run .capsules/${runId}\` — Neighborhood DAG trace`);
  lines.push(
    `4. \`bun harness.ts doctor --run .capsules/${runId}\` — Harness health & diagnostics`,
  );

  if (options.customGuidance && options.customGuidance.length > 0) {
    lines.push("");
    for (const g of options.customGuidance) {
      lines.push(`- ${g}`);
    }
  }

  const maxLines = options.maxLines ?? DEFAULT_BRIEF_MAX_LINES;
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines).join("\n");
  }

  return lines.join("\n");
}

export function buildUltraLeanPacket(
  input: PacketInput,
  config: PacketSliceConfig = {},
): BuiltPacket {
  const maxBytes = config.maxBytes ?? DEFAULT_PACKET_BYTE_BUDGET;

  const slicedContext = sliceAuthoritativeContext(input.authoritativeContext, {
    ...(config.fieldMask !== undefined ? { fieldMask: config.fieldMask } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(config.maxArrayItems !== undefined ? { maxArrayItems: config.maxArrayItems } : {}),
  });

  const adaptedInput: PacketInput = {
    ...input,
    authoritativeContext: slicedContext,
  };

  const initialPacket = buildPacket(adaptedInput);

  const slicedMarkdown = sliceMarkdownSections(initialPacket.markdown, {
    ...(config.includeSections !== undefined ? { includeSections: config.includeSections } : {}),
    ...(config.excludeSections !== undefined ? { excludeSections: config.excludeSections } : {}),
    maxTotalBytes: maxBytes,
  });

  const updatedMetadata: JsonObject = {
    ...initialPacket.metadata,
    is_ultra_lean: true,
    packet_sha256: createHash("sha256").update(slicedMarkdown).digest("hex"),
    original_packet_sha256: initialPacket.metadata.packet_sha256 ?? "",
  };

  return {
    markdown: slicedMarkdown,
    metadata: updatedMetadata,
  };
}
