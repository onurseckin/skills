import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveSkillHomeRepo } from "../../core/shared/paths.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  DEFAULT_LIFECYCLE_HOOKS_CONFIG,
  DEFAULT_PLANNING_POLICY,
  DEFAULT_REVIEW_PROTOCOL_POLICY,
  inspectRepoPolicy,
  loadRepoPolicy,
  saveRepoPolicy,
} from "../../policy/index.ts";
import {
  buildDefaultAgents,
  buildDefaultDocker,
  discoverToolchain,
  scanRepositoryToolchain,
  synthesizeCalibratedRepoPolicy,
  type DiscoveredToolchain,
  type ToolchainAnalysis,
} from "../../policy/generator/index.ts";
import type { RepoEcosystem, RepoPolicy } from "../../policy/types/index.ts";
import {
  inspectToolchainDetails,
  type DiscoveredToolchainDetails,
} from "./toolchain-inspector.ts";

export interface GovernanceCoverageReport {
  readonly repoRoot: string;
  readonly policyPresent: boolean;
  readonly policyValid: boolean;
  readonly policyError?: string | undefined;
  readonly ecosystem: string;
  readonly hasTestRunner: boolean;
  readonly hasTypecheck: boolean;
  readonly hasLinter: boolean;
  readonly hasFormatter?: boolean | undefined;
  readonly allowedCommandCount: number;
  readonly sessionAuthorityPresent: boolean;
  readonly backlogLedgerPresent: boolean;
  readonly defectsLedgerPresent: boolean;
  readonly readyForMindAuditor: boolean;
}

export interface GovernanceToolchainDiscoveryResult {
  readonly repoRoot: string;
  readonly toolchain: DiscoveredToolchain;
  readonly analysis: ToolchainAnalysis;
  readonly calibratedPolicy: RepoPolicy;
  readonly details?: DiscoveredToolchainDetails | undefined;
}

export function discoverAndCalibrateRepoPolicy(
  repoRoot: string,
): GovernanceToolchainDiscoveryResult {
  const root = resolve(repoRoot);
  const toolchain = discoverToolchain(root);
  const analysis = scanRepositoryToolchain(root);
  const details = inspectToolchainDetails(root);
  const synthesized = synthesizeCalibratedRepoPolicy(root);
  saveRepoPolicy(synthesized, root);

  return {
    repoRoot: root,
    toolchain,
    analysis,
    calibratedPolicy: synthesized,
    details,
  };
}

export function auditRepoGovernanceCoverage(
  repoRoot: string,
  _capsuleRunRoot?: string,
): GovernanceCoverageReport {
  const root = resolve(repoRoot);
  const oltDir = join(root, ".olt");
  const policyFile = join(oltDir, "policy.json");
  const backlogFile = join(oltDir, "backlog.jsonl");
  const defectsFile = join(oltDir, "defects.jsonl");
  const sessionFile = join(root, ".session.json");

  const policyPresent = existsSync(policyFile);
  const backlogLedgerPresent = existsSync(backlogFile);
  const defectsLedgerPresent = existsSync(defectsFile);
  const sessionAuthorityPresent = existsSync(sessionFile);

  const policyInspection = inspectRepoPolicy(root);
  const isValidCustom = policyInspection.status === "valid_custom";
  const policyValid = isValidCustom ? policyPresent : false;

  let ecosystem = "unknown";
  let hasTestRunner = false;
  let hasTypecheck = false;
  let hasLinter = false;
  let hasFormatter = false;
  let allowedCommandCount = 0;

  if (policyValid) {
    try {
      const policy = loadRepoPolicy(root);
      ecosystem = policy.ecosystem;
      hasTestRunner =
        typeof policy.test_runner.default_command === "string" &&
        policy.test_runner.default_command.trim().length > 0;
      hasTypecheck =
        typeof policy.typecheck_command === "string" &&
        policy.typecheck_command.trim().length > 0;
      hasLinter =
        typeof policy.lint_command === "string" && policy.lint_command.trim().length > 0;
      allowedCommandCount = Array.isArray(policy.allowed_commands)
        ? policy.allowed_commands.length
        : 0;
      const details = inspectToolchainDetails(root);
      hasFormatter = details.detectedFormatters.length > 0;
    } catch {
      ecosystem = "unknown";
    }
  }

  const ledgersPresent = backlogLedgerPresent && defectsLedgerPresent && sessionAuthorityPresent;
  const readyForMindAuditor = policyPresent && policyValid && ledgersPresent;

  return {
    repoRoot: root,
    policyPresent,
    policyValid,
    ...(policyInspection.error !== undefined ? { policyError: policyInspection.error } : {}),
    ecosystem,
    hasTestRunner,
    hasTypecheck,
    hasLinter,
    hasFormatter,
    allowedCommandCount,
    sessionAuthorityPresent,
    backlogLedgerPresent,
    defectsLedgerPresent,
    readyForMindAuditor,
  };
}

export function scaffoldTailoredPolicy(
  repoRoot: string,
  options?: { overrideEcosystem?: RepoEcosystem },
): RepoPolicy {
  const root = resolve(repoRoot);
  const discovery = discoverToolchain(root, options?.overrideEcosystem);

  const policy: RepoPolicy = {
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

  saveRepoPolicy(policy, root);
  return policy;
}

export function isRepoPolicyCalibrated(repoRoot: string): boolean {
  const root = resolve(repoRoot);
  const oltDir = join(root, ".olt");
  const policyPath = join(oltDir, "policy.json");
  if (!existsSync(policyPath)) return false;
  const inspection = inspectRepoPolicy(root);
  if (inspection.status !== "valid_custom") return false;
  const policy = inspection.policy;
  if (typeof policy.test_runner !== "object") return false;
  if (policy.test_runner === null) return false;
  if (typeof policy.test_runner.default_command !== "string") return false;
  if (policy.test_runner.default_command.trim().length === 0) return false;
  if (!Array.isArray(policy.allowed_commands)) return false;
  if (policy.allowed_commands.length === 0) return false;
  return true;
}

export function ensureCalibratedRepoPolicy(repoRoot: string): RepoPolicy {
  const root = resolve(repoRoot);
  if (!isRepoPolicyCalibrated(root)) {
    const result = discoverAndCalibrateRepoPolicy(root);
    return result.calibratedPolicy;
  }
  return loadRepoPolicy(root);
}
