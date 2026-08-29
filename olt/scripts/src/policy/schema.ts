import { HarnessError } from "../core/errors/index.ts";
import { DEFAULT_PLANNING_POLICY, DEFAULT_REVIEW_PROTOCOL_POLICY } from "./generator.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  type AgentHostPolicy,
  type AgentPolicy,
  type AgentRbacPolicy,
  type AgentSchedulerPolicy,
  type AuthPathsConfig,
  type ContainerConfig,
  type CookieTemplateConfig,
  type DockerTestProfile,
  type HostType,
  type ModelTier,
  type PackageManager,
  type PlanningPolicy,
  type RepoEcosystem,
  type RepoPolicy,
  type ReviewProtocolPolicy,
  type TestRunnerPolicy,
  type ThinkingEffort,
  type UserPersonaConfig,
  type UserPersonaRole,
  type ValidatorQuotas,
} from "./types.ts";

const TOP_LEVEL_KEYS = new Set([
  "schema_version",
  "ecosystem",
  "package_manager",
  "skill_home_repo_root",
  "test_runner",
  "typecheck_command",
  "lint_command",
  "allowed_commands",
  "forbidden_commands",
  "read_scope_neighborhood_depth",
  "review_protocol",
  "planning",
  "agents",
  "docker_environment",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function integrity(p: string, m: string): never {
  throw new HarnessError("INTEGRITY", `Repo policy ${p}: ${m}`);
}
function invalidArg(p: string, m: string): never {
  throw new HarnessError("INVALID_ARGUMENT", `Repo policy ${p}: ${m}`);
}
function reqString(v: unknown, p: string): string {
  if (typeof v !== "string" || v.trim().length === 0) integrity(p, "must be a non-empty string");
  return v.trim();
}
function reqInt(v: unknown, p: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max)
    integrity(p, `must be an integer in [${min}, ${max}]`);
  return v;
}
function reqBool(v: unknown, p: string): boolean {
  if (typeof v !== "boolean") integrity(p, "must be a boolean");
  return v;
}

function parseTestRunner(raw: unknown, p: string): TestRunnerPolicy {
  if (raw === undefined)
    return {
      default_command: "bun test",
      targeted_pattern: "bun test <path>",
      full_suite_command: "bun test",
    };
  if (!isRecord(raw)) integrity(p, "must be an object");
  for (const k of Object.keys(raw))
    if (!["default_command", "targeted_pattern", "full_suite_command", "timeout_ms"].includes(k))
      integrity(`${p}.${k}`, "is not a supported policy field");
  return {
    default_command: reqString(raw["default_command"], `${p}.default_command`),
    targeted_pattern: reqString(raw["targeted_pattern"], `${p}.targeted_pattern`),
    full_suite_command: reqString(raw["full_suite_command"], `${p}.full_suite_command`),
    ...(raw["timeout_ms"] !== undefined
      ? { timeout_ms: reqInt(raw["timeout_ms"], `${p}.timeout_ms`, 1) }
      : {}),
  };
}

function parseReviewProtocol(raw: unknown, p: string): ReviewProtocolPolicy {
  if (!isRecord(raw)) integrity(p, "must be an object");
  for (const k of Object.keys(raw))
    if (
      !["max_adversarial_pushes", "cognitive_pushes", "escalate_on_exhausted_adversarial"].includes(
        k,
      )
    )
      integrity(`${p}.${k}`, "is not a supported policy field");
  const maxAdv = reqInt(
    raw["max_adversarial_pushes"] ?? DEFAULT_REVIEW_PROTOCOL_POLICY.max_adversarial_pushes,
    `${p}.max_adversarial_pushes`,
    1,
    100,
  );
  const cog = reqInt(
    raw["cognitive_pushes"] ?? DEFAULT_REVIEW_PROTOCOL_POLICY.cognitive_pushes,
    `${p}.cognitive_pushes`,
    0,
    maxAdv,
  );
  if (cog > maxAdv) integrity(`${p}.cognitive_pushes`, "must not exceed max_adversarial_pushes");
  const esc =
    raw["escalate_on_exhausted_adversarial"] !== undefined
      ? reqBool(raw["escalate_on_exhausted_adversarial"], `${p}.escalate_on_exhausted_adversarial`)
      : (DEFAULT_REVIEW_PROTOCOL_POLICY.escalate_on_exhausted_adversarial ?? true);
  return {
    max_adversarial_pushes: maxAdv,
    cognitive_pushes: cog,
    escalate_on_exhausted_adversarial: esc,
  };
}

function parsePlanning(raw: unknown, p: string): PlanningPolicy {
  if (!isRecord(raw)) integrity(p, "must be an object");
  const allowed = new Set([
    "mandatory_brainstorming_rounds",
    "socratic_expansion_depth",
    "enforce_edge_case_matrix",
    "min_tasks_per_complex_prompt",
    "max_files_per_task",
    "reject_shallow_umbrella_compression",
    "max_task_duration_minutes",
    "parallel_subagent_sla_rule",
    "stage_on_subdomain_completion",
  ]);
  for (const k of Object.keys(raw))
    if (!allowed.has(k)) integrity(`${p}.${k}`, "is not a supported policy field");
  return {
    mandatory_brainstorming_rounds: reqInt(
      raw["mandatory_brainstorming_rounds"] ??
        DEFAULT_PLANNING_POLICY.mandatory_brainstorming_rounds,
      `${p}.mandatory_brainstorming_rounds`,
      0,
      100,
    ),
    socratic_expansion_depth: reqInt(
      raw["socratic_expansion_depth"] ?? DEFAULT_PLANNING_POLICY.socratic_expansion_depth,
      `${p}.socratic_expansion_depth`,
      0,
      100,
    ),
    enforce_edge_case_matrix:
      raw["enforce_edge_case_matrix"] !== undefined
        ? reqBool(raw["enforce_edge_case_matrix"], `${p}.enforce_edge_case_matrix`)
        : DEFAULT_PLANNING_POLICY.enforce_edge_case_matrix,
    min_tasks_per_complex_prompt: reqInt(
      raw["min_tasks_per_complex_prompt"] ?? DEFAULT_PLANNING_POLICY.min_tasks_per_complex_prompt,
      `${p}.min_tasks_per_complex_prompt`,
      1,
      100,
    ),
    max_files_per_task: reqInt(
      raw["max_files_per_task"] ?? DEFAULT_PLANNING_POLICY.max_files_per_task,
      `${p}.max_files_per_task`,
      1,
      100,
    ),
    reject_shallow_umbrella_compression:
      raw["reject_shallow_umbrella_compression"] !== undefined
        ? reqBool(
            raw["reject_shallow_umbrella_compression"],
            `${p}.reject_shallow_umbrella_compression`,
          )
        : DEFAULT_PLANNING_POLICY.reject_shallow_umbrella_compression,
    ...(raw["max_task_duration_minutes"] !== undefined
      ? {
          max_task_duration_minutes: reqInt(
            raw["max_task_duration_minutes"],
            `${p}.max_task_duration_minutes`,
            1,
          ),
        }
      : {}),
    ...(raw["parallel_subagent_sla_rule"] !== undefined
      ? {
          parallel_subagent_sla_rule: reqBool(
            raw["parallel_subagent_sla_rule"],
            `${p}.parallel_subagent_sla_rule`,
          ),
        }
      : {}),
    ...(raw["stage_on_subdomain_completion"] !== undefined
      ? {
          stage_on_subdomain_completion: reqBool(
            raw["stage_on_subdomain_completion"],
            `${p}.stage_on_subdomain_completion`,
          ),
        }
      : {}),
  };
}

function parseHostPolicy(raw: unknown, p: string): AgentHostPolicy {
  if (!isRecord(raw)) integrity(p, "must be an object");
  const allowed = new Set([
    "model",
    "model_tier",
    "thinking_effort",
    "max_tokens",
    "token_budget",
    "context_window",
    "scheduler",
    "temperature",
  ]);
  for (const k of Object.keys(raw))
    if (!allowed.has(k)) integrity(`${p}.${k}`, "is not a supported policy field");
  const modelTier = reqString(raw["model_tier"], `${p}.model_tier`);
  if (!["low", "medium", "high", "xhigh"].includes(modelTier))
    integrity(`${p}.model_tier`, "invalid tier");
  let thinkingEffort: ThinkingEffort | undefined;
  if (raw["thinking_effort"] !== undefined) {
    const te = reqString(raw["thinking_effort"], `${p}.thinking_effort`);
    if (!["none", "low", "medium", "high"].includes(te))
      integrity(`${p}.thinking_effort`, "invalid effort");
    thinkingEffort = te as ThinkingEffort;
  }
  let scheduler: AgentSchedulerPolicy | undefined;
  if (isRecord(raw["scheduler"])) {
    const s = raw["scheduler"];
    for (const k of Object.keys(s))
      if (!["cron", "interval_seconds", "enabled", "jitter_seconds"].includes(k))
        integrity(`${p}.scheduler.${k}`, "is not a supported policy field");
    scheduler = {
      enabled: reqBool(s["enabled"], `${p}.scheduler.enabled`),
      ...(s["cron"] !== undefined ? { cron: reqString(s["cron"], `${p}.scheduler.cron`) } : {}),
      ...(s["interval_seconds"] !== undefined
        ? { interval_seconds: reqInt(s["interval_seconds"], `${p}.scheduler.interval_seconds`, 1) }
        : {}),
      ...(s["jitter_seconds"] !== undefined
        ? { jitter_seconds: reqInt(s["jitter_seconds"], `${p}.scheduler.jitter_seconds`, 0) }
        : {}),
    };
  }
  return {
    model: reqString(raw["model"], `${p}.model`),
    model_tier: modelTier as ModelTier,
    ...(thinkingEffort ? { thinking_effort: thinkingEffort } : {}),
    ...(raw["max_tokens"] !== undefined
      ? { max_tokens: reqInt(raw["max_tokens"], `${p}.max_tokens`, 1) }
      : {}),
    ...(raw["token_budget"] !== undefined
      ? { token_budget: reqInt(raw["token_budget"], `${p}.token_budget`, 1) }
      : {}),
    ...(raw["context_window"] !== undefined
      ? { context_window: reqInt(raw["context_window"], `${p}.context_window`, 1) }
      : {}),
    ...(scheduler ? { scheduler } : {}),
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

function parseQuotas(raw: unknown, p: string): ValidatorQuotas {
  if (!isRecord(raw)) integrity(p, "must be an object");
  for (const k of Object.keys(raw))
    if (
      ![
        "mandatory_cognitive_pushbacks",
        "max_adversarial_probes",
        "max_turns_per_task",
        "escalate_on_exhausted_adversarial",
      ].includes(k)
    )
      integrity(`${p}.${k}`, "is not a supported policy field");
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

function parseRbac(raw: unknown, p: string): AgentRbacPolicy {
  if (!isRecord(raw)) integrity(p, "must be an object");
  for (const k of Object.keys(raw))
    if (
      ![
        "can_execute_shell",
        "can_edit_code",
        "allowed_commands",
        "forbidden_patterns",
        "allowed_spawns",
      ].includes(k)
    )
      integrity(`${p}.${k}`, "is not a supported policy field");
  const parseArr = (k: string) => {
    const arr = raw[k];
    if (arr === undefined) return undefined;
    if (!Array.isArray(arr)) integrity(`${p}.${k}`, "must be array");
    return (arr as unknown[]).map((v, i) => reqString(v, `${p}.${k}[${i}]`));
  };
  return {
    can_execute_shell: reqBool(raw["can_execute_shell"], `${p}.can_execute_shell`),
    can_edit_code: reqBool(raw["can_edit_code"], `${p}.can_edit_code`),
    ...(raw["allowed_commands"] !== undefined
      ? { allowed_commands: parseArr("allowed_commands") }
      : {}),
    ...(raw["forbidden_patterns"] !== undefined
      ? { forbidden_patterns: parseArr("forbidden_patterns") }
      : {}),
    ...(raw["allowed_spawns"] !== undefined ? { allowed_spawns: parseArr("allowed_spawns") } : {}),
  };
}

function parseAgentPolicy(raw: unknown, p: string): AgentPolicy {
  if (!isRecord(raw)) integrity(p, "must be an object");
  for (const k of Object.keys(raw))
    if (!["tier", "silent_daemon", "domain", "rbac", "quotas", "hosts"].includes(k))
      integrity(`${p}.${k}`, "is not a supported policy field");
  const tier = raw["tier"] === "independent" ? "independent" : reqInt(raw["tier"], `${p}.tier`, 0);
  if (!isRecord(raw["hosts"])) integrity(`${p}.hosts`, "must be an object");
  const canonicalHosts: HostType[] = ["antigravity", "claude_code", "codex", "cursor"];
  const allowedHosts = new Set(canonicalHosts);
  for (const k of Object.keys(raw["hosts"]))
    if (!allowedHosts.has(k as HostType)) integrity(`${p}.hosts.${k}`, "is not a supported host");
  const hosts = Object.fromEntries(
    canonicalHosts.map((h) => [
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

function parseDockerEnv(raw: unknown, p: string): DockerTestProfile {
  if (!isRecord(raw)) integrity(p, "must be an object");
  for (const k of Object.keys(raw))
    if (
      ![
        "enabled",
        "compose_file",
        "containers",
        "test_user_personas",
        "auth_paths",
        "session_cookie_templates",
      ].includes(k)
    )
      integrity(`${p}.${k}`, "is not a supported policy field");
  const containers: Record<string, ContainerConfig> = {};
  if (isRecord(raw["containers"])) {
    for (const [k, v] of Object.entries(raw["containers"])) {
      if (!isRecord(v)) integrity(`${p}.containers.${k}`, "must be object");
      for (const f of Object.keys(v))
        if (
          ![
            "container_name",
            "image",
            "ports",
            "health_endpoint",
            "ready_timeout_ms",
            "env",
          ].includes(f)
        )
          integrity(`${p}.containers.${k}.${f}`, "is not supported");
      containers[k] = {
        container_name: reqString(v["container_name"], `${p}.containers.${k}.container_name`),
        image: reqString(v["image"], `${p}.containers.${k}.image`),
        ports: Array.isArray(v["ports"])
          ? (v["ports"] as unknown[]).map((port, i) =>
              reqString(port, `${p}.containers.${k}.ports[${i}]`),
            )
          : integrity(`${p}.containers.${k}.ports`, "must be array"),
        health_endpoint: reqString(v["health_endpoint"], `${p}.containers.${k}.health_endpoint`),
        ready_timeout_ms: reqInt(v["ready_timeout_ms"], `${p}.containers.${k}.ready_timeout_ms`, 1),
        ...(isRecord(v["env"])
          ? {
              env: Object.fromEntries(
                Object.entries(v["env"]).map(([ek, ev]) => [
                  ek,
                  reqString(ev, `${p}.containers.${k}.env.${ek}`),
                ]),
              ),
            }
          : {}),
      };
    }
  }
  const personas: Record<UserPersonaRole, UserPersonaConfig> = {} as Record<
    UserPersonaRole,
    UserPersonaConfig
  >;
  if (isRecord(raw["test_user_personas"])) {
    for (const [role, v] of Object.entries(raw["test_user_personas"])) {
      if (!isRecord(v)) integrity(`${p}.test_user_personas.${role}`, "must be object");
      for (const f of Object.keys(v))
        if (
          ![
            "role",
            "email",
            "password_env_var",
            "display_name",
            "tenant_id",
            "permissions",
            "mock_session_cookie",
          ].includes(f)
        )
          integrity(`${p}.test_user_personas.${role}.${f}`, "is not supported");
      const r = reqString(v["role"], `${p}.test_user_personas.${role}.role`);
      if (!["admin", "standard_user", "invited_member", "guest"].includes(r))
        integrity(`${p}.test_user_personas.${role}.role`, "invalid persona role");
      personas[role as UserPersonaRole] = {
        role: r as UserPersonaRole,
        email: reqString(v["email"], `${p}.test_user_personas.${role}.email`),
        password_env_var: reqString(
          v["password_env_var"],
          `${p}.test_user_personas.${role}.password_env_var`,
        ),
        display_name: reqString(v["display_name"], `${p}.test_user_personas.${role}.display_name`),
        tenant_id: reqString(v["tenant_id"], `${p}.test_user_personas.${role}.tenant_id`),
        permissions: Array.isArray(v["permissions"])
          ? (v["permissions"] as unknown[]).map((perm, i) =>
              reqString(perm, `${p}.test_user_personas.${role}.permissions[${i}]`),
            )
          : [],
        ...(v["mock_session_cookie"] !== undefined
          ? {
              mock_session_cookie: reqString(
                v["mock_session_cookie"],
                `${p}.test_user_personas.${role}.mock_session_cookie`,
              ),
            }
          : {}),
      };
    }
  }
  const ap = isRecord(raw["auth_paths"])
    ? raw["auth_paths"]
    : integrity(`${p}.auth_paths`, "must be object");
  for (const f of Object.keys(ap))
    if (!["login_url", "logout_url", "signup_url", "session_verify_url"].includes(f))
      integrity(`${p}.auth_paths.${f}`, "is not supported");
  const authPaths: AuthPathsConfig = {
    login_url: reqString(ap["login_url"], `${p}.auth_paths.login_url`),
    logout_url: reqString(ap["logout_url"], `${p}.auth_paths.logout_url`),
    ...(ap["signup_url"] !== undefined
      ? { signup_url: reqString(ap["signup_url"], `${p}.auth_paths.signup_url`) }
      : {}),
    session_verify_url: reqString(ap["session_verify_url"], `${p}.auth_paths.session_verify_url`),
  };
  const cookies: Record<string, CookieTemplateConfig> = {};
  if (isRecord(raw["session_cookie_templates"])) {
    for (const [k, v] of Object.entries(raw["session_cookie_templates"])) {
      if (!isRecord(v)) integrity(`${p}.session_cookie_templates.${k}`, "must be object");
      for (const f of Object.keys(v))
        if (!["name", "domain", "path", "http_only", "secure", "same_site"].includes(f))
          integrity(`${p}.session_cookie_templates.${k}.${f}`, "is not supported");
      const sameSite = reqString(v["same_site"], `${p}.session_cookie_templates.${k}.same_site`);
      if (!["Strict", "Lax", "None"].includes(sameSite))
        integrity(`${p}.session_cookie_templates.${k}.same_site`, "invalid same_site");
      cookies[k] = {
        name: reqString(v["name"], `${p}.session_cookie_templates.${k}.name`),
        domain: reqString(v["domain"], `${p}.session_cookie_templates.${k}.domain`),
        path: reqString(v["path"], `${p}.session_cookie_templates.${k}.path`),
        http_only: reqBool(v["http_only"], `${p}.session_cookie_templates.${k}.http_only`),
        secure: reqBool(v["secure"], `${p}.session_cookie_templates.${k}.secure`),
        same_site: sameSite as "Strict" | "Lax" | "None",
      };
    }
  }
  return {
    enabled: reqBool(raw["enabled"], `${p}.enabled`),
    ...(raw["compose_file"] !== undefined
      ? { compose_file: reqString(raw["compose_file"], `${p}.compose_file`) }
      : {}),
    containers,
    test_user_personas: personas,
    auth_paths: authPaths,
    session_cookie_templates: cookies,
  };
}

export function parseRepoPolicy(raw: unknown): RepoPolicy {
  if (!isRecord(raw)) throw new HarnessError("INVALID_ARGUMENT", "Repo policy must be an object");
  for (const k of Object.keys(raw))
    if (!TOP_LEVEL_KEYS.has(k)) invalidArg("$", `unknown top-level key '${k}'`);
  const ver = reqInt(raw["schema_version"] ?? CURRENT_POLICY_SCHEMA_VERSION, "$.schema_version", 1);
  if (ver !== CURRENT_POLICY_SCHEMA_VERSION)
    integrity("$.schema_version", `must equal supported version ${CURRENT_POLICY_SCHEMA_VERSION}`);
  const rawEco =
    raw["ecosystem"] !== undefined ? reqString(raw["ecosystem"], "$.ecosystem") : "unknown";
  if (!["bun", "node", "python", "cargo", "unknown"].includes(rawEco))
    integrity("$.ecosystem", "must be one of bun, node, python, cargo, or unknown");
  let pm: PackageManager | undefined;
  if (raw["package_manager"] !== undefined) {
    const p = reqString(raw["package_manager"], "$.package_manager");
    if (!["bun", "npm", "pnpm", "yarn", "poetry", "pipenv", "pip", "cargo", "unknown"].includes(p))
      integrity("$.package_manager", "invalid package_manager");
    pm = p as PackageManager;
  }
  const testRunner = parseTestRunner(raw["test_runner"], "$.test_runner");
  const parseCmdArr = (k: "allowed_commands" | "forbidden_commands") => {
    const arr = raw[k];
    if (arr === undefined) return undefined;
    if (!Array.isArray(arr)) integrity(k, "must be an array of non-empty strings");
    const parsed: string[] = [];
    const seen = new Set<string>();
    for (const [i, c] of (arr as unknown[]).entries()) {
      const norm = reqString(c, `${k}[${i}]`);
      if (seen.has(norm)) integrity(`${k}[${i}]`, `duplicates '${norm}'`);
      seen.add(norm);
      parsed.push(norm);
    }
    return parsed;
  };
  const allowed = parseCmdArr("allowed_commands"),
    forbidden = parseCmdArr("forbidden_commands");
  if (allowed && forbidden) {
    const allowedSet = new Set(allowed);
    for (const c of forbidden)
      if (allowedSet.has(c))
        integrity("$.forbidden_commands", `conflicts with allowed command '${c}'`);
  }
  const agents: Record<string, AgentPolicy> = {};
  if (isRecord(raw["agents"])) {
    for (const [k, v] of Object.entries(raw["agents"]))
      agents[k] = parseAgentPolicy(v, `$.agents.${k}`);
  }
  return {
    schema_version: ver,
    ecosystem: rawEco as RepoEcosystem,
    ...(pm ? { package_manager: pm } : {}),
    ...(raw["skill_home_repo_root"] !== undefined
      ? { skill_home_repo_root: reqString(raw["skill_home_repo_root"], "$.skill_home_repo_root") }
      : {}),
    test_runner: testRunner,
    ...(raw["typecheck_command"] !== undefined
      ? { typecheck_command: reqString(raw["typecheck_command"], "$.typecheck_command") }
      : {}),
    ...(raw["lint_command"] !== undefined
      ? { lint_command: reqString(raw["lint_command"], "$.lint_command") }
      : {}),
    ...(allowed ? { allowed_commands: allowed } : {}),
    ...(forbidden ? { forbidden_commands: forbidden } : {}),
    read_scope_neighborhood_depth:
      raw["read_scope_neighborhood_depth"] !== undefined
        ? reqInt(raw["read_scope_neighborhood_depth"], "$.read_scope_neighborhood_depth", 0, 64)
        : 2,
    review_protocol:
      raw["review_protocol"] !== undefined
        ? parseReviewProtocol(raw["review_protocol"], "$.review_protocol")
        : { ...DEFAULT_REVIEW_PROTOCOL_POLICY },
    planning:
      raw["planning"] !== undefined
        ? parsePlanning(raw["planning"], "$.planning")
        : { ...DEFAULT_PLANNING_POLICY },
    ...(Object.keys(agents).length > 0 ? { agents } : {}),
    ...(raw["docker_environment"] !== undefined
      ? { docker_environment: parseDockerEnv(raw["docker_environment"], "$.docker_environment") }
      : {}),
  };
}
