import { resolve } from "node:path";
import { findRepoRoot, resolveSkillHomeRepo } from "../../core/index.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  type LifecycleHooksConfig,
  type PlanningPolicy,
  type RepoEcosystem,
  type RepoPolicy,
  type ReviewProtocolPolicy,
} from "../types/index.ts";
import { buildDefaultAgents } from "./default-agents.ts";
import { buildDefaultDocker } from "./default-docker.ts";
import { detectRepoEcosystem } from "./ecosystem-detect.ts";
import { discoverToolchain, type DiscoveredToolchain } from "./toolchain-discovery.ts";

export { buildDefaultAgents } from "./default-agents.ts";
export { buildDefaultDocker } from "./default-docker.ts";
export { detectRepoEcosystem } from "./ecosystem-detect.ts";
export {
  discoverToolchain,
  readMakefile,
  readPackageJson,
  readPythonManifests,
  readTurboJson,
  type DiscoveredToolchain,
  type ParsedMakefile,
  type ParsedPackageJson,
  type ParsedPythonManifest,
  type ParsedTurboJson,
} from "./toolchain-discovery.ts";

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

export function generateCanonicalDefaultPolicy(
  root: string,
  overrideEcosystem?: RepoEcosystem,
): RepoPolicy {
  const discovery = discoverToolchain(root, overrideEcosystem);
  return {
    schema_version: CURRENT_POLICY_SCHEMA_VERSION,
    ecosystem: discovery.ecosystem,
    ...(discovery.packageManager !== undefined
      ? { package_manager: discovery.packageManager }
      : {}),
    skill_home_repo_root: resolveSkillHomeRepo(),
    test_runner: discovery.testRunner,
    ...(discovery.typecheckCommand !== undefined
      ? { typecheck_command: discovery.typecheckCommand }
      : {}),
    ...(discovery.lintCommand !== undefined ? { lint_command: discovery.lintCommand } : {}),
    allowed_commands: discovery.allowedCommands,
    forbidden_commands: discovery.forbiddenCommands,
    read_scope_neighborhood_depth: 2,
    review_protocol: { ...DEFAULT_REVIEW_PROTOCOL_POLICY },
    planning: { ...DEFAULT_PLANNING_POLICY },
    agents: buildDefaultAgents(),
    docker_environment: buildDefaultDocker(),
    hooks: { ...DEFAULT_LIFECYCLE_HOOKS_CONFIG },
  };
}

export function generateDefaultRepoPolicy(
  repoRoot?: string,
  overrideEcosystem?: RepoEcosystem,
): RepoPolicy {
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  return generateCanonicalDefaultPolicy(root, overrideEcosystem);
}
