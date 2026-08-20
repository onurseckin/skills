import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HostIdentity } from "./types.ts";

export interface DetectHostIdentityOptions {
  homeDir?: string;
  env?: Record<string, string | undefined>;
}

function parseJsonSafe(raw: string): Record<string, unknown> | null {
  try {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // A config we cannot parse tells us nothing; it must not become a guess.
  }
  return null;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveHomeDir(
  options: DetectHostIdentityOptions | undefined,
  env: Record<string, string | undefined>,
): string | undefined {
  if (options?.homeDir) return options.homeDir;
  if (hasText(env.HOME)) return env.HOME.trim();
  if (hasText(env.USERPROFILE)) return env.USERPROFILE.trim();
  try {
    const home = homedir();
    return hasText(home) ? home.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One host runtime and the local evidence that it is the one this capsule was exported under. Every
 * product name in this file is a VALUE in this table — a row of data, never a type, a field or a
 * constant named after a vendor — so the rest of the code stays free of any particular host.
 */
interface HostProbe {
  /** The host as it will be recorded. An open string; nothing downstream matches against it. */
  hostTool: string;
  /** Environment variables whose presence alone identifies this host. */
  envVars: readonly string[];
  /** Config files below the home directory, as path segments. */
  configPaths: readonly (readonly string[])[];
  /** Keys in that config whose presence makes the file evidence rather than a coincidence. */
  configKeys: readonly string[];
}

const HOST_PROBES: readonly HostProbe[] = [
  {
    hostTool: "antigravity",
    envVars: [],
    configPaths: [[".gemini", "antigravity-cli", "settings.json"]],
    configKeys: ["model"],
  },
  {
    hostTool: "claude-code",
    envVars: ["CLAUDE_CODE_MODEL", "ANTHROPIC_MODEL"],
    configPaths: [[".claude.json"]],
    configKeys: ["model", "currentModel"],
  },
  { hostTool: "cursor", envVars: ["CURSOR_MODEL"], configPaths: [], configKeys: [] },
];

/**
 * Variables that say a model was configured without saying which host configured it. They identify
 * a host the registry does not know, which is recorded as exactly that and not guessed at.
 */
const UNATTRIBUTED_MODEL_VARS: readonly string[] = [
  "MODEL",
  "AI_MODEL",
  "GEMINI_MODEL",
  "ANTIGRAVITY_MODEL",
];

function configConfigured(homeDir: string | undefined, probe: HostProbe): boolean {
  if (!homeDir) return false;
  for (const segments of probe.configPaths) {
    try {
      const configPath = join(homeDir, ...segments);
      if (!existsSync(configPath)) continue;
      const parsed = parseJsonSafe(readFileSync(configPath, "utf-8"));
      if (parsed !== null && probe.configKeys.some((key) => hasText(parsed[key]))) return true;
    } catch {
      // An unreadable config is not evidence either way; the next candidate still gets its turn.
    }
  }
  return false;
}

function probeMatches(
  probe: HostProbe,
  homeDir: string | undefined,
  env: Record<string, string | undefined>,
): boolean {
  if (probe.envVars.some((name) => hasText(env[name]))) return true;
  return configConfigured(homeDir, probe);
}

/**
 * Which harness this capsule was exported under. This is a fact about the exporting machine and
 * nothing else: it deliberately returns no model, because the machine's configured model is not
 * evidence about the model any particular agent in the run actually used. Per-agent model, tier and
 * thinking level come from the `state.agents` grant ledger or stay absent.
 */
export function detectHostIdentity(options?: DetectHostIdentityOptions): HostIdentity | null {
  const env = options?.env ?? process.env;
  const homeDir = resolveHomeDir(options, env);

  for (const probe of HOST_PROBES) {
    if (probeMatches(probe, homeDir, env)) {
      return { hostTool: probe.hostTool, evidenceClass: "harness_observed" };
    }
  }
  if (UNATTRIBUTED_MODEL_VARS.some((name) => hasText(env[name]))) {
    return { hostTool: "custom", evidenceClass: "harness_observed" };
  }
  return null;
}
