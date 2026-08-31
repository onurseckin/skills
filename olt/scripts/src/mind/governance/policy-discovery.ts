import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  discoverToolchain,
  inspectRepoPolicy,
  loadRepoPolicy,
  saveRepoPolicy,
  type DiscoveredToolchain,
  type RepoPolicy,
} from "../../policy/index.ts";
import {
  scanRepositoryToolchain,
  synthesizeCalibratedRepoPolicy,
  type ToolchainAnalysis,
} from "../../policy/generator/index.ts";

export interface GovernanceToolchainDiscoveryResult {
  readonly repoRoot: string;
  readonly toolchain: DiscoveredToolchain;
  readonly analysis: ToolchainAnalysis;
  readonly calibratedPolicy: RepoPolicy;
}

export interface GovernanceCoverageReport {
  readonly repoRoot: string;
  readonly policyPresent: boolean;
  readonly policyValid: boolean;
  readonly policyError?: string | undefined;
  readonly ecosystem: string;
  readonly hasTestRunner: boolean;
  readonly hasTypecheck: boolean;
  readonly hasLinter: boolean;
  readonly allowedCommandCount: number;
  readonly sessionAuthorityPresent: boolean;
  readonly backlogLedgerPresent: boolean;
  readonly defectsLedgerPresent: boolean;
  readonly readyForMindAuditor: boolean;
}

export function discoverAndCalibrateRepoPolicy(
  repoRoot: string,
): GovernanceToolchainDiscoveryResult {
  const toolchain = discoverToolchain(repoRoot);
  const analysis = scanRepositoryToolchain(repoRoot);
  const synthesized = synthesizeCalibratedRepoPolicy(repoRoot);
  saveRepoPolicy(synthesized, repoRoot);

  return {
    repoRoot,
    toolchain,
    analysis,
    calibratedPolicy: synthesized,
  };
}

export function auditRepoGovernanceCoverage(
  repoRoot: string,
  _capsuleRunRoot?: string,
): GovernanceCoverageReport {
  const oltDir = join(repoRoot, ".olt");
  const policyFile = join(oltDir, "policy.json");
  const backlogFile = join(oltDir, "backlog.jsonl");
  const defectsFile = join(oltDir, "defects.jsonl");
  const sessionFile = join(repoRoot, ".session.json");

  const policyPresent = existsSync(policyFile);
  const backlogLedgerPresent = existsSync(backlogFile);
  const defectsLedgerPresent = existsSync(defectsFile);
  const sessionAuthorityPresent = existsSync(sessionFile);

  const policyInspection = inspectRepoPolicy(repoRoot);
  const policyValid = policyInspection.status === "valid_custom" && policyPresent;

  let ecosystem = "unknown";
  let hasTestRunner = false;
  let hasTypecheck = false;
  let hasLinter = false;
  let allowedCommandCount = 0;

  if (policyValid) {
    try {
      const policy = loadRepoPolicy(repoRoot);
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
    } catch {
      ecosystem = "unknown";
    }
  }

  const readyForMindAuditor =
    policyPresent &&
    policyValid &&
    backlogLedgerPresent &&
    defectsLedgerPresent &&
    sessionAuthorityPresent;

  return {
    repoRoot,
    policyPresent,
    policyValid,
    ...(policyInspection.error !== undefined ? { policyError: policyInspection.error } : {}),
    ecosystem,
    hasTestRunner,
    hasTypecheck,
    hasLinter,
    allowedCommandCount,
    sessionAuthorityPresent,
    backlogLedgerPresent,
    defectsLedgerPresent,
    readyForMindAuditor,
  };
}
