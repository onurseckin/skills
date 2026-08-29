import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { findRepoRoot, resolveSkillHomeRepo } from "../../core/index.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  type LifecycleHooksConfig,
  type PlanningPolicy,
  type RepoPolicy,
  type ReviewProtocolPolicy,
} from "../types/index.ts";
import { buildDefaultAgents } from "./default-agents.ts";
import { buildDefaultDocker } from "./default-docker.ts";
import { detectRepoEcosystem } from "./ecosystem-detect.ts";

export { buildDefaultAgents } from "./default-agents.ts";
export { buildDefaultDocker } from "./default-docker.ts";
export { detectRepoEcosystem } from "./ecosystem-detect.ts";

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

export const DEFAULT_LIFECYCLE_HOOKS_CONFIG: LifecycleHooksConfig = {
  on_phase_completion: [
    "bun ~/.agents/skills/olt/scripts/harness.ts notify:phase --phase '{phase_name}' --sha '{commit_sha}' --duration '{duration_formatted}' --tasks {task_count}",
  ],
};

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
    hooks: { ...DEFAULT_LIFECYCLE_HOOKS_CONFIG },
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
