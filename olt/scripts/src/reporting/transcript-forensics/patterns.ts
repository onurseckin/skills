import type { ForensicHeuristicCategory, ForensicRawFinding } from "./types.ts";

export interface StepToolCall {
  readonly name?: string;
  readonly args?: Record<string, unknown>;
}

export interface TranscriptStepRecord {
  readonly step_index?: number;
  readonly created_at?: string;
  readonly timestamp?: string;
  readonly content?: string;
  readonly tool_calls?: readonly StepToolCall[];
}

export function cleanArg(val: unknown): string {
  if (typeof val !== "string") return "";
  const t = val.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    try {
      const p: unknown = JSON.parse(t);
      if (typeof p === "string") return p;
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

export function extractCommand(calls?: readonly StepToolCall[]): string | undefined {
  if (!calls || calls.length === 0) return undefined;
  for (const c of calls) {
    if (c.name === "run_command" && c.args) {
      const cmd = cleanArg(c.args["CommandLine"]);
      if (cmd.length > 0) return cmd;
    }
  }
  return undefined;
}

export const ERROR_PATTERNS = [
  {
    regex: /role\s+(\w+\s+)?validator\s+may\s+not\s+invoke/i,
    category: "cognitive_validator_lockout" as const,
    heuristic: () => "Cognitive validator lockout: forbidden execution attempt",
    signature: () => "cognitive_validator_lockout",
  },
  {
    regex: /completeness critic authentication is invalid/i,
    category: "critic_authentication_failure" as const,
    heuristic: () => "Completeness critic authentication failure: token invalid",
    signature: () => "critic_authentication_failure",
  },
  {
    regex: /cannot determine checks for\s*([^\s:\n]+)?/i,
    category: "command_ownership_failure" as const,
    heuristic: () => "Command ownership failure: task missing check evidence",
    signature: () => "command_ownership_failure",
  },
  {
    regex: /unknown option:\s*([^\s\n\r]+)/i,
    category: "unknown_cli_option" as const,
    heuristic: (m: RegExpMatchArray) => `CLI flag error: unknown option ${m[1] ?? "unknown"}`,
    signature: (m: RegExpMatchArray) => `unknown_cli_option:${m[1] ?? "unknown"}`,
  },
  {
    regex:
      /Error\s*\((INVALID_STATE|INVALID_ARGUMENT|AUTHENTICATION_FAILURE|LOCK_TIMEOUT|PERMISSION_DENIED)\)/i,
    category: "harness_error" as const,
    heuristic: (m: RegExpMatchArray) => `Harness contract execution error: ${m[1] ?? "UNKNOWN"}`,
    signature: (m: RegExpMatchArray) => `harness_error:${m[1] ?? "UNKNOWN"}`,
  },
];

export const REVERSE_ENG_TOKEN = "skills/olt/scripts/src";

export function makeFinding(
  cat: ForensicHeuristicCategory,
  heur: string,
  sig: string,
  snip: string,
  cmd: string | undefined,
  ts: string,
  convId: string,
  stepIdx?: number,
  path?: string,
): ForensicRawFinding {
  return {
    category: cat,
    rootCauseHeuristic: heur,
    signature: sig,
    errorSnippet: snip,
    ...(cmd ? { offendingCommand: cmd } : {}),
    timestamp: ts,
    conversationId: convId,
    ...(stepIdx !== undefined ? { stepIndex: stepIdx } : {}),
    ...(path ? { transcriptPath: path } : {}),
  };
}
