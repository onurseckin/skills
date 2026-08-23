import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isThinkingLevel, type ThinkingLevel } from "../../contracts/agents.ts";
import { evidenced, type Evidenced } from "../../contracts/evidence.ts";
import { isJsonObject, type JsonObject } from "../../contracts/json.ts";
import type { HostIdentity } from "../types.ts";

export interface DetectHostIdentityOptions {
  homeDir?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

function parseJsonSafe(raw: string): Record<string, unknown> | null {
  try {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return null;
}

function parseTomlSafe(raw: string): Record<string, unknown> | null {
  try {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const parsed: unknown = Bun.TOML.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return null;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

type ConfigFormat = "json" | "toml";

interface HostProbe {
  hostTool: string;
  envVars: readonly string[];
  configPaths: readonly (readonly string[])[];
  configFormat: ConfigFormat;
  configKeys: readonly string[];
}

const HOST_PROBES: readonly HostProbe[] = [
  {
    hostTool: "antigravity",
    envVars: [],
    configPaths: [[".gemini", "antigravity-cli", "settings.json"]],
    configFormat: "json",
    configKeys: ["model"],
  },
  {
    hostTool: "claude-code",
    envVars: ["CLAUDE_CODE_MODEL", "ANTHROPIC_MODEL"],
    configPaths: [[".claude.json"]],
    configFormat: "json",
    configKeys: ["model", "currentModel"],
  },
  {
    hostTool: "codex",
    envVars: [],
    configPaths: [[".codex", "config.toml"]],
    configFormat: "toml",
    configKeys: ["agents", "features", "model"],
  },
  {
    hostTool: "cursor",
    envVars: ["CURSOR_MODEL"],
    configPaths: [],
    configFormat: "json",
    configKeys: [],
  },
];

const UNATTRIBUTED_MODEL_VARS: readonly string[] = [
  "MODEL",
  "AI_MODEL",
  "GEMINI_MODEL",
  "ANTIGRAVITY_MODEL",
];

function readConfig(
  homeDir: string | undefined,
  segments: readonly string[],
  format: ConfigFormat,
): Record<string, unknown> | null {
  if (!homeDir) return null;
  try {
    const configPath = join(homeDir, ...segments);
    if (!existsSync(configPath)) return null;
    const raw = readFileSync(configPath, "utf-8");
    return format === "toml" ? parseTomlSafe(raw) : parseJsonSafe(raw);
  } catch {
    return null;
  }
}

function keyIsEvidence(parsed: Record<string, unknown>, key: string): boolean {
  const value = parsed[key];
  if (value === undefined) return false;
  return typeof value === "string" ? value.trim().length > 0 : true;
}

function configConfigured(homeDir: string | undefined, probe: HostProbe): boolean {
  for (const segments of probe.configPaths) {
    const parsed = readConfig(homeDir, segments, probe.configFormat);
    if (parsed !== null && probe.configKeys.some((key) => keyIsEvidence(parsed, key))) return true;
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

const SESSION_ID_ENV_VAR = "CLAUDE_CODE_SESSION_ID";

export function detectHostIdentity(options?: DetectHostIdentityOptions): HostIdentity | null {
  const env = options?.env ?? process.env;
  const homeDir = resolveHomeDir(options, env);

  if (hasText(env[SESSION_ID_ENV_VAR])) {
    return { hostTool: "claude-code", evidenceClass: "harness_observed" };
  }

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

export interface HostCapabilities extends JsonObject {
  nesting_depth?: Evidenced<number>;
  concurrency_ceiling?: Evidenced<number>;
  native_workspace_isolation?: Evidenced<boolean>;
  native_resume?: Evidenced<boolean>;
  per_agent_model_selection?: Evidenced<boolean>;
  multi_agent_enabled?: Evidenced<boolean>;
}

export interface HostTelemetryProbe extends JsonObject {
  host_tool: string;
  provider?: Evidenced<string>;
  model?: Evidenced<string>;
  thinking_level?: Evidenced<ThinkingLevel>;
  context_window?: Evidenced<number>;
  capabilities: HostCapabilities;
  last_model_usage?: Evidenced<JsonObject>;
}

function derivedString(value: string | undefined): Evidenced<string> | undefined {
  return value === undefined ? undefined : evidenced(value, "derived");
}

function derivedInt(value: number | undefined): Evidenced<number> | undefined {
  return value === undefined ? undefined : evidenced(value, "derived");
}

function derivedBool(value: boolean | undefined): Evidenced<boolean> | undefined {
  return value === undefined ? undefined : evidenced(value, "derived");
}

function readStringField(source: Record<string, unknown> | null, key: string): string | undefined {
  if (source === null) return undefined;
  const value = source[key];
  return hasText(value) ? value.trim() : undefined;
}

function readIntField(source: Record<string, unknown> | null, key: string): number | undefined {
  if (source === null) return undefined;
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function readBoolField(source: Record<string, unknown> | null, key: string): boolean | undefined {
  if (source === null) return undefined;
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
}

function parseFiniteInt(raw: string | undefined): number | undefined {
  if (!hasText(raw)) return undefined;
  const value = Number(raw.trim());
  return Number.isFinite(value) && Number.isInteger(value) ? value : undefined;
}

type TelemetryProbe = (
  homeDir: string | undefined,
  env: Record<string, string | undefined>,
  agentId: string,
  cwd: string | undefined,
) => HostTelemetryProbe;

function readLastModelUsage(
  homeDir: string | undefined,
  cwd: string | undefined,
): Evidenced<JsonObject> | undefined {
  if (cwd === undefined) return undefined;
  const config = readConfig(homeDir, [".claude.json"], "json");
  if (config === null) return undefined;
  const projects = config.projects;
  if (!isJsonObject(projects)) return undefined;
  const project = projects[cwd];
  if (!isJsonObject(project)) return undefined;
  const usage = project.lastModelUsage;
  if (!isJsonObject(usage) || Object.keys(usage).length === 0) return undefined;
  return evidenced(usage, "derived");
}

const SPAWN_DEPTH_ENV_VAR = "CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH";
const SPAWN_CONCURRENCY_ENV_VAR = "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS";

const TELEMETRY_PROBES: Readonly<Record<string, TelemetryProbe>> = {
  ["codex"]: (homeDir, _env, agentId, _cwd) => {
    const config = readConfig(homeDir, [".codex", "config.toml"], "toml");
    const agentsTable = isPlainObject(config?.agents) ? config.agents : null;
    const featuresTable = isPlainObject(config?.features) ? config.features : null;
    const agentConfig = readConfig(homeDir, [".codex", "agents", `${agentId}.toml`], "toml");

    const model = derivedString(readStringField(agentConfig, "model"));
    const provider = derivedString(readStringField(agentConfig, "provider"));
    const reasoningEffort = readStringField(agentConfig, "reasoning_effort");
    const thinkingLevel =
      reasoningEffort !== undefined && isThinkingLevel(reasoningEffort)
        ? evidenced(reasoningEffort, "derived")
        : undefined;
    const concurrencyCeiling = derivedInt(
      readIntField(agentsTable, "max_concurrent_threads_per_session"),
    );
    const multiAgentEnabled = derivedBool(readBoolField(featuresTable, "multi_agent"));

    return {
      host_tool: "codex",
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
      ...(thinkingLevel === undefined ? {} : { thinking_level: thinkingLevel }),
      capabilities: {
        ...(concurrencyCeiling === undefined ? {} : { concurrency_ceiling: concurrencyCeiling }),
        ...(multiAgentEnabled === undefined ? {} : { multi_agent_enabled: multiAgentEnabled }),
        native_resume: evidenced(true, "derived"),
        per_agent_model_selection: evidenced(true, "derived"),
      },
    };
  },
  "claude-code": (homeDir, env, _agentId, cwd) => {
    const depth = derivedInt(parseFiniteInt(env[SPAWN_DEPTH_ENV_VAR]));
    const concurrency = derivedInt(parseFiniteInt(env[SPAWN_CONCURRENCY_ENV_VAR]));
    const settings = readConfig(homeDir, [".claude", "settings.json"], "json");
    const effortLevel = readStringField(settings, "effortLevel");
    const thinkingLevel =
      effortLevel !== undefined && isThinkingLevel(effortLevel)
        ? evidenced(effortLevel, "derived")
        : undefined;
    const lastModelUsage = readLastModelUsage(homeDir, cwd);
    return {
      host_tool: "claude-code",
      ...(thinkingLevel === undefined ? {} : { thinking_level: thinkingLevel }),
      ...(lastModelUsage === undefined ? {} : { last_model_usage: lastModelUsage }),
      capabilities: {
        ...(depth === undefined ? {} : { nesting_depth: depth }),
        ...(concurrency === undefined ? {} : { concurrency_ceiling: concurrency }),
        per_agent_model_selection: evidenced(true, "derived"),
      },
    };
  },
  ["antigravity"]: () => ({
    host_tool: "antigravity",
    capabilities: {
      native_workspace_isolation: evidenced(true, "derived"),
      native_resume: evidenced(true, "derived"),
    },
  }),
  ["cursor"]: () => ({
    host_tool: "cursor",
    capabilities: { nesting_depth: evidenced(2, "derived") },
  }),
};

function resolveCwd(options: DetectHostIdentityOptions | undefined): string | undefined {
  if (hasText(options?.cwd)) return options.cwd.trim();
  try {
    const cwd = process.cwd();
    return hasText(cwd) ? cwd : undefined;
  } catch {
    return undefined;
  }
}

export function detectHostTelemetry(
  agentId: string,
  options?: DetectHostIdentityOptions,
): HostTelemetryProbe | null {
  const identity = detectHostIdentity(options);
  if (identity === null) return null;
  const probe = TELEMETRY_PROBES[identity.hostTool];
  if (probe === undefined) return null;
  const env = options?.env ?? process.env;
  return probe(resolveHomeDir(options, env), env, agentId, resolveCwd(options));
}
