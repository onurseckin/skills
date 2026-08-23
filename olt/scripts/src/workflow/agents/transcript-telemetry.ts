import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isThinkingLevel, type ThinkingLevel } from "../../core/contracts/agents.ts";
import type { JsonObject } from "../../core/contracts/json.ts";

export interface ReadAgentTranscriptOptions {
  homeDir?: string;
  env?: Record<string, string | undefined>;
}

export interface TranscriptToolCall {
  name: string;
  calls: number;
  failures: number;
}

export interface TranscriptRunContext extends JsonObject {
  runId: string;
  defaultModel?: string;
  totalTokens?: number;
  totalToolCalls?: number;
  status?: string;
}

export interface AgentTranscriptTelemetry {
  sourcePath: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  tokensIn?: number;
  tokensOut?: number;
  tokenExtras?: Readonly<Record<string, number>>;
  tools: readonly TranscriptToolCall[];
  durationMs?: number;
  agentType?: string;
  spawnDepth?: number;
  parentAgentId?: string;
  runContext?: TranscriptRunContext;
}

const SESSION_ID_ENV_VAR = "CLAUDE_CODE_SESSION_ID";

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function resolveHomeDir(
  options: ReadAgentTranscriptOptions | undefined,
  env: Record<string, string | undefined>,
): string | undefined {
  if (options?.homeDir) return options.homeDir;
  if (hasText(env.HOME)) return env.HOME.trim();
  try {
    const home = homedir();
    return hasText(home) ? home.trim() : undefined;
  } catch {
    return undefined;
  }
}

function listDirNames(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function listFileNames(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function findSessionDirs(homeDir: string | undefined, sessionId: string): string[] {
  if (!homeDir) return [];
  const projectsRoot = join(homeDir, ".claude", "projects");
  const dirs: string[] = [];
  for (const slug of listDirNames(projectsRoot)) {
    const candidate = join(projectsRoot, slug, sessionId);
    if (existsSync(candidate)) dirs.push(candidate);
  }
  return dirs.sort();
}

interface LocatedTranscript {
  jsonl: string;
  meta: string | null;
}

function findAgentTranscript(sessionDir: string, agentId: string): LocatedTranscript | null {
  const direct = join(sessionDir, "subagents", `agent-${agentId}.jsonl`);
  if (existsSync(direct)) {
    const meta = join(sessionDir, "subagents", `agent-${agentId}.meta.json`);
    return { jsonl: direct, meta: existsSync(meta) ? meta : null };
  }
  const workflowsDir = join(sessionDir, "subagents", "workflows");
  for (const runDir of listDirNames(workflowsDir).sort()) {
    const jsonl = join(workflowsDir, runDir, `agent-${agentId}.jsonl`);
    if (existsSync(jsonl)) {
      const meta = join(workflowsDir, runDir, `agent-${agentId}.meta.json`);
      return { jsonl, meta: existsSync(meta) ? meta : null };
    }
  }
  return null;
}

interface AgentMeta {
  agentType?: string;
  parentAgentId?: string;
  spawnDepth?: number;
}

function readAgentMeta(path: string | null): AgentMeta {
  if (path === null) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!isRecord(parsed)) return {};
    return {
      ...(hasText(parsed.agentType) ? { agentType: parsed.agentType } : {}),
      ...(hasText(parsed.parentAgentId) ? { parentAgentId: parsed.parentAgentId } : {}),
      ...(typeof parsed.spawnDepth === "number" && Number.isFinite(parsed.spawnDepth)
        ? { spawnDepth: Math.trunc(parsed.spawnDepth) }
        : {}),
    };
  } catch {
    return {};
  }
}

interface ParsedTranscript {
  model?: string;
  thinkingLevel?: ThinkingLevel;
  tokensIn?: number;
  tokensOut?: number;
  tokenExtras: Record<string, number>;
  tools: Map<string, { calls: number; failures: number }>;
  firstTimestamp?: string;
  lastTimestamp?: string;
}

function parseTranscript(jsonlPath: string): ParsedTranscript {
  const raw = readFileSync(jsonlPath, "utf-8");
  let model: string | undefined;
  let thinkingLevel: ThinkingLevel | undefined;
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;
  const tokenExtras: Record<string, number> = {};
  const tools = new Map<string, { calls: number; failures: number }>();
  const pendingToolNames = new Map<string, string>();
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  const bumpExtra = (key: string, amount: number): void => {
    if (amount <= 0) return;
    tokenExtras[key] = (tokenExtras[key] ?? 0) + amount;
  };

  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry)) continue;
    if (hasText(entry.timestamp)) {
      firstTimestamp ??= entry.timestamp;
      lastTimestamp = entry.timestamp;
    }

    if (entry.type === "assistant" && isRecord(entry.message)) {
      const message = entry.message;
      if (hasText(message.model)) model = message.model;
      if (hasText(entry.effort) && isThinkingLevel(entry.effort)) thinkingLevel = entry.effort;
      if (isRecord(message.usage)) {
        const usage = message.usage;
        const input = numberField(usage, "input_tokens");
        const output = numberField(usage, "output_tokens");
        tokensIn = tokensIn === undefined ? input : tokensIn + input;
        tokensOut = tokensOut === undefined ? output : tokensOut + output;
        bumpExtra("cache_creation_input_tokens", numberField(usage, "cache_creation_input_tokens"));
        bumpExtra("cache_read_input_tokens", numberField(usage, "cache_read_input_tokens"));
        if (isRecord(usage.cache_creation)) {
          bumpExtra(
            "cache_creation_ephemeral_5m_input_tokens",
            numberField(usage.cache_creation, "ephemeral_5m_input_tokens"),
          );
          bumpExtra(
            "cache_creation_ephemeral_1h_input_tokens",
            numberField(usage.cache_creation, "ephemeral_1h_input_tokens"),
          );
        }
      }
      if (Array.isArray(message.content)) {
        for (const item of message.content) {
          if (
            !isRecord(item) ||
            item.type !== "tool_use" ||
            !hasText(item.name) ||
            !hasText(item.id)
          ) {
            continue;
          }
          pendingToolNames.set(item.id, item.name);
          const current = tools.get(item.name) ?? { calls: 0, failures: 0 };
          current.calls += 1;
          tools.set(item.name, current);
        }
      }
    }

    if (entry.type === "user" && isRecord(entry.message) && Array.isArray(entry.message.content)) {
      for (const item of entry.message.content) {
        if (!isRecord(item) || item.type !== "tool_result" || !hasText(item.tool_use_id)) continue;
        const name = pendingToolNames.get(item.tool_use_id);
        if (name === undefined) continue;
        const flaggedError = item.is_error === true;
        const looksLikeError = hasText(entry.toolUseResult) && /^Error/.test(entry.toolUseResult);
        if (flaggedError || looksLikeError) {
          const current = tools.get(name) ?? { calls: 0, failures: 0 };
          current.failures += 1;
          tools.set(name, current);
        }
      }
    }
  }

  return {
    ...(model === undefined ? {} : { model }),
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
    ...(tokensIn === undefined ? {} : { tokensIn }),
    ...(tokensOut === undefined ? {} : { tokensOut }),
    tokenExtras,
    tools,
    ...(firstTimestamp === undefined ? {} : { firstTimestamp }),
    ...(lastTimestamp === undefined ? {} : { lastTimestamp }),
  };
}

function durationMsBetween(
  first: string | undefined,
  last: string | undefined,
): number | undefined {
  if (first === undefined || last === undefined) return undefined;
  const start = Date.parse(first);
  const end = Date.parse(last);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return end - start;
}

function findRunContext(sessionDir: string, agentId: string): TranscriptRunContext | undefined {
  const workflowsRoot = join(sessionDir, "workflows");
  for (const fileName of listFileNames(workflowsRoot)) {
    if (!fileName.startsWith("wf_") || !fileName.endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(workflowsRoot, fileName), "utf-8"));
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const progress = Array.isArray(parsed.workflowProgress) ? parsed.workflowProgress : [];
    const match = progress.find((entry) => isRecord(entry) && entry.agentId === agentId);
    if (match === undefined || !isRecord(match)) continue;
    return {
      runId: hasText(parsed.runId) ? parsed.runId : fileName.replace(/\.json$/, ""),
      ...(hasText(parsed.defaultModel) ? { defaultModel: parsed.defaultModel } : {}),
      ...(typeof parsed.totalTokens === "number" ? { totalTokens: parsed.totalTokens } : {}),
      ...(typeof parsed.totalToolCalls === "number"
        ? { totalToolCalls: parsed.totalToolCalls }
        : {}),
      ...(hasText(parsed.status) ? { status: parsed.status } : {}),
    };
  }
  return undefined;
}

export function readAgentTranscriptTelemetry(
  agentId: string,
  options?: ReadAgentTranscriptOptions,
): AgentTranscriptTelemetry | null {
  const env = options?.env ?? process.env;
  const sessionId = env[SESSION_ID_ENV_VAR];
  if (!hasText(sessionId)) return null;
  const homeDir = resolveHomeDir(options, env);

  for (const sessionDir of findSessionDirs(homeDir, sessionId.trim())) {
    const located = findAgentTranscript(sessionDir, agentId);
    if (located === null) continue;

    const meta = readAgentMeta(located.meta);
    const parsed = parseTranscript(located.jsonl);
    const tools: TranscriptToolCall[] = [...parsed.tools.entries()].map(([name, counts]) => ({
      name,
      calls: counts.calls,
      failures: counts.failures,
    }));
    const durationMs = durationMsBetween(parsed.firstTimestamp, parsed.lastTimestamp);
    const runContext = findRunContext(sessionDir, agentId);

    return {
      sourcePath: located.jsonl,
      ...(parsed.model === undefined ? {} : { model: parsed.model }),
      ...(parsed.thinkingLevel === undefined ? {} : { thinkingLevel: parsed.thinkingLevel }),
      ...(parsed.tokensIn === undefined ? {} : { tokensIn: parsed.tokensIn }),
      ...(parsed.tokensOut === undefined ? {} : { tokensOut: parsed.tokensOut }),
      ...(Object.keys(parsed.tokenExtras).length === 0 ? {} : { tokenExtras: parsed.tokenExtras }),
      tools,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...meta,
      ...(runContext === undefined ? {} : { runContext }),
    };
  }
  return null;
}
