import type {
  AgentHostPolicy,
  AgentPolicy,
  AgentRbacPolicy,
  AgentSchedulerPolicy,
  HostType,
  ModelTier,
  ThinkingEffort,
  ValidatorQuotas,
} from "../types/index.ts";
import {
  assertAllowedKeys,
  integrity,
  isRecord,
  reqBool,
  reqInt,
  reqString,
} from "./primitives.ts";

export const CANONICAL_HOSTS: readonly HostType[] = [
  "antigravity",
  "claude_code",
  "codex",
  "cursor",
] as const;

const HOST_KEY_SET: ReadonlySet<string> = new Set(CANONICAL_HOSTS);
const MODEL_TIER_SET: ReadonlySet<string> = new Set(["low", "medium", "high", "xhigh"]);
const THINKING_EFFORT_SET: ReadonlySet<string> = new Set(["none", "low", "medium", "high"]);

const HOST_POLICY_KEYS: ReadonlySet<string> = new Set([
  "model",
  "model_tier",
  "thinking_effort",
  "max_tokens",
  "token_budget",
  "context_window",
  "scheduler",
  "temperature",
]);

const SCHEDULER_KEYS: ReadonlySet<string> = new Set([
  "cron",
  "interval_seconds",
  "enabled",
  "jitter_seconds",
]);

const QUOTAS_KEYS: ReadonlySet<string> = new Set([
  "mandatory_cognitive_pushbacks",
  "max_adversarial_probes",
  "max_turns_per_task",
  "escalate_on_exhausted_adversarial",
]);

const RBAC_KEYS: ReadonlySet<string> = new Set([
  "can_execute_shell",
  "can_edit_code",
  "allowed_commands",
  "forbidden_patterns",
  "allowed_spawns",
]);

const AGENT_KEYS: ReadonlySet<string> = new Set([
  "tier",
  "silent_daemon",
  "domain",
  "rbac",
  "quotas",
  "hosts",
]);

export function parseSchedulerPolicy(raw: unknown, p: string): AgentSchedulerPolicy {
  if (!isRecord(raw)) integrity(p, "must be an object");
  assertAllowedKeys(raw, SCHEDULER_KEYS, p);
  return {
    enabled: reqBool(raw["enabled"], `${p}.enabled`),
    ...(raw["cron"] !== undefined ? { cron: reqString(raw["cron"], `${p}.cron`) } : {}),
    ...(raw["interval_seconds"] !== undefined
      ? { interval_seconds: reqInt(raw["interval_seconds"], `${p}.interval_seconds`, 1) }
      : {}),
    ...(raw["jitter_seconds"] !== undefined
      ? { jitter_seconds: reqInt(raw["jitter_seconds"], `${p}.jitter_seconds`, 0) }
      : {}),
  };
}

export function parseHostPolicy(raw: unknown, p: string): AgentHostPolicy {
  if (!isRecord(raw)) integrity(p, "must be an object");
  assertAllowedKeys(raw, HOST_POLICY_KEYS, p);

  const modelTier = reqString(raw["model_tier"], `${p}.model_tier`);
  if (!MODEL_TIER_SET.has(modelTier)) integrity(`${p}.model_tier`, "invalid tier");

  let thinkingEffort: ThinkingEffort | undefined;
  if (raw["thinking_effort"] !== undefined) {
    const te = reqString(raw["thinking_effort"], `${p}.thinking_effort`);
    if (!THINKING_EFFORT_SET.has(te)) integrity(`${p}.thinking_effort`, "invalid effort");
    thinkingEffort = te as ThinkingEffort;
  }

  let scheduler: AgentSchedulerPolicy | undefined;
  if (isRecord(raw["scheduler"])) {
    scheduler = parseSchedulerPolicy(raw["scheduler"], `${p}.scheduler`);
  }

  return {
    model: reqString(raw["model"], `${p}.model`),
    model_tier: modelTier as ModelTier,
    ...(thinkingEffort !== undefined ? { thinking_effort: thinkingEffort } : {}),
    ...(raw["max_tokens"] !== undefined
      ? { max_tokens: reqInt(raw["max_tokens"], `${p}.max_tokens`, 1) }
      : {}),
    ...(raw["token_budget"] !== undefined
      ? { token_budget: reqInt(raw["token_budget"], `${p}.token_budget`, 1) }
      : {}),
    ...(raw["context_window"] !== undefined
      ? { context_window: reqInt(raw["context_window"], `${p}.context_window`, 1) }
      : {}),
    ...(scheduler !== undefined ? { scheduler } : {}),
    ...(raw["temperature"] !== undefined
      ? {
          temperature:
            typeof raw["temperature"] === "number" &&
            raw["temperature"] >= 0 &&
            raw["temperature"] <= 2
              ? raw["temperature"]
              : integrity(`${p}.temperature`, "must be [0,2]"),
        }
      : {}),
  };
}

export function parseQuotas(raw: unknown, p: string): ValidatorQuotas {
  if (!isRecord(raw)) integrity(p, "must be an object");
  assertAllowedKeys(raw, QUOTAS_KEYS, p);
  return {
    mandatory_cognitive_pushbacks: reqInt(
      raw["mandatory_cognitive_pushbacks"],
      `${p}.mandatory_cognitive_pushbacks`,
      0,
      100,
    ),
    max_adversarial_probes: reqInt(
      raw["max_adversarial_probes"],
      `${p}.max_adversarial_probes`,
      0,
      100,
    ),
    max_turns_per_task: reqInt(raw["max_turns_per_task"], `${p}.max_turns_per_task`, 1, 100),
    escalate_on_exhausted_adversarial: reqBool(
      raw["escalate_on_exhausted_adversarial"],
      `${p}.escalate_on_exhausted_adversarial`,
    ),
  };
}

function parseStringArray(arr: unknown, p: string): readonly string[] | undefined {
  if (arr === undefined) return undefined;
  if (!Array.isArray(arr)) integrity(p, "must be array");
  return (arr as unknown[]).map((v, i) => reqString(v, `${p}[${i}]`));
}

export function parseRbac(raw: unknown, p: string): AgentRbacPolicy {
  if (!isRecord(raw)) integrity(p, "must be an object");
  assertAllowedKeys(raw, RBAC_KEYS, p);

  const allowedCmds = parseStringArray(raw["allowed_commands"], `${p}.allowed_commands`);
  const forbiddenPats = parseStringArray(raw["forbidden_patterns"], `${p}.forbidden_patterns`);
  const allowedSpawns = parseStringArray(raw["allowed_spawns"], `${p}.allowed_spawns`);

  return {
    can_execute_shell: reqBool(raw["can_execute_shell"], `${p}.can_execute_shell`),
    can_edit_code: reqBool(raw["can_edit_code"], `${p}.can_edit_code`),
    ...(allowedCmds !== undefined ? { allowed_commands: allowedCmds } : {}),
    ...(forbiddenPats !== undefined ? { forbidden_patterns: forbiddenPats } : {}),
    ...(allowedSpawns !== undefined ? { allowed_spawns: allowedSpawns } : {}),
  };
}

export function parseAgentPolicy(raw: unknown, p: string): AgentPolicy {
  if (!isRecord(raw)) integrity(p, "must be an object");
  assertAllowedKeys(raw, AGENT_KEYS, p);

  const tier = raw["tier"] === "independent" ? "independent" : reqInt(raw["tier"], `${p}.tier`, 0);
  if (!isRecord(raw["hosts"])) integrity(`${p}.hosts`, "must be an object");

  for (const k of Object.keys(raw["hosts"])) {
    if (!HOST_KEY_SET.has(k)) integrity(`${p}.hosts.${k}`, "is not a supported host");
  }

  const hosts = Object.fromEntries(
    CANONICAL_HOSTS.map((h) => [
      h,
      parseHostPolicy(
        (raw["hosts"] as Record<string, unknown>)[h] ??
          integrity(`${p}.hosts.${h}`, "missing host"),
        `${p}.hosts.${h}`,
      ),
    ]),
  ) as Record<HostType, AgentHostPolicy>;

  return {
    tier,
    ...(raw["silent_daemon"] !== undefined
      ? { silent_daemon: reqBool(raw["silent_daemon"], `${p}.silent_daemon`) }
      : {}),
    ...(raw["domain"] !== undefined ? { domain: reqString(raw["domain"], `${p}.domain`) } : {}),
    rbac: parseRbac(raw["rbac"], `${p}.rbac`),
    ...(raw["quotas"] !== undefined ? { quotas: parseQuotas(raw["quotas"], `${p}.quotas`) } : {}),
    hosts,
  };
}

export function parseAgents(raw: unknown, p: string): Record<string, AgentPolicy> | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) integrity(p, "must be an object");
  const agents: Record<string, AgentPolicy> = {};
  for (const [k, v] of Object.entries(raw)) {
    agents[k] = parseAgentPolicy(v, `${p}.${k}`);
  }
  return Object.keys(agents).length > 0 ? agents : undefined;
}
