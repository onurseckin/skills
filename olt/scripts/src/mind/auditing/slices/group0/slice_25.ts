
function isReadTool(name: string): boolean {
  const n = name.toLowerCase().trim();
  return (
    n.includes("read") ||
    n.includes("view") ||
    n.includes("grep") ||
    n.includes("find") ||
    n.includes("list") ||
    n.includes("cat")
  );
}

function isWriteTool(name: string): boolean {
  const n = name.toLowerCase().trim();
  return (
    n.includes("write") ||
    n.includes("replace") ||
    n.includes("edit") ||
    n.includes("patch") ||
    n.includes("apply")
  );
}

function isPollTool(name: string, args?: Record<string, unknown>): boolean {
  const n = name.toLowerCase().trim();
  if (n === "manage_task") {
    const act = String(args?.Action ?? args?.action ?? "").toLowerCase();
    return act === "status" || act === "list";
  }
  return n.includes("poll") || n.includes("status");
}


function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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

export function extractToolCallsFromTranscripts(transcripts: readonly string[]): ExtractedToolCall[] {
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