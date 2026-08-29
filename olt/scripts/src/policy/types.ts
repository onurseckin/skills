export type RepoEcosystem = "bun" | "node" | "python" | "cargo" | "unknown";

export type PackageManager =
  | "bun"
  | "npm"
  | "pnpm"
  | "yarn"
  | "poetry"
  | "pipenv"
  | "pip"
  | "cargo"
  | "unknown";

export type HostType = "antigravity" | "claude_code" | "codex" | "cursor";
export type ModelTier = "low" | "medium" | "high" | "xhigh";
export type ThinkingEffort = "none" | "low" | "medium" | "high";

export type AgentRoleName =
  | "mind_supervisor"
  | "mind_auditor"
  | "skill_auditor"
  | "orchestrator"
  | "coordinator"
  | "implementer"
  | "validator_code_quality"
  | "validator_ui_design"
  | "validator_security"
  | "validator_system_design"
  | "validator_product"
  | "completeness_critic"
  | "autonomic_watchdog"
  | "owner";

export type UserPersonaRole = "admin" | "standard_user" | "invited_member" | "guest";

export interface AgentSchedulerPolicy {
  readonly cron?: string | undefined;
  readonly interval_seconds?: number | undefined;
  readonly enabled: boolean;
  readonly jitter_seconds?: number | undefined;
}

export interface AgentHostPolicy {
  readonly model: string;
  readonly model_tier: ModelTier;
  readonly thinking_effort?: ThinkingEffort | undefined;
  readonly max_tokens?: number | undefined;
  readonly token_budget?: number | undefined;
  readonly context_window?: number | undefined;
  readonly scheduler?: AgentSchedulerPolicy | undefined;
  readonly temperature?: number | undefined;
}

export interface ValidatorQuotas {
  readonly mandatory_cognitive_pushbacks: number;
  readonly max_adversarial_probes: number;
  readonly max_turns_per_task: number;
  readonly escalate_on_exhausted_adversarial: boolean;
}

export interface AgentRbacPolicy {
  readonly can_execute_shell: boolean;
  readonly can_edit_code: boolean;
  readonly allowed_commands?: readonly string[] | undefined;
  readonly forbidden_patterns?: readonly string[] | undefined;
  readonly allowed_spawns?: readonly string[] | undefined;
}

export interface AgentPolicy {
  readonly tier: number | "independent";
  readonly silent_daemon?: boolean | undefined;
  readonly domain?: string | undefined;
  readonly rbac: AgentRbacPolicy;
  readonly quotas?: ValidatorQuotas | undefined;
  readonly hosts: Record<HostType, AgentHostPolicy>;
}

export interface TestRunnerPolicy {
  readonly default_command: string;
  readonly targeted_pattern: string;
  readonly full_suite_command: string;
  readonly timeout_ms?: number | undefined;
}

export interface ReviewProtocolPolicy {
  readonly max_adversarial_pushes: number;
  readonly cognitive_pushes: number;
  readonly escalate_on_exhausted_adversarial?: boolean | undefined;
}

export interface PlanningPolicy {
  readonly mandatory_brainstorming_rounds: number;
  readonly socratic_expansion_depth: number;
  readonly enforce_edge_case_matrix: boolean;
  readonly min_tasks_per_complex_prompt: number;
  readonly max_files_per_task: number;
  readonly reject_shallow_umbrella_compression: boolean;
  readonly max_task_duration_minutes?: number | undefined;
  readonly parallel_subagent_sla_rule?: boolean | undefined;
  readonly stage_on_subdomain_completion?: boolean | undefined;
}

export interface ContainerConfig {
  readonly container_name: string;
  readonly image: string;
  readonly ports: readonly string[];
  readonly health_endpoint: string;
  readonly ready_timeout_ms: number;
  readonly env?: Record<string, string> | undefined;
}

export interface UserPersonaConfig {
  readonly role: UserPersonaRole;
  readonly email: string;
  readonly password_env_var: string;
  readonly display_name: string;
  readonly tenant_id: string;
  readonly permissions: readonly string[];
  readonly mock_session_cookie?: string | undefined;
}

export interface AuthPathsConfig {
  readonly login_url: string;
  readonly logout_url: string;
  readonly signup_url?: string | undefined;
  readonly session_verify_url: string;
}

export interface CookieTemplateConfig {
  readonly name: string;
  readonly domain: string;
  readonly path: string;
  readonly http_only: boolean;
  readonly secure: boolean;
  readonly same_site: "Strict" | "Lax" | "None";
}

export interface DockerTestProfile {
  readonly enabled: boolean;
  readonly compose_file?: string | undefined;
  readonly containers: Record<string, ContainerConfig>;
  readonly test_user_personas: Record<UserPersonaRole, UserPersonaConfig>;
  readonly auth_paths: AuthPathsConfig;
  readonly session_cookie_templates: Record<string, CookieTemplateConfig>;
}

export interface RepoPolicy {
  readonly schema_version: number;
  readonly ecosystem: RepoEcosystem;
  readonly package_manager?: PackageManager | undefined;
  readonly skill_home_repo_root?: string | undefined;
  readonly test_runner: TestRunnerPolicy;
  readonly typecheck_command?: string | undefined;
  readonly lint_command?: string | undefined;
  readonly allowed_commands?: readonly string[] | undefined;
  readonly forbidden_commands?: readonly string[] | undefined;
  readonly read_scope_neighborhood_depth?: number | undefined;
  readonly review_protocol?: ReviewProtocolPolicy | undefined;
  readonly planning?: PlanningPolicy | undefined;
  readonly agents?: Record<string, AgentPolicy> | undefined;
  readonly docker_environment?: DockerTestProfile | undefined;
}

export const CURRENT_POLICY_SCHEMA_VERSION = 1;
