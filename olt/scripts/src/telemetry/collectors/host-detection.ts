import {
  detectHostFromEnvironmentRules,
  detectHostFromModelRules,
  detectHostFromProcessTreeRules,
} from "./host-detection-rules.ts";

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
  if (normalized === "antigravity" || normalized === "agy" || normalized === "gemini")
    return "antigravity";
  if (
    normalized === "claude_code" ||
    normalized === "claude" ||
    normalized === "claudecode" ||
    normalized === "anthropic"
  )
    return "claude_code";
  if (
    normalized === "codex" ||
    normalized === "openai" ||
    normalized === "opencode" ||
    normalized === "codex_cli"
  )
    return "codex";
  if (normalized === "cursor" || normalized === "cursor_agent") return "cursor";
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
  if (!explicitHost || typeof explicitHost !== "string" || !explicitHost.trim()) return null;
  const host = normalizeHostName(explicitHost);
  if (!host) return null;
  return {
    host,
    mechanism: "explicit_override",
    confidence: "verified_exact",
    detail: `Explicit host override: '${explicitHost}'`,
  };
}

export function detectHostFromEnvironment(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): HostDetectionSignal | null {
  const explicit = env.OVERRIDE_HOST ?? env.HARNESS_HOST ?? env.ACTIVE_HOST;
  if (explicit) {
    const explicitSignal = detectHostFromExplicit(explicit);
    if (explicitSignal) return explicitSignal;
  }
  return detectHostFromEnvironmentRules(env);
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
  return detectHostFromProcessTreeRules(entries);
}

export function detectHostFromModel(modelName?: string): HostDetectionSignal | null {
  if (!modelName || typeof modelName !== "string" || !modelName.trim()) return null;
  return detectHostFromModelRules(modelName.trim().toLowerCase(), modelName);
}

export function detectHostFromTerminal(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): HostDetectionSignal | null {
  const termProgram = env.TERM_PROGRAM ? env.TERM_PROGRAM.toLowerCase() : "";
  const injection = env.VSCODE_INJECTION ? env.VSCODE_INJECTION.toLowerCase() : "";
  if (termProgram === "cursor" || injection.includes("cursor")) {
    return {
      host: "cursor",
      mechanism: "terminal_fallback",
      confidence: "heuristic",
      detail: `TERM_PROGRAM=${env.TERM_PROGRAM ?? "cursor"}`,
    };
  }
  return null;
}

export function detectActiveHost(options: HostDetectionOptions = {}): HostDetectionResult {
  const env = options.env ?? (typeof process !== "undefined" ? process.env : {});
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
  if (envSignal) allSignals.push(envSignal);

  const processSignal = detectHostFromProcessTree(options.processTree);
  if (processSignal) allSignals.push(processSignal);

  const modelSignal = detectHostFromModel(options.model);
  if (modelSignal) allSignals.push(modelSignal);

  const termSignal = detectHostFromTerminal(env);
  if (termSignal) allSignals.push(termSignal);

  const chosenSignal = envSignal ?? processSignal ?? modelSignal ?? termSignal;
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
