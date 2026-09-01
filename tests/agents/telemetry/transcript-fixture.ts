import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanupVirtualAgentsFS, scratchRoot } from "../fixture.ts";

/** One assistant turn carrying real usage and, optionally, a tool call. */
export function assistantLine(opts: {
  timestamp: string;
  model?: string;
  effort?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  toolUseId?: string;
  toolName?: string;
}): string {
  const content: unknown[] = [];
  if (opts.toolUseId !== undefined) {
    content.push({ type: "tool_use", id: opts.toolUseId, name: opts.toolName, input: {} });
  }
  return JSON.stringify({
    type: "assistant",
    timestamp: opts.timestamp,
    effort: opts.effort,
    message: {
      model: opts.model,
      content,
      usage: {
        input_tokens: opts.inputTokens ?? 0,
        output_tokens: opts.outputTokens ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0,
      },
    },
  });
}

export function toolResultLine(opts: {
  timestamp: string;
  toolUseId: string;
  isError?: boolean;
  toolUseResult?: string;
}): string {
  return JSON.stringify({
    type: "user",
    timestamp: opts.timestamp,
    message: {
      content: [
        { type: "tool_result", tool_use_id: opts.toolUseId, is_error: opts.isError ?? false },
      ],
    },
    ...(opts.toolUseResult === undefined ? {} : { toolUseResult: opts.toolUseResult }),
  });
}

export async function writeDirectTranscript(
  homeDir: string,
  sessionId: string,
  agentId: string,
  lines: string[],
  meta?: Record<string, unknown>,
): Promise<void> {
  const dir = join(homeDir, ".claude", "projects", "some-project", sessionId, "subagents");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `agent-${agentId}.jsonl`), lines.join("\n") + "\n");
  if (meta !== undefined) {
    await writeFile(join(dir, `agent-${agentId}.meta.json`), JSON.stringify(meta));
  }
}

export function mktemp(callerPath: string, label: string): string {
  return scratchRoot(callerPath, label);
}

export async function cleanupTranscriptRoots(): Promise<void> {
  cleanupVirtualAgentsFS();
}
