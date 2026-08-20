import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isThinkingLevel, type ThinkingLevel } from "../contracts/agents.ts";
import { evidenced, type Evidenced } from "../contracts/evidence.ts";
import { isJsonObject, type JsonObject } from "../contracts/json.ts";
import type { HostIdentity } from "./types.ts";

export interface DetectHostIdentityOptions {
  homeDir?: string;
  env?: Record<string, string | undefined>;
  /** The project path a per-project config keys its own values by. Defaults to `process.cwd()`. */
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
  } catch {
    // A config we cannot parse tells us nothing; it must not become a guess.
  }
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
  } catch {
    // A config we cannot parse tells us nothing; it must not become a guess.
  }
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
  /** How the file at `configPaths` is parsed. */
  configFormat: ConfigFormat;
  /** Keys in that config whose presence makes the file evidence rather than a coincidence. */
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
    // `agents` and `[features]` are tables, not strings; a config that declares either one is real
    // evidence of Codex even though neither carries a plain string value to check.
    configKeys: ["agents", "features", "model"],
  },
  { hostTool: "cursor", envVars: ["CURSOR_MODEL"], configPaths: [], configFormat: "json", configKeys: [] },
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
    // An unreadable config is not evidence either way.
    return null;
  }
}

/** A key counts as evidence when it is present at all — a table or a boolean is as real as a string. */
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

/** Stamped into the environment by Claude Code itself for every process it runs, unlike the
 * `HOST_PROBES` table below which only proves a tool is INSTALLED. A machine can carry another
 * host's config (e.g. Antigravity's `settings.json`) purely because that tool is also present,
 * which would otherwise shadow the host actually driving this call — first in `HOST_PROBES` order
 * wins there, with no way to tell "installed" from "running". This id is checked first because it
 * is evidence of the latter, read by `readAgentTranscriptTelemetry` (B34) off the very same variable. */
const SESSION_ID_ENV_VAR = "CLAUDE_CODE_SESSION_ID";

/**
 * Which harness this capsule was exported under. This is a fact about the exporting machine and
 * nothing else: it deliberately returns no model, because the machine's configured model is not
 * evidence about the model any particular agent in the run actually used. Per-agent model, tier and
 * thinking level come from the `state.agents` grant ledger or stay absent.
 */
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

/**
 * What a host can structurally do, independent of which model it happens to be running. Every field
 * is absent rather than guessed when this machine's config does not say — a host with no documented
 * or configured value for a capability stays unknown, never a plausible default.
 */
export interface HostCapabilities extends JsonObject {
  nesting_depth?: Evidenced<number>;
  concurrency_ceiling?: Evidenced<number>;
  native_workspace_isolation?: Evidenced<boolean>;
  native_resume?: Evidenced<boolean>;
  per_agent_model_selection?: Evidenced<boolean>;
  multi_agent_enabled?: Evidenced<boolean>;
}

/**
 * What the host's own configuration says about one agent, read from disk rather than asked of the
 * agent — the `derived` counterpart to whatever the agent or host separately reports over the CLI.
 */
export interface HostTelemetryProbe extends JsonObject {
  host_tool: string;
  provider?: Evidenced<string>;
  model?: Evidenced<string>;
  thinking_level?: Evidenced<ThinkingLevel>;
  context_window?: Evidenced<number>;
  capabilities: HostCapabilities;
  /** Real recorded spend for this project, keyed by exact model id, straight off the host's own
   * usage ledger rather than a rate-card estimate. Absent when the host has recorded no usage here. */
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

/** A single host's telemetry probe: the local evidence for one `hostTool`, keyed by that string
 * rather than named after it — matching the identity table above, no product names an identifier. */
type TelemetryProbe = (
  homeDir: string | undefined,
  env: Record<string, string | undefined>,
  agentId: string,
  cwd: string | undefined,
) => HostTelemetryProbe;

/** The project this run's own spend and settings are keyed under, in whichever host config records
 * them by absolute path. Read straight from disk rather than reconstructed from a slug — a config
 * that keys by path is asking to be indexed by that same path, not a derivative of it. */
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

// Named by role, not vendor: the variable itself is never the host's name, only its value is.
const SPAWN_DEPTH_ENV_VAR = "CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH";
const SPAWN_CONCURRENCY_ENV_VAR = "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS";

const TELEMETRY_PROBES: Readonly<Record<string, TelemetryProbe>> = {
  // The richest of the four sources: a session-wide concurrency ceiling and feature flag, plus the
  // agent definition files this host keeps per agent. A definition is evidence about THIS agent only
  // when one is filed under the very id the grant was registered with, so a run whose ids do not
  // match any definition reads nothing here rather than picking a neighbouring file.
  "codex": (homeDir, _env, agentId, _cwd) => {
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
        // A documented product capability (`resume_agent`, `spawn_agent`'s `model` parameter)
        // rather than something a local file states, so it is recorded whenever this host is.
        native_resume: evidenced(true, "derived"),
        per_agent_model_selection: evidenced(true, "derived"),
      },
    };
  },
  // Spawn limits are environment-configured with documented defaults, but an unset variable does
  // not prove the default is still in force on some future release — an absence stays absent
  // rather than becoming today's documented number.
  "claude-code": (homeDir, env, _agentId, cwd) => {
    const depth = derivedInt(parseFiniteInt(env[SPAWN_DEPTH_ENV_VAR]));
    const concurrency = derivedInt(parseFiniteInt(env[SPAWN_CONCURRENCY_ENV_VAR]));
    // The machine's own default reasoning effort, not this agent's — a fallback for whichever agent
    // the dispatcher never overrode, recorded as `derived` because it is read off a setting rather
    // than reported by the run itself. A value outside this harness's vocabulary (e.g. "xhigh" is
    // not one of the four `ThinkingLevel`s) is left unset rather than forced into "unknown", which
    // would misstate a specific answer the host gave as the host having no answer at all.
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
        // Frontmatter `model:`/`effort:`, resolved env > per-call > frontmatter > session default.
        per_agent_model_selection: evidenced(true, "derived"),
      },
    };
  },
  // A workspace-isolation and a resume primitive, both documented and neither discoverable from a
  // local config file; nesting depth and concurrency are not documented at all for this host.
  "antigravity": () => ({
    host_tool: "antigravity",
    capabilities: {
      native_workspace_isolation: evidenced(true, "derived"),
      native_resume: evidenced(true, "derived"),
    },
  }),
  // Since 2.5, the main agent and its direct subagents may spawn; a subagent's subagent may not.
  "cursor": () => ({
    host_tool: "cursor",
    capabilities: { nesting_depth: evidenced(2, "derived") },
  }),
};

/**
 * The automatic, hardcoded half of telemetry: what this machine's own configuration says about the
 * named agent, read from disk without asking the agent for anything. Callers combine this `derived`
 * evidence with whatever the agent or host separately reports; `agent:register`, `task:claim`,
 * `task:submit` and `agent:release` all call this on every invocation rather than as a separate step.
 */
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
  // A host identified only by an unattributed model variable carries no known capability table.
  const probe = TELEMETRY_PROBES[identity.hostTool];
  if (probe === undefined) return null;
  const env = options?.env ?? process.env;
  return probe(resolveHomeDir(options, env), env, agentId, resolveCwd(options));
}
