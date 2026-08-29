import { isJsonObject, safeParseJson } from "./types.ts";
import { isReadTool, isWriteTool, isPollTool } from "./types.ts";
import type { ForensicsIncident, ForensicsMetrics, ExtractedToolCall } from "./types.ts";
import type { RunState, Manifest, HarnessEvent } from "../../../core/contracts/index.ts";
import { existsSync, readFileSync } from "node:fs";
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
        toolName,

        isRead: isReadTool(toolName),
        isWrite: isWriteTool(toolName),
        isPoll: isPollTool(toolName),
      });
      match = toolRegex.exec(text);
    }
  }

  return calls;
}

export function extractToolCallsFromEvents(events: readonly HarnessEvent[]): ExtractedToolCall[] {
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
