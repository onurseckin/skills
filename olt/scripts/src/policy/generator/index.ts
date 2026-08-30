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
import { scanRepositoryToolchain, synthesizeCalibratedRepoPolicy } from "./toolchain-scanner.ts";

export { buildDefaultAgents } from "./default-agents.ts";
export { buildDefaultDocker } from "./default-docker.ts";
export { detectRepoEcosystem } from "./ecosystem-detect.ts";
export { scanRepositoryToolchain, synthesizeCalibratedRepoPolicy } from "./toolchain-scanner.ts";

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
  return synthesizeCalibratedRepoPolicy(root);
}

export function generateDefaultRepoPolicy(repoRoot?: string): RepoPolicy {
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  return generateCanonicalDefaultPolicy(root);
}
