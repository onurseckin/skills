export const CANONICAL_HOSTS = ["antigravity", "claude_code", "codex", "cursor"] as const;
export type CanonicalHost = (typeof CANONICAL_HOSTS)[number];

export type HostDetectionMechanism =
  | "explicit_override"
  | "environment"
  | "process_tree"
  | "model_configuration"
  | "terminal_fallback"
  | "default_fallback";

export interface HostDetectionSignal {
  readonly host: CanonicalHost;
  readonly mechanism: HostDetectionMechanism;
  readonly confidence: "verified_exact" | "inferred" | "heuristic";
  readonly detail: string;
}

export interface HostDetectionResult {
  readonly activeHost: CanonicalHost;
  readonly primaryPlatformId: string;
  readonly signal: HostDetectionSignal;
  readonly allSignals: readonly HostDetectionSignal[];
  readonly isFallback: boolean;
}

export interface HostDetectionOptions {
  readonly env?: Record<string, string | undefined> | undefined;
  readonly processTree?: readonly string[] | string | undefined;
  readonly model?: string | undefined;
  readonly explicitHost?: string | undefined;
}

export function isCanonicalHost(value: unknown): value is CanonicalHost {
  if (typeof value !== "string") return false;
  return (CANONICAL_HOSTS as readonly string[]).includes(value);
}

export function normalizeHostName(host: string): CanonicalHost | null {
  const normalized = host.trim().toLowerCase().replace(/[-\s]/g, "_");
  if (normalized === "antigravity") return "antigravity";
  if (normalized === "agy") return "antigravity";
  if (normalized === "gemini") return "antigravity";
  if (normalized === "claude_code") return "claude_code";
  if (normalized === "claude") return "claude_code";
  if (normalized === "claudecode") return "claude_code";
  if (normalized === "anthropic") return "claude_code";
  if (normalized === "codex") return "codex";
  if (normalized === "openai") return "codex";
  if (normalized === "opencode") return "codex";
  if (normalized === "codex_cli") return "codex";
  if (normalized === "cursor") return "cursor";
  if (normalized === "cursor_agent") return "cursor";
  return null;
}

export function canonicalHostToPlatformId(host: CanonicalHost | string): string {
  const canonical = normalizeHostName(host);
  if (!canonical) return host.toLowerCase();
  switch (canonical) {
    case "antigravity":
      return "antigravity";
    case "claude_code":
      return "claude";
    case "codex":
      return "codex";
    case "cursor":
      return "cursor";
  }
}

export function platformIdToCanonicalHost(platformId: string): CanonicalHost | null {
  return normalizeHostName(platformId);
}

export function isPlatformMatchingHost(
  platformId: string,
  host: CanonicalHost | string | null | undefined,
): boolean {
  if (!host) return false;
  const canonical = normalizeHostName(host);
  if (!canonical) return platformId.toLowerCase() === host.toLowerCase();
  const platformCanonical = normalizeHostName(platformId);
  if (platformCanonical === canonical) return true;
  if (canonical === "codex" && platformId.toLowerCase() === "openai") return true;
  if (canonical === "claude_code" && platformId.toLowerCase() === "claude") return true;
  return false;
}

export function detectHostFromExplicit(explicitHost?: string): HostDetectionSignal | null {
  if (!explicitHost) return null;
  if (typeof explicitHost !== "string") return null;
  if (!explicitHost.trim()) return null;
  const host = normalizeHostName(explicitHost);
  if (!host) return null;
  return {
    host,
    mechanism: "explicit_override",
    confidence: "verified_exact",
    detail: `Explicit host override: '${explicitHost}'`,
  };
}

function resolveExplicitEnv(env: Record<string, string | undefined>): string | undefined {
  if (env.OVERRIDE_HOST) return env.OVERRIDE_HOST;
  if (env.HARNESS_HOST) return env.HARNESS_HOST;
  if (env.ACTIVE_HOST) return env.ACTIVE_HOST;
  return undefined;
}

export function detectHostFromEnvironment(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): HostDetectionSignal | null {
  const explicit = resolveExplicitEnv(env);
  if (explicit) {
    const explicitSignal = detectHostFromExplicit(explicit);
    if (explicitSignal) return explicitSignal;
  }

  // Primary environment variables (high confidence)
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

  // Secondary environment variables (inferred confidence)
  if (env.ANTIGRAVITY_CLI) {
    return {
      host: "antigravity",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Antigravity CLI runtime environment detected",
    };
  }
  if (env.GEMINI_CLI) {
    return {
      host: "antigravity",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Gemini CLI runtime environment detected",
    };
  }
  if (env.ANTIGRAVITY_VERSION) {
    return {
      host: "antigravity",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Antigravity version runtime environment detected",
    };
  }
  if (env.ANTIGRAVITY_CLI_VERSION) {
    return {
      host: "antigravity",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Antigravity CLI version runtime environment detected",
    };
  }
  if (env.ANTIGRAVITY_AGENT_ID) {
    return {
      host: "antigravity",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Antigravity Agent ID runtime environment detected",
    };
  }

  if (env.CLAUDE_CODE_VERSION) {
    return {
      host: "claude_code",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Claude Code version runtime environment detected",
    };
  }
  if (env.CLAUDE_CLI) {
    return {
      host: "claude_code",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Claude CLI runtime environment detected",
    };
  }
  if (env.ANTHROPIC_CLI) {
    return {
      host: "claude_code",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Anthropic CLI runtime environment detected",
    };
  }
  if (env.CLAUDE_SESSION_ID) {
    return {
      host: "claude_code",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Claude Session runtime environment detected",
    };
  }

  if (env.CODEX_VERSION) {
    return {
      host: "codex",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Codex version runtime environment detected",
    };
  }
  if (env.CODEX_CLI) {
    return {
      host: "codex",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Codex CLI runtime environment detected",
    };
  }
  if (env.CODEX_SESSION_ID) {
    return {
      host: "codex",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Codex Session runtime environment detected",
    };
  }
  if (env.OPENCODE_VERSION) {
    return {
      host: "codex",
      mechanism: "environment",
      confidence: "inferred",
      detail: "OpenCode version runtime environment detected",
    };
  }
  if (env.OPENCODE_CLI) {
    return {
      host: "codex",
      mechanism: "environment",
      confidence: "inferred",
      detail: "OpenCode CLI runtime environment detected",
    };
  }
  if (env.OPENCODE) {
    return {
      host: "codex",
      mechanism: "environment",
      confidence: "inferred",
      detail: "OpenCode runtime environment detected",
    };
  }

  if (env.CURSOR_DIR) {
    return {
      host: "cursor",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Cursor DIR runtime environment detected",
    };
  }
  if (env.CURSOR_CHANNEL) {
    return {
      host: "cursor",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Cursor Channel runtime environment detected",
    };
  }
  if (env.CURSOR_VERSION) {
    return {
      host: "cursor",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Cursor Version runtime environment detected",
    };
  }
  if (env.CURSOR_API_KEY) {
    return {
      host: "cursor",
      mechanism: "environment",
      confidence: "inferred",
      detail: "Cursor API key runtime environment detected",
    };
  }

  return null;
}

export function detectHostFromProcessTree(
  processTree?: readonly string[] | string,
): HostDetectionSignal | null {
  if (!processTree) return null;

  const entries: string[] = Array.isArray(processTree)
    ? (processTree as string[])
    : String(processTree)
        .split(/[->,\s|]+/)
        .map((s) => s.trim())
        .filter(Boolean);

  for (const entry of entries) {
    const lower = entry.toLowerCase();
    if (lower.includes("antigravity")) {
      return {
        host: "antigravity",
        mechanism: "process_tree",
        confidence: "inferred",
        detail: `Process tree lineage matched: '${entry}'`,
      };
    }
    if (lower === "agy") {
      return {
        host: "antigravity",
        mechanism: "process_tree",
        confidence: "inferred",
        detail: `Process tree lineage matched: '${entry}'`,
      };
    }
    if (lower.includes("gemini-cli")) {
      return {
        host: "antigravity",
        mechanism: "process_tree",
        confidence: "inferred",
        detail: `Process tree lineage matched: '${entry}'`,
      };
    }
    if (lower.includes("language_server")) {
      return {
        host: "antigravity",
        mechanism: "process_tree",
        confidence: "inferred",
        detail: `Process tree lineage matched: '${entry}'`,
      };
    }

    if (lower.includes("claude-code")) {
      return {
        host: "claude_code",
        mechanism: "process_tree",
        confidence: "inferred",
        detail: `Process tree lineage matched: '${entry}'`,
      };
    }
    if (lower === "claude") {
      return {
        host: "claude_code",
        mechanism: "process_tree",
        confidence: "inferred",
        detail: `Process tree lineage matched: '${entry}'`,
      };
    }
    if (lower.includes("claude_cli")) {
      return {
        host: "claude_code",
        mechanism: "process_tree",
        confidence: "inferred",
        detail: `Process tree lineage matched: '${entry}'`,
      };
    }

    if (lower.includes("codex")) {
      return {
        host: "codex",
        mechanism: "process_tree",
        confidence: "inferred",
        detail: `Process tree lineage matched: '${entry}'`,
      };
    }
    if (lower.includes("opencode")) {
      return {
        host: "codex",
        mechanism: "process_tree",
        confidence: "inferred",
        detail: `Process tree lineage matched: '${entry}'`,
      };
    }

    if (lower === "cursor") {
      return {
        host: "cursor",
        mechanism: "process_tree",
        confidence: "inferred",
        detail: `Process tree lineage matched: '${entry}'`,
      };
    }
    if (lower.includes("cursor-agent")) {
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

export function detectHostFromModel(modelName?: string): HostDetectionSignal | null {
  if (!modelName) return null;
  if (typeof modelName !== "string") return null;
  if (!modelName.trim()) return null;

  const lower = modelName.trim().toLowerCase();

  let isGemini = false;
  if (lower.startsWith("gemini")) isGemini = true;
  if (lower.includes("gemini-")) isGemini = true;
  if (lower.includes("gemini_")) isGemini = true;
  if (isGemini) {
    return {
      host: "antigravity",
      mechanism: "model_configuration",
      confidence: "inferred",
      detail: `Model configuration '${modelName}' mapped to Antigravity`,
    };
  }

  let isClaude = false;
  if (lower.startsWith("claude")) isClaude = true;
  if (lower.includes("claude-")) isClaude = true;
  if (lower.includes("claude_")) isClaude = true;
  if (isClaude) {
    return {
      host: "claude_code",
      mechanism: "model_configuration",
      confidence: "inferred",
      detail: `Model configuration '${modelName}' mapped to Claude Code`,
    };
  }

  let isCodex = false;
  if (lower.startsWith("o1")) isCodex = true;
  if (lower.startsWith("o3")) isCodex = true;
  if (lower.startsWith("o4")) isCodex = true;
  if (lower.startsWith("gpt")) isCodex = true;
  if (lower.includes("codex")) isCodex = true;
  if (lower.includes("davinci")) isCodex = true;
  if (isCodex) {
    return {
      host: "codex",
      mechanism: "model_configuration",
      confidence: "inferred",
      detail: `Model configuration '${modelName}' mapped to Codex`,
    };
  }

  if (lower.includes("cursor")) {
    return {
      host: "cursor",
      mechanism: "model_configuration",
      confidence: "inferred",
      detail: `Model configuration '${modelName}' mapped to Cursor`,
    };
  }

  return null;
}

export function detectHostFromTerminal(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): HostDetectionSignal | null {
  const termProgram = env.TERM_PROGRAM ? env.TERM_PROGRAM.toLowerCase() : "";
  const injection = env.VSCODE_INJECTION ? env.VSCODE_INJECTION.toLowerCase() : "";
  let isCursorTerminal = false;
  if (termProgram === "cursor") isCursorTerminal = true;
  if (injection.includes("cursor")) isCursorTerminal = true;
  if (isCursorTerminal) {
    return {
      host: "cursor",
      mechanism: "terminal_fallback",
      confidence: "heuristic",
      detail: `TERM_PROGRAM=${env.TERM_PROGRAM ? env.TERM_PROGRAM : "cursor"}`,
    };
  }
  return null;
}

export function detectActiveHost(options: HostDetectionOptions = {}): HostDetectionResult {
  const env = options.env !== undefined ? options.env : (typeof process !== "undefined" ? process.env : {});
  const allSignals: HostDetectionSignal[] = [];

  const explicitSignal = detectHostFromExplicit(options.explicitHost);
  if (explicitSignal) {
    allSignals.push(explicitSignal);
    return {
      activeHost: explicitSignal.host,
      primaryPlatformId: canonicalHostToPlatformId(explicitSignal.host),
      signal: explicitSignal,
      allSignals,
      isFallback: false,
    };
  }

  const envSignal = detectHostFromEnvironment(env);
  if (envSignal) {
    allSignals.push(envSignal);
  }

  const processSignal = detectHostFromProcessTree(options.processTree);
  if (processSignal) {
    allSignals.push(processSignal);
  }

  const modelSignal = detectHostFromModel(options.model);
  if (modelSignal) {
    allSignals.push(modelSignal);
  }

  const termSignal = detectHostFromTerminal(env);
  if (termSignal) {
    allSignals.push(termSignal);
  }

  let chosenSignal: HostDetectionSignal | null = null;
  if (envSignal) {
    chosenSignal = envSignal;
  } else if (processSignal) {
    chosenSignal = processSignal;
  } else if (modelSignal) {
    chosenSignal = modelSignal;
  } else if (termSignal) {
    chosenSignal = termSignal;
  }

  if (chosenSignal) {
    return {
      activeHost: chosenSignal.host,
      primaryPlatformId: canonicalHostToPlatformId(chosenSignal.host),
      signal: chosenSignal,
      allSignals,
      isFallback: false,
    };
  }

  const fallbackSignal: HostDetectionSignal = {
    host: "antigravity",
    mechanism: "default_fallback",
    confidence: "heuristic",
    detail: "No explicit host or environmental signature matched; defaulted to antigravity",
  };

  return {
    activeHost: "antigravity",
    primaryPlatformId: "antigravity",
    signal: fallbackSignal,
    allSignals: [fallbackSignal],
    isFallback: true,
  };
}
