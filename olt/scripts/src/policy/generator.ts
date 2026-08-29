import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { findRepoRoot, resolveSkillHomeRepo } from "../core/index.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  type AgentPolicy,
  type DockerTestProfile,
  type PlanningPolicy,
  type RepoEcosystem,
  type RepoPolicy,
  type ReviewProtocolPolicy,
} from "./types.ts";

export const DEFAULT_REVIEW_PROTOCOL_POLICY: ReviewProtocolPolicy = {
  max_adversarial_pushes: 20,
  cognitive_pushes: 5,
  escalate_on_exhausted_adversarial: true,
};

export const DEFAULT_PLANNING_POLICY: PlanningPolicy = {
  mandatory_brainstorming_rounds: 3,
  socratic_expansion_depth: 8,
  enforce_edge_case_matrix: true,
  min_tasks_per_complex_prompt: 6,
  max_files_per_task: 2,
  reject_shallow_umbrella_compression: true,
};

export function detectRepoEcosystem(repoRoot?: string): RepoEcosystem {
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) return "bun";
  if (existsSync(join(root, "Cargo.toml")) || existsSync(join(root, "Cargo.lock"))) return "cargo";
  if (
    existsSync(join(root, "pyproject.toml")) ||
    existsSync(join(root, "requirements.txt")) ||
    existsSync(join(root, "Pipfile")) ||
    existsSync(join(root, "setup.py"))
  )
    return "python";
  if (
    existsSync(join(root, "package.json")) ||
    existsSync(join(root, "package-lock.json")) ||
    existsSync(join(root, "yarn.lock")) ||
    existsSync(join(root, "pnpm-lock.yaml"))
  )
    return "node";
  return "unknown";
}

function buildDefaultAgents(): Record<string, AgentPolicy> {
  const makeHosts = (mTier: "high" | "xhigh", sInt?: number) => ({
    antigravity: {
      model: "gemini-3.7-flash",
      model_tier: "high" as const,
      thinking_effort: "high" as const,
      max_tokens: 8192,
      ...(sInt ? { scheduler: { interval_seconds: sInt, enabled: true } } : {}),
    },
    claude_code: {
      model: mTier === "xhigh" ? "claude-5-opus" : "claude-5-sonnet",
      model_tier: mTier,
      thinking_effort: "high" as const,
      max_tokens: 8192,
      ...(sInt ? { scheduler: { interval_seconds: sInt, enabled: true } } : {}),
    },
    codex: {
      model: mTier === "xhigh" ? "gpt-5.6-sol" : "gpt-5.6-terra",
      model_tier: mTier,
      thinking_effort: "high" as const,
      max_tokens: 8192,
      ...(sInt ? { scheduler: { interval_seconds: sInt, enabled: true } } : {}),
    },
    cursor: {
      model: "cursor-latest",
      model_tier: "high" as const,
      thinking_effort: "high" as const,
      max_tokens: 8192,
      ...(sInt ? { scheduler: { interval_seconds: sInt, enabled: true } } : {}),
    },
  });

  const valQuotas = {
    mandatory_cognitive_pushbacks: 5,
    max_adversarial_probes: 10,
    max_turns_per_task: 15,
    escalate_on_exhausted_adversarial: true,
  };
  const valRbac = { can_execute_shell: false, can_edit_code: false };

  return {
    mind_supervisor: {
      tier: 0,
      silent_daemon: true,
      rbac: {
        can_execute_shell: false,
        can_edit_code: false,
        allowed_spawns: ["orchestrator", "mind_auditor", "skill_auditor", "autonomic_watchdog"],
      },
      hosts: {
        antigravity: {
          model: "gemini-3.7-flash",
          model_tier: "high",
          thinking_effort: "high",
          max_tokens: 8192,
          scheduler: { cron: "*/5 * * * *", interval_seconds: 300, enabled: true },
        },
        claude_code: {
          model: "claude-5-opus",
          model_tier: "xhigh",
          thinking_effort: "high",
          max_tokens: 8192,
          scheduler: { cron: "*/15 * * * *", interval_seconds: 900, enabled: true },
        },
        codex: {
          model: "gpt-5.6-sol",
          model_tier: "xhigh",
          thinking_effort: "high",
          max_tokens: 8192,
          scheduler: { cron: "*/15 * * * *", interval_seconds: 900, enabled: true },
        },
        cursor: {
          model: "cursor-latest",
          model_tier: "high",
          thinking_effort: "high",
          max_tokens: 8192,
          scheduler: { cron: "*/5 * * * *", interval_seconds: 300, enabled: true },
        },
      },
    },
    orchestrator: {
      tier: 1,
      rbac: {
        can_execute_shell: true,
        can_edit_code: false,
        allowed_commands: ["bun harness.ts *", "git status", "git diff", "git log"],
        forbidden_patterns: ["^bun\\s+test\\b", "^npm\\s+test\\b", "^git\\s+(commit|push|reset)"],
        allowed_spawns: [
          "coordinator",
          "implementer",
          "validator_code_quality",
          "validator_ui_design",
          "completeness_critic",
        ],
      },
      hosts: makeHosts("xhigh"),
    },
    coordinator: {
      tier: 2,
      rbac: {
        can_execute_shell: true,
        can_edit_code: false,
        allowed_commands: [
          "bun harness.ts *",
          "git status",
          "git diff",
          "git commit",
          "git push",
          "git log",
        ],
        forbidden_patterns: ["^bun\\s+test\\b", "^npm\\s+test\\b"],
        allowed_spawns: [
          "implementer",
          "validator_code_quality",
          "validator_ui_design",
          "completeness_critic",
        ],
      },
      hosts: makeHosts("xhigh"),
    },
    implementer: {
      tier: 3,
      rbac: {
        can_execute_shell: true,
        can_edit_code: true,
        allowed_commands: [
          "bun test <target>",
          "bun run typecheck",
          "bun run lint",
          "git status",
          "git diff",
          "ls",
          "grep",
        ],
        forbidden_patterns: [
          "^git\\s+(commit|push|reset|checkout\\s+-b)",
          "^bun\\s+test\\s*$",
          "^npm\\s+test\\s*$",
        ],
      },
      hosts: makeHosts("high"),
    },
    validator_code_quality: {
      tier: 3,
      domain: "code_quality",
      quotas: valQuotas,
      rbac: valRbac,
      hosts: makeHosts("high"),
    },
    validator_ui_design: {
      tier: 3,
      domain: "ui_design",
      quotas: valQuotas,
      rbac: valRbac,
      hosts: makeHosts("high"),
    },
    validator_security: {
      tier: 3,
      domain: "security",
      quotas: valQuotas,
      rbac: valRbac,
      hosts: makeHosts("high"),
    },
    validator_system_design: {
      tier: 3,
      domain: "system_design",
      quotas: valQuotas,
      rbac: valRbac,
      hosts: makeHosts("high"),
    },
    validator_product: {
      tier: 3,
      domain: "product",
      quotas: valQuotas,
      rbac: valRbac,
      hosts: makeHosts("high"),
    },
    completeness_critic: {
      tier: 3,
      domain: "completeness",
      quotas: valQuotas,
      rbac: valRbac,
      hosts: makeHosts("high"),
    },
    autonomic_watchdog: {
      tier: 0,
      silent_daemon: true,
      rbac: { can_execute_shell: false, can_edit_code: false },
      hosts: makeHosts("high", 300),
    },
    owner: {
      tier: "independent",
      rbac: {
        can_execute_shell: true,
        can_edit_code: true,
        allowed_commands: [
          "agent:register",
          "authority:decide",
          "mind:admit",
          "mind:rotate",
          "recover",
          "doctor",
        ],
      },
      hosts: makeHosts("xhigh"),
    },
  };
}

function buildDefaultDocker(): DockerTestProfile {
  return {
    enabled: true,
    compose_file: "docker-compose.test.yml",
    containers: {
      web_app: {
        container_name: "app-web-test",
        image: "node:20-alpine",
        ports: ["3000:3000"],
        health_endpoint: "http://localhost:3000/api/health",
        ready_timeout_ms: 30000,
        env: { NODE_ENV: "test", PORT: "3000" },
      },
    },
    test_user_personas: {
      admin: {
        role: "admin",
        email: "admin@olt.local",
        password_env_var: "OLT_TEST_ADMIN_PASSWORD",
        display_name: "Test Admin",
        tenant_id: "tenant-corp-001",
        permissions: ["*"],
        mock_session_cookie: "olt_session_admin_mock_token_sec991823",
      },
      standard_user: {
        role: "standard_user",
        email: "user@olt.local",
        password_env_var: "OLT_TEST_USER_PASSWORD",
        display_name: "Standard User",
        tenant_id: "tenant-corp-001",
        permissions: ["read", "write"],
        mock_session_cookie: "olt_session_user_mock_token_usr102938",
      },
      invited_member: {
        role: "invited_member",
        email: "invited@olt.local",
        password_env_var: "OLT_TEST_INVITED_PASSWORD",
        display_name: "Invited Member",
        tenant_id: "tenant-corp-001",
        permissions: ["read"],
        mock_session_cookie: "olt_session_invited_mock_token_inv482019",
      },
      guest: {
        role: "guest",
        email: "guest@olt.local",
        password_env_var: "OLT_TEST_GUEST_PASSWORD",
        display_name: "Guest Visitor",
        tenant_id: "tenant-corp-001",
        permissions: ["public_read"],
      },
    },
    auth_paths: {
      login_url: "http://localhost:3000/login",
      logout_url: "http://localhost:3000/logout",
      signup_url: "http://localhost:3000/signup",
      session_verify_url: "http://localhost:3000/api/auth/me",
    },
    session_cookie_templates: {
      session_id: {
        name: "olt_session_id",
        domain: "localhost",
        path: "/",
        http_only: true,
        secure: false,
        same_site: "Lax",
      },
    },
  };
}

export function generateCanonicalDefaultPolicy(root: string): RepoPolicy {
  const ecosystem = detectRepoEcosystem(root);
  const common = {
    schema_version: CURRENT_POLICY_SCHEMA_VERSION,
    skill_home_repo_root: resolveSkillHomeRepo(),
    read_scope_neighborhood_depth: 2,
    review_protocol: { ...DEFAULT_REVIEW_PROTOCOL_POLICY },
    planning: { ...DEFAULT_PLANNING_POLICY },
    agents: buildDefaultAgents(),
    docker_environment: buildDefaultDocker(),
  };

  switch (ecosystem) {
    case "bun":
      return {
        ...common,
        ecosystem: "bun",
        package_manager: "bun",
        test_runner: {
          default_command: "bun test",
          targeted_pattern: "bun test <path>",
          full_suite_command: "bun test",
          timeout_ms: 30000,
        },
        typecheck_command: "bun run typecheck",
        lint_command: "bun run lint",
        allowed_commands: [
          "bun test",
          "bun run",
          "tsc",
          "git status",
          "git diff",
          "git log",
          "ls",
          "find",
          "grep",
          "cat",
          "wc",
        ],
        forbidden_commands: ["git commit", "git push", "git reset", "rm -rf /"],
      };
    case "cargo":
      return {
        ...common,
        ecosystem: "cargo",
        package_manager: "cargo",
        test_runner: {
          default_command: "cargo test",
          targeted_pattern: "cargo test -- <path>",
          full_suite_command: "cargo test",
          timeout_ms: 30000,
        },
        typecheck_command: "cargo check",
        lint_command: "cargo clippy",
        allowed_commands: [
          "cargo test",
          "cargo check",
          "cargo clippy",
          "git status",
          "git diff",
          "ls",
          "grep",
        ],
        forbidden_commands: ["git commit", "git push", "git reset"],
      };
    case "python":
      return {
        ...common,
        ecosystem: "python",
        package_manager: existsSync(join(root, "poetry.lock"))
          ? "poetry"
          : existsSync(join(root, "Pipfile"))
            ? "pipenv"
            : "pip",
        test_runner: {
          default_command: "pytest",
          targeted_pattern: "pytest <path>",
          full_suite_command: "pytest",
          timeout_ms: 30000,
        },
        typecheck_command: "mypy",
        lint_command: "ruff check",
        allowed_commands: [
          "pytest",
          "python -m pytest",
          "mypy",
          "ruff check",
          "git status",
          "git diff",
          "ls",
          "grep",
        ],
        forbidden_commands: ["git commit", "git push", "git reset"],
      };
    case "node": {
      const pm = existsSync(join(root, "pnpm-lock.yaml"))
        ? "pnpm"
        : existsSync(join(root, "yarn.lock"))
          ? "yarn"
          : "npm";
      const runner = pm === "npm" ? "npm test --" : pm === "pnpm" ? "pnpm test" : "yarn test";
      return {
        ...common,
        ecosystem: "node",
        package_manager: pm,
        test_runner: {
          default_command: `${pm} test`,
          targeted_pattern: `${runner} <path>`,
          full_suite_command: `${pm} test`,
          timeout_ms: 30000,
        },
        typecheck_command: "npm run typecheck",
        lint_command: "npm run lint",
        allowed_commands: [`${pm} test`, "npm test", "git status", "git diff", "ls", "grep"],
        forbidden_commands: ["git commit", "git push", "git reset"],
      };
    }
    default:
      return {
        ...common,
        ecosystem: "unknown",
        test_runner: {
          default_command: "test",
          targeted_pattern: "test <path>",
          full_suite_command: "test",
          timeout_ms: 30000,
        },
      };
  }
}

export function generateDefaultRepoPolicy(repoRoot?: string): RepoPolicy {
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  return generateCanonicalDefaultPolicy(root);
}
