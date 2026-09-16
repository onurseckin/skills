import { isJsonObject, safeParseJson } from "./types.ts";
import { isReadTool, isWriteTool, isPollTool } from "./types.ts";
import type { ForensicsIncident, ForensicsMetrics, ExtractedToolCall } from "./types.ts";
import type { RunState, Manifest, HarnessEvent } from "../../../core/contracts/index.ts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
export function parseStateFile(filePath: string): RunState | null {
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

export function parseManifestFile(filePath: string): Manifest | null {
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

function normalizeToolName(raw: string): string {
  return raw
    .replace(/^default_api:/, "")
    .replace(/^mcp_[^_]+_/, "")
    .trim();
}

function parseCallRecord(
  rawCall: Record<string, unknown>,
  fallbackEntry?: Record<string, unknown>,
): ExtractedToolCall {
  const rawName =
    typeof rawCall["name"] === "string"
      ? rawCall["name"]
      : typeof rawCall["tool"] === "string"
        ? rawCall["tool"]
        : "unknown";
  const name = normalizeToolName(rawName);
  const rawArgs = rawCall["arguments"] ?? rawCall["parameters"] ?? rawCall["args"];
  let args: Record<string, unknown> | undefined = isJsonObject(rawArgs)
    ? (rawArgs as Record<string, unknown>)
    : undefined;
  if (!args && typeof rawArgs === "string") {
    const parsed = safeParseJson(rawArgs);
    if (isJsonObject(parsed)) {
      args = parsed as Record<string, unknown>;
    }
  }
  const agentId =
    typeof rawCall["agent_id"] === "string"
      ? rawCall["agent_id"]
      : typeof rawCall["agentId"] === "string"
        ? rawCall["agentId"]
        : typeof fallbackEntry?.["agent_id"] === "string"
          ? (fallbackEntry["agent_id"] as string)
          : typeof fallbackEntry?.["agentId"] === "string"
            ? (fallbackEntry["agentId"] as string)
            : undefined;
  const taskId =
    typeof rawCall["task_id"] === "string"
      ? rawCall["task_id"]
      : typeof rawCall["taskId"] === "string"
        ? rawCall["taskId"]
        : typeof fallbackEntry?.["task_id"] === "string"
          ? (fallbackEntry["task_id"] as string)
          : typeof fallbackEntry?.["taskId"] === "string"
            ? (fallbackEntry["taskId"] as string)
            : undefined;
  const timestamp =
    typeof rawCall["timestamp"] === "string"
      ? rawCall["timestamp"]
      : typeof fallbackEntry?.["timestamp"] === "string"
        ? (fallbackEntry["timestamp"] as string)
        : typeof fallbackEntry?.["created_at"] === "string"
          ? (fallbackEntry["created_at"] as string)
          : undefined;
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
          : typeof args?.["path"] === "string"
            ? (args["path"] as string)
            : typeof args?.["target_path"] === "string"
              ? (args["target_path"] as string)
              : undefined;

  const isWrite = name === "replace_file_content" || name === "write_to_file" || isWriteTool(name);

  return {
    agentId,
    taskId,
    name,
    toolName: name,
    timestamp,
    isRead: isReadTool(name),
    isWrite,
    isPoll: isPollTool(name, args),
    targetPath,
    waitMsBeforeAsync: waitMs,
    rawArguments: args,
  };
}

export function extractToolCallsFromTranscripts(
  transcripts: readonly string[],
): ExtractedToolCall[] {
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

    const lines = text.split("\n");
    let foundJsonCall = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parsed = safeParseJson(trimmed);
      if (!parsed) continue;

      const entries: Record<string, unknown>[] = [];
      if (Array.isArray(parsed)) {
        for (const element of parsed) {
          if (isJsonObject(element)) entries.push(element);
        }
      } else if (isJsonObject(parsed)) {
        entries.push(parsed);
      }

      for (const entry of entries) {
        const rawToolCalls = entry["tool_calls"] ?? entry["toolCalls"];
        if (Array.isArray(rawToolCalls)) {
          for (const rawCall of rawToolCalls) {
            if (isJsonObject(rawCall)) {
              calls.push(parseCallRecord(rawCall, entry));
              foundJsonCall = true;
            }
          }
        } else if (typeof entry["name"] === "string" || typeof entry["tool"] === "string") {
          calls.push(parseCallRecord(entry));
          foundJsonCall = true;
        }
      }
    }

    if (!foundJsonCall) {
      const fullParsed = safeParseJson(text);
      if (Array.isArray(fullParsed)) {
        for (const element of fullParsed) {
          if (isJsonObject(element)) {
            const rawToolCalls = element["tool_calls"] ?? element["toolCalls"];
            if (Array.isArray(rawToolCalls)) {
              for (const rawCall of rawToolCalls) {
                if (isJsonObject(rawCall)) {
                  calls.push(parseCallRecord(rawCall, element));
                  foundJsonCall = true;
                }
              }
            } else if (typeof element["name"] === "string" || typeof element["tool"] === "string") {
              calls.push(parseCallRecord(element));
              foundJsonCall = true;
            }
          }
        }
      }
    }

    if (!foundJsonCall) {
      const toolRegex =
        /(?:call:\s*(?:default_api:)?([a-zA-Z0-9_-]+)|Tool Use:\s*([a-zA-Z0-9_-]+)|"toolAction":\s*"([^"]+)")/g;
      let match: RegExpExecArray | null = toolRegex.exec(text);
      while (match !== null) {
        const rawTool = match[1] ?? match[2] ?? match[3] ?? "unknown";
        const toolName = normalizeToolName(rawTool);
        const isWrite =
          toolName === "replace_file_content" ||
          toolName === "write_to_file" ||
          isWriteTool(toolName);
        calls.push({
          name: toolName,
          toolName,
          isRead: isReadTool(toolName),
          isWrite,
          isPoll: isPollTool(toolName),
        });
        match = toolRegex.exec(text);
      }
    }
  }

  return calls;
}

export function extractToolCallsFromEvents(events: readonly HarnessEvent[]): ExtractedToolCall[] {
  const calls: ExtractedToolCall[] = [];

  for (const event of events) {
    const actor = event.actor;
    const kind = event.kind;
    const rawPayload = (event as unknown as Record<string, unknown>)["payload"];
    const payload = isJsonObject(rawPayload)
      ? rawPayload
      : (event as unknown as Record<string, unknown>);

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

export function calculateEfficiencyScore(
  metricsOrOptions: Record<string, unknown>,
  incidentsArg?: readonly ForensicsIncident[],
): number {
  let incidents: readonly ForensicsIncident[] = [];
  let m: Record<string, unknown> = {};
  if (
    metricsOrOptions &&
    "incidents" in metricsOrOptions &&
    Array.isArray(metricsOrOptions.incidents)
  ) {
    incidents = metricsOrOptions.incidents;
    m = metricsOrOptions;
  } else if (incidentsArg) {
    incidents = incidentsArg;
    m = metricsOrOptions || {};
  } else if (Array.isArray(metricsOrOptions)) {
    incidents = metricsOrOptions;
  }

  let score = 100.0;
  for (const inc of incidents) {
    if (inc.severity === "CRITICAL") score -= 25.0;
    else if (inc.severity === "HIGH") score -= 15.0;
    else if (inc.severity === "MEDIUM") score -= 8.0;
    else if (inc.severity === "LOW") score -= 3.0;
  }

  const writeCount =
    typeof m.writeToolCalls === "number"
      ? m.writeToolCalls
      : typeof m.fileWriteCount === "number"
        ? m.fileWriteCount
        : 0;
  const readCount =
    typeof m.readToolCalls === "number"
      ? m.readToolCalls
      : typeof m.fileReadCount === "number"
        ? m.fileReadCount
        : 0;
  const ratio =
    typeof m.readToWriteRatio === "number"
      ? m.readToWriteRatio
      : writeCount > 0
        ? readCount / writeCount
        : 0;
  if (ratio > 15.0) {
    score -= Math.min(20.0, (ratio - 15.0) * 1.5);
  }

  const pollCount =
    typeof m.pollingCallsCount === "number"
      ? m.pollingCallsCount
      : typeof m.pollingToolCalls === "number"
        ? (m.pollingToolCalls as number)
        : 0;
  if (pollCount > 5) {
    score -= Math.min(15.0, (pollCount - 5) * 2.0);
  }

  const seqBottlenecks =
    typeof m.sequentialWaveBottlenecks === "number" ? m.sequentialWaveBottlenecks : 0;
  if (seqBottlenecks > 0) {
    score -= Math.min(15.0, seqBottlenecks * 5.0);
  }

  return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
}

export function discoverActiveTranscripts(repoRoot?: string): string[] {
  const results = new Set<string>();
  const baseHome = homedir() || process.env.HOME || "";
  const brainDirs = [
    join(baseHome, ".gemini", "antigravity", "brain"),
    join(baseHome, ".gemini", "antigravity-cli", "brain"),
  ];

  for (const brainDir of brainDirs) {
    if (existsSync(brainDir)) {
      try {
        for (const e of readdirSync(brainDir, { withFileTypes: true })) {
          if (!e.isDirectory()) continue;
          const p = join(brainDir, e.name, ".system_generated", "logs", "transcript.jsonl");
          if (existsSync(p)) results.add(resolve(p));
          const direct = join(brainDir, e.name, "transcript.jsonl");
          if (existsSync(direct)) results.add(resolve(direct));
        }
      } catch {}
    }
  }

  if (repoRoot) {
    const local = join(resolve(repoRoot), ".system_generated", "logs", "transcript.jsonl");
    if (existsSync(local)) results.add(resolve(local));
    const directLocal = join(resolve(repoRoot), "transcript.jsonl");
    if (existsSync(directLocal)) results.add(resolve(directLocal));
  }
  return [...results];
}
