import { HarnessError } from "../core/errors/index.ts";

export const CANONICAL_HOST_TYPES = ["antigravity", "claude_code", "codex", "cursor"] as const;

export type HostType = (typeof CANONICAL_HOST_TYPES)[number];

export function isHostType(value: unknown): value is HostType {
  return typeof value === "string" && (CANONICAL_HOST_TYPES as readonly string[]).includes(value);
}

export function detectActiveHost(env: Record<string, string | undefined> = process.env): HostType {
  if (env["ANTIGRAVITY_APP_DIR"] || env["GEMINI_CLI_HOME"]) {
    return "antigravity";
  }
  if (env["CLAUDE_PROJECT_DIR"] || env["CLAUDE_CODE_ENTRY"]) {
    return "claude_code";
  }
  if (env["CODEX_RUNTIME"] || env["CODEX_THREAD_ID"]) {
    return "codex";
  }
  if (env["CURSOR_PROJECT_DIR"] || env["CURSOR_TRACE_ID"]) {
    return "cursor";
  }

  throw new HarnessError(
    "UNSUPPORTED_HOST",
    "Could not detect canonical host environment (zero generic fallback)",
  );
}
