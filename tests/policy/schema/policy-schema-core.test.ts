import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  parseRepoPolicy,
  type AgentHostPolicy,
  type RepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";
import { cleanupVirtualPolicyFS, setupVirtualPolicyFS } from "../fixture.ts";

export function canonicalHosts(model = "gemini-3.7-flash"): Record<string, AgentHostPolicy> {
  return {
    antigravity: {
      model,
      model_tier: "high",
      thinking_effort: "high",
      max_tokens: 8192,
      scheduler: { enabled: true, cron: "*/5 * * * *", interval_seconds: 300 },
    },
    claude_code: { model: "claude-5-opus", model_tier: "xhigh", thinking_effort: "high" },
    codex: { model: "gpt-5.6-sol", model_tier: "xhigh", thinking_effort: "high" },
    cursor: { model: "cursor-latest", model_tier: "high", thinking_effort: "high" },
  };
}

export function canonicalPolicy(): Record<string, unknown> {
  return {
    schema_version: 1,
    ecosystem: "bun",
    package_manager: "bun",
    skill_home_repo_root: "/Users/onurseckinsenoglu/repos/skills",
    test_runner: {
      default_command: "bun test",
      targeted_pattern: "bun test <path>",
      full_suite_command: "bun test",
      timeout_ms: 30000,
    },
    typecheck_command: "bun run typecheck",
    lint_command: "bun run lint",
    allowed_commands: ["bun test", "bun run", "tsc", "git status", "ls"],
    forbidden_commands: ["git commit", "git push", "git reset", "rm -rf /"],
    read_scope_neighborhood_depth: 2,
    review_protocol: {
      max_adversarial_pushes: 20,
      cognitive_pushes: 5,
      escalate_on_exhausted_adversarial: true,
    },
    planning: {
      mandatory_brainstorming_rounds: 3,
      socratic_expansion_depth: 8,
      enforce_edge_case_matrix: true,
      min_tasks_per_complex_prompt: 6,
      max_files_per_task: 2,
      reject_shallow_umbrella_compression: true,
      max_task_duration_minutes: 5,
      parallel_subagent_sla_rule: true,
      stage_on_subdomain_completion: true,
    },
    agents: {
      mind_supervisor: {
        tier: 0,
        silent_daemon: true,
        rbac: { can_execute_shell: false, can_edit_code: false, allowed_spawns: ["orchestrator"] },
        hosts: canonicalHosts(),
      },
      orchestrator: {
        tier: 1,
        rbac: {
          can_execute_shell: true,
          can_edit_code: false,
          allowed_commands: ["git status"],
          forbidden_patterns: ["^git\\s+commit"],
        },
        hosts: canonicalHosts(),
      },
      coordinator: {
        tier: 2,
        rbac: { can_execute_shell: true, can_edit_code: false, allowed_commands: ["git status"] },
        hosts: canonicalHosts(),
      },
      implementer: {
        tier: 3,
        rbac: {
          can_execute_shell: true,
          can_edit_code: true,
          allowed_commands: ["bun test <target>"],
        },
        hosts: canonicalHosts(),
      },
      validator_code_quality: {
        tier: 3,
        domain: "code_quality",
        quotas: {
          mandatory_cognitive_pushbacks: 5,
          max_adversarial_probes: 10,
          max_turns_per_task: 15,
          escalate_on_exhausted_adversarial: true,
        },
        rbac: { can_execute_shell: false, can_edit_code: false },
        hosts: canonicalHosts(),
      },
      validator_ui_design: {
        tier: 3,
        domain: "ui_design",
        quotas: {
          mandatory_cognitive_pushbacks: 5,
          max_adversarial_probes: 10,
          max_turns_per_task: 15,
          escalate_on_exhausted_adversarial: true,
        },
        rbac: { can_execute_shell: false, can_edit_code: false },
        hosts: canonicalHosts(),
      },
      owner: {
        tier: "independent",
        rbac: {
          can_execute_shell: true,
          can_edit_code: true,
          allowed_commands: ["authority:decide"],
        },
        hosts: canonicalHosts(),
      },
    },
    docker_environment: {
      enabled: true,
      compose_file: "docker-compose.test.yml",
      containers: {
        web_app: {
          container_name: "app-web-test",
          image: "node:20-alpine",
          ports: ["3000:3000"],
          health_endpoint: "http://localhost:3000/api/health",
          ready_timeout_ms: 30000,
          env: { NODE_ENV: "test" },
        },
      },
      test_user_personas: {
        admin: {
          role: "admin",
          email: "admin@olt.local",
          password_env_var: "OLT_TEST_ADMIN_PASSWORD",
          display_name: "Test Admin",
          tenant_id: "tenant-001",
          permissions: ["*"],
          mock_session_cookie: "mock-admin",
        },
        standard_user: {
          role: "standard_user",
          email: "user@olt.local",
          password_env_var: "OLT_TEST_USER_PASSWORD",
          display_name: "User",
          tenant_id: "tenant-001",
          permissions: ["read"],
        },
        invited_member: {
          role: "invited_member",
          email: "inv@olt.local",
          password_env_var: "OLT_TEST_INV_PASSWORD",
          display_name: "Invited",
          tenant_id: "tenant-001",
          permissions: ["read"],
        },
        guest: {
          role: "guest",
          email: "guest@olt.local",
          password_env_var: "OLT_TEST_GUEST_PASSWORD",
          display_name: "Guest",
          tenant_id: "tenant-001",
          permissions: ["public"],
        },
      },
      auth_paths: {
        login_url: "http://localhost:3000/login",
        logout_url: "http://localhost:3000/logout",
        signup_url: "http://localhost:3000/signup",
        session_verify_url: "http://localhost:3000/api/me",
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
    },
  };
}

describe("Policy Schema Core", () => {
  beforeEach(() => {
    setupVirtualPolicyFS();
  });
  afterEach(() => {
    cleanupVirtualPolicyFS();
  });

  describe("Canonical & Minimal Parsing", () => {
    test("parses full canonical policy with all 7 archetypes and Docker environment", () => {
      const raw = canonicalPolicy();
      const policy: RepoPolicy = parseRepoPolicy(raw);
      expect(policy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
      expect(policy.ecosystem).toBe("bun");
      expect(policy.package_manager).toBe("bun");
      expect(policy.skill_home_repo_root).toBe("/Users/onurseckinsenoglu/repos/skills");
      expect(policy.test_runner.default_command).toBe("bun test");
      expect(policy.test_runner.timeout_ms).toBe(30000);
      expect(policy.allowed_commands).toEqual(["bun test", "bun run", "tsc", "git status", "ls"]);
      expect(policy.forbidden_commands).toEqual([
        "git commit",
        "git push",
        "git reset",
        "rm -rf /",
      ]);
      expect(policy.read_scope_neighborhood_depth).toBe(2);
      expect(policy.review_protocol?.max_adversarial_pushes).toBe(20);
      expect(policy.planning?.mandatory_brainstorming_rounds).toBe(3);
      expect(policy.agents?.["mind_supervisor"]?.tier).toBe(0);
      expect(policy.agents?.["mind_supervisor"]?.silent_daemon).toBe(true);
      expect(policy.agents?.["owner"]?.tier).toBe("independent");
      expect(policy.agents?.["validator_code_quality"]?.quotas?.mandatory_cognitive_pushbacks).toBe(
        5,
      );
      expect(policy.agents?.["mind_supervisor"]?.hosts.antigravity.scheduler?.enabled).toBe(true);
      expect(policy.docker_environment?.enabled).toBe(true);
      expect(policy.docker_environment?.containers["web_app"]?.ports).toEqual(["3000:3000"]);
      expect(policy.docker_environment?.test_user_personas.admin.role).toBe("admin");
      expect(policy.docker_environment?.session_cookie_templates["session_id"]?.same_site).toBe(
        "Lax",
      );
    });

    test("parses minimal policy with default schema_version and fallback depth", () => {
      const minRaw = {
        ecosystem: "cargo",
        test_runner: {
          default_command: "cargo test",
          targeted_pattern: "cargo test -- <path>",
          full_suite_command: "cargo test",
        },
      };
      const policy = parseRepoPolicy(minRaw);
      expect(policy.schema_version).toBe(1);
      expect(policy.ecosystem).toBe("cargo");
      expect(policy.package_manager).toBeUndefined();
      expect(policy.read_scope_neighborhood_depth).toBe(2);
      expect(policy.agents).toBeUndefined();
      expect(policy.docker_environment).toBeUndefined();
    });
  });

  describe("Non-Object Inputs & Schema Version Failures", () => {
    test.each([null, undefined, 42, "invalid string", true, false, [1, 2, 3]])(
      "rejects non-object input %p with INVALID_ARGUMENT",
      (input) => {
        expect(() => parseRepoPolicy(input)).toThrow(HarnessError);
      },
    );

    test.each([0, 2, 99, -1, 1.5])(
      "rejects invalid schema_version %p with INTEGRITY error",
      (ver) => {
        expect(() => parseRepoPolicy({ ...canonicalPolicy(), schema_version: ver })).toThrow(
          HarnessError,
        );
      },
    );
  });

  describe("Unknown Keys & Invalid Enums", () => {
    test("rejects unknown top-level keys with INVALID_ARGUMENT", () => {
      expect(() => parseRepoPolicy({ ...canonicalPolicy(), rogue_key: "disallowed" })).toThrow(
        HarnessError,
      );
    });

    test.each(["ruby", "golang", "csharp", ""])(
      "rejects invalid ecosystem '%s' with INTEGRITY error",
      (eco) => {
        expect(() => parseRepoPolicy({ ...canonicalPolicy(), ecosystem: eco })).toThrow(
          HarnessError,
        );
      },
    );

    test.each(["pipx", "gradle", "vcpkg"])("rejects invalid package_manager '%s'", (pm) => {
      expect(() => parseRepoPolicy({ ...canonicalPolicy(), package_manager: pm })).toThrow(
        HarnessError,
      );
    });
  });
});
