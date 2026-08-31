import type { HostDetectionSignal } from "./host-detection.ts";

export function detectHostFromEnvironmentRules(
  env: Record<string, string | undefined>,
): HostDetectionSignal | null {
  if (env.ANTIGRAVITY_APP_DIR) {
    return {
      host: "antigravity",
      mechanism: "environment",
      confidence: "verified_exact",
      detail: `ANTIGRAVITY_APP_DIR=${env.ANTIGRAVITY_APP_DIR}`,
    };
  }
  if (env.GEMINI_CLI_HOME) {
    return {
      host: "antigravity",
      mechanism: "environment",
      confidence: "verified_exact",
      detail: `GEMINI_CLI_HOME=${env.GEMINI_CLI_HOME}`,
    };
  }
  if (env.CLAUDE_PROJECT_DIR) {
    return {
      host: "claude_code",
      mechanism: "environment",
      confidence: "verified_exact",
      detail: `CLAUDE_PROJECT_DIR=${env.CLAUDE_PROJECT_DIR}`,
    };
  }
  if (env.CLAUDE_CODE_ENTRY) {
    return {
      host: "claude_code",
      mechanism: "environment",
      confidence: "verified_exact",
      detail: `CLAUDE_CODE_ENTRY=${env.CLAUDE_CODE_ENTRY}`,
    };
  }
  if (env.CODEX_RUNTIME) {
    return {
      host: "codex",
      mechanism: "environment",
      confidence: "verified_exact",
      detail: `CODEX_RUNTIME=${env.CODEX_RUNTIME}`,
    };
  }
  if (env.CODEX_THREAD_ID) {
    return {
      host: "codex",
      mechanism: "environment",
      confidence: "verified_exact",
      detail: `CODEX_THREAD_ID=${env.CODEX_THREAD_ID}`,
    };
  }
  if (env.CURSOR_PROJECT_DIR) {
    return {
      host: "cursor",
      mechanism: "environment",
      confidence: "verified_exact",
      detail: `CURSOR_PROJECT_DIR=${env.CURSOR_PROJECT_DIR}`,
    };
  }
  if (env.CURSOR_TRACE_ID) {
    return {
      host: "cursor",
      mechanism: "environment",
      confidence: "verified_exact",
      detail: `CURSOR_TRACE_ID=${env.CURSOR_TRACE_ID}`,
    };
  }

  // Secondary environment variables
  if (
    env.ANTIGRAVITY_CLI ||
    env.GEMINI_CLI ||
    env.ANTIGRAVITY_VERSION ||
    env.ANTIGRAVITY_CLI_VERSION ||
    env.ANTIGRAVITY_AGENT_ID
  ) {
    return {
      host: "antigravity",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Antigravity runtime environment detected",
    };
  }
  if (env.CLAUDE_CODE_VERSION || env.CLAUDE_CLI || env.ANTHROPIC_CLI || env.CLAUDE_SESSION_ID) {
    return {
      host: "claude_code",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Claude runtime environment detected",
    };
  }
  if (
    env.CODEX_VERSION ||
    env.CODEX_CLI ||
    env.CODEX_SESSION_ID ||
    env.OPENCODE_VERSION ||
    env.OPENCODE_CLI ||
    env.OPENCODE
  ) {
    return {
      host: "codex",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Codex runtime environment detected",
    };
  }
  if (env.CURSOR_DIR || env.CURSOR_CHANNEL || env.CURSOR_VERSION || env.CURSOR_API_KEY) {
    return {
      host: "cursor",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Cursor runtime environment detected",
    };
  }

  return null;
}

export function detectHostFromProcessTreeRules(
  entries: readonly string[],
): HostDetectionSignal | null {
  for (const entry of entries) {
    const lower = entry.toLowerCase();
    if (
      lower.includes("antigravity") ||
      lower === "agy" ||
      lower.includes("gemini-cli") ||
      lower.includes("language_server")
    ) {
      return {
        host: "antigravity",
        mechanism: "process_tree",
        confidence: "inferred",
        detail: `Process tree lineage matched: '${entry}'`,
      };
    }
    if (lower.includes("claude-code") || lower === "claude" || lower.includes("claude_cli")) {
      return {
        host: "claude_code",
        mechanism: "process_tree",
        confidence: "inferred",
        detail: `Process tree lineage matched: '${entry}'`,
      };
    }
    if (lower.includes("codex") || lower.includes("opencode")) {
      return {
        host: "codex",
        mechanism: "process_tree",
        confidence: "inferred",
        detail: `Process tree lineage matched: '${entry}'`,
      };
    }
    if (lower === "cursor" || lower.includes("cursor-agent")) {
      return {
        host: "cursor",
        mechanism: "process_tree",
        confidence: "inferred",
        detail: `Process tree lineage matched: '${entry}'`,
      };
    }
  }
  return null;
}

export function detectHostFromModelRules(lower: string, raw: string): HostDetectionSignal | null {
  if (lower.startsWith("gemini") || lower.includes("gemini-") || lower.includes("gemini_")) {
    return {
      host: "antigravity",
      mechanism: "model_configuration",
      confidence: "inferred",
      detail: `Model configuration '${raw}' mapped to Antigravity`,
    };
  }
  if (lower.startsWith("claude") || lower.includes("claude-") || lower.includes("claude_")) {
    return {
      host: "claude_code",
      mechanism: "model_configuration",
      confidence: "inferred",
      detail: `Model configuration '${raw}' mapped to Claude Code`,
    };
  }
  if (
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4") ||
    lower.startsWith("gpt") ||
    lower.includes("codex") ||
    lower.includes("davinci")
  ) {
    return {
      host: "codex",
      mechanism: "model_configuration",
      confidence: "inferred",
      detail: `Model configuration '${raw}' mapped to Codex`,
    };
  }
  if (lower.includes("cursor")) {
    return {
      host: "cursor",
      mechanism: "model_configuration",
      confidence: "inferred",
      detail: `Model configuration '${raw}' mapped to Cursor`,
    };
  }
  return null;
}
